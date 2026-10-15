// SQLite queue of permission asks shared by the harness hooks (writers) and runner.js (reader).

import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function stateDirectory() {
  return (
    process.env.HERDR_PLUGIN_STATE_DIR ||
    join(homedir(), ".local/state/herdr/plugins/local.permission-evaluator")
  );
}

export function openQueue(path = join(stateDirectory(), "queue.db")) {
  const isFile = path !== ":memory:";
  if (isFile) {
    // Rows, the audit log and runner logs can contain command text with secrets. mkdir's mode is
    // ignored for an existing directory, so tighten it explicitly.
    mkdirSync(dirname(path), { recursive: true });
    chmodSync(dirname(path), 0o700);
  }

  const db = new Database(path, { create: true, strict: true });
  if (isFile) chmodSync(path, 0o600);

  // busy_timeout first, so the switch to WAL waits for a concurrent opener instead of failing.
  db.exec("PRAGMA busy_timeout = 2000");
  db.exec("PRAGMA journal_mode = WAL");
  // IF NOT EXISTS keeps two hooks that open a new database at the same time from colliding.
  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_asks (
      id          INTEGER PRIMARY KEY,
      created_at  TEXT NOT NULL,
      harness     TEXT NOT NULL,
      session_id  TEXT,
      target_key  TEXT NOT NULL,
      target      TEXT NOT NULL CHECK (json_valid(target)),
      context     TEXT NOT NULL CHECK (json_valid(context)),
      status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'handled', 'need_human', 'stale')),
      attempts    INTEGER NOT NULL DEFAULT 0,
      run_id      TEXT,
      reason      TEXT,
      policy_hash TEXT,
      dry_run     INTEGER NOT NULL DEFAULT 0,
      decided_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS permission_asks_queue ON permission_asks (status, target_key, id);

    CREATE TABLE IF NOT EXISTS target_lock (
      name   TEXT PRIMARY KEY,
      holder TEXT NOT NULL
    );
  `);
  return db;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function rowFromDb(row) {
  return { ...row, target: JSON.parse(row.target), context: JSON.parse(row.context) };
}

export function insertAsk(db, { harness, sessionId, target, targetKey, context, now = Date.now() }) {
  const result = db
    .query(
      `INSERT INTO permission_asks (created_at, harness, session_id, target_key, target, context)
       VALUES ($createdAt, $harness, $sessionId, $targetKey, $target, $context)`,
    )
    .run({
      createdAt: iso(now),
      harness,
      sessionId: sessionId ?? null,
      targetKey,
      target: JSON.stringify(target),
      context: JSON.stringify(context),
    });
  return Number(result.lastInsertRowid);
}

// Holders are "<pid>:<run id>"; the lock is held exactly as long as that process lives. A time
// lease would either block a pane after a crash or expire under a runner that is still
// evaluating (the laptop slept), putting two evaluators on one pane. A reused pid only delays the
// pane's next run until that process exits.
export function holderIsAlive(holder) {
  const match = /^(\d+):/.exec(holder);
  if (!match) return false;
  try {
    process.kill(Number(match[1]), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Takes the lock `name` (one per target), or confirms `holder` still owns it. Returns false while
// another live run holds it.
export function acquireLock(db, name, holder) {
  const acquire = db.transaction(() => {
    const lock = db.query("SELECT holder FROM target_lock WHERE name = $name").get({ name });
    if (lock?.holder === holder) return true;
    if (lock && holderIsAlive(lock.holder)) return false;

    db.query(
      `INSERT INTO target_lock (name, holder) VALUES ($name, $holder)
       ON CONFLICT (name) DO UPDATE SET holder = excluded.holder`,
    ).run({ name, holder });
    return true;
  });
  return acquire.immediate();
}

export function releaseLock(db, name, holder) {
  db.query("DELETE FROM target_lock WHERE name = $name AND holder = $holder").run({ name, holder });
}

// Run with the target's lock held: any in_progress row on it belongs to a run that died
// mid-evaluation. Rows that crashed a run `maxAttempts` times go to a human; returns their ids.
export function prepareTarget(db, { targetKey, expireAfterMs, maxAttempts, now = Date.now() }) {
  const prepare = db.transaction(() => {
    const recovered = db
      .query(
        `UPDATE permission_asks
         SET attempts = attempts + 1,
             status = CASE WHEN attempts + 1 >= $maxAttempts THEN 'need_human' ELSE 'pending' END,
             reason = CASE WHEN attempts + 1 >= $maxAttempts THEN 'runner crashed while evaluating'
                           ELSE reason END,
             decided_at = CASE WHEN attempts + 1 >= $maxAttempts THEN $now ELSE decided_at END
         WHERE status = 'in_progress' AND target_key = $targetKey
         RETURNING id, status`,
      )
      .all({ targetKey, maxAttempts, now: iso(now) });
    db.query(
      `UPDATE permission_asks
       SET status = 'stale', reason = 'expired before evaluation', decided_at = $now
       WHERE status = 'pending' AND target_key = $targetKey AND created_at < $cutoff`,
    ).run({ targetKey, now: iso(now), cutoff: iso(now - expireAfterMs) });
    return recovered.filter((row) => row.status === "need_human").map((row) => row.id);
  });
  return prepare.immediate();
}

export function deleteOldRows(db, { retentionMs, now = Date.now() }) {
  db.query("DELETE FROM permission_asks WHERE created_at < $cutoff AND status NOT IN ('pending', 'in_progress')").run({
    cutoff: iso(now - retentionMs),
  });
}

// Targets with work: pending rows, or in_progress rows a crashed run left behind.
export function openTargetKeys(db) {
  return db
    .query("SELECT DISTINCT target_key FROM permission_asks WHERE status IN ('pending', 'in_progress')")
    .all()
    .map((row) => row.target_key);
}

export function pendingAsks(db, targetKey) {
  return db
    .query(
      `SELECT id, created_at FROM permission_asks
       WHERE status = 'pending' AND target_key = $targetKey ORDER BY id`,
    )
    .all({ targetKey });
}

// Claims the oldest pending rows created before `claimableBefore`.
export function claimTarget(db, { targetKey, runId, limit, claimableBefore = Date.now() }) {
  const claim = db.transaction(() => {
    const rows = db
      .query(
        `SELECT * FROM permission_asks
         WHERE status = 'pending' AND target_key = $targetKey AND created_at <= $claimableBefore
         ORDER BY id LIMIT $limit`,
      )
      .all({ targetKey, limit, claimableBefore: iso(claimableBefore) });
    const markInProgress = db.query(
      "UPDATE permission_asks SET status = 'in_progress', run_id = $runId WHERE id = $id",
    );
    for (const row of rows) markInProgress.run({ runId, id: row.id });
    return rows.map(rowFromDb);
  });
  return claim.immediate();
}

// The most recent decided prompt on this target that may still be on screen: an escalation, or a
// dry-run approval, which sends no keys and so leaves its prompt up for the human.
export function awaitingHuman(db, { targetKey, since }) {
  const row = db
    .query(
      `SELECT * FROM permission_asks
       WHERE (status = 'need_human' OR (status = 'handled' AND dry_run = 1))
         AND target_key = $targetKey AND decided_at >= $since
       ORDER BY id DESC LIMIT 1`,
    )
    .get({ targetKey, since: iso(since) });
  return row ? rowFromDb(row) : null;
}

// Writes below only touch rows this run still holds, so a run that no longer holds a row cannot
// overwrite another run's verdict on it.
const OWNED_BY_RUN = "id = $id AND run_id = $runId AND status = 'in_progress'";

// `results` come from a validated evaluator run. A deferred row goes back to pending without
// counting as an attempt: it is waiting behind a prompt that only a human can answer.
// Returns the ids actually written; rows this run no longer holds are skipped.
export function recordResults(db, { runId, results, policyHash, dryRun, now = Date.now() }) {
  const record = db.transaction(() => {
    const decide = db.query(
      `UPDATE permission_asks
       SET status = $status, reason = $reason, policy_hash = $policyHash, dry_run = $dryRun,
           decided_at = $now
       WHERE ${OWNED_BY_RUN}`,
    );
    const defer = db.query(
      `UPDATE permission_asks SET status = 'pending', reason = $reason WHERE ${OWNED_BY_RUN}`,
    );

    const recordedIds = [];
    for (const { id, status, reason } of results) {
      const { changes } =
        status === "deferred"
          ? defer.run({ id, runId, reason })
          : decide.run({ id, runId, status, reason, policyHash, dryRun: dryRun ? 1 : 0, now: iso(now) });
      if (changes > 0) recordedIds.push(id);
    }
    return recordedIds;
  });
  return record.immediate();
}

// Returns the ids actually written; rows this run no longer holds are skipped. Rows that ran out
// of attempts become need_human.
export function recordFailure(db, { runId, ids, error, maxAttempts, policyHash, now = Date.now() }) {
  const record = db.transaction(() => {
    const recordedIds = [];
    const fail = db.query(
      `UPDATE permission_asks
       SET attempts = attempts + 1, reason = $reason,
           status = CASE WHEN attempts + 1 >= $maxAttempts THEN 'need_human' ELSE 'pending' END,
           decided_at = CASE WHEN attempts + 1 >= $maxAttempts THEN $now ELSE NULL END,
           policy_hash = $policyHash
       WHERE ${OWNED_BY_RUN}`,
    );
    for (const id of ids) {
      const { changes } = fail.run({
        id,
        runId,
        reason: `evaluator failed: ${error}`,
        maxAttempts,
        now: iso(now),
        policyHash,
      });
      if (changes > 0) recordedIds.push(id);
    }
    return recordedIds;
  });
  return record.immediate();
}

export function getAsks(db, ids) {
  const query = db.query("SELECT * FROM permission_asks WHERE id = $id");
  return ids.map((id) => rowFromDb(query.get({ id })));
}

export function statusCounts(db) {
  return db
    .query("SELECT status, COUNT(*) AS count FROM permission_asks GROUP BY status ORDER BY status")
    .all();
}
