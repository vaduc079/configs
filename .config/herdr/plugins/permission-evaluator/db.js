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

    CREATE TABLE IF NOT EXISTS runner_lock (
      name       TEXT PRIMARY KEY,
      holder     TEXT NOT NULL,
      expires_at TEXT NOT NULL
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

// Holders are "<pid>:<run id>". A lease can expire while its holder still runs (the laptop slept
// mid-evaluation); taking the lock then would put two evaluators on one pane, so a live pid keeps
// it. A reused pid only delays the pane's next run until that process exits.
function holderIsAlive(holder) {
  const pid = Number.parseInt(holder, 10);
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Takes the lock `name` (one per target), or renews it when `holder` already owns it. Returns
// false while another run holds it: its lease is current or its process is still alive.
export function acquireLock(db, name, holder, leaseMs, now = Date.now()) {
  const acquire = db.transaction(() => {
    const lock = db
      .query("SELECT holder, expires_at FROM runner_lock WHERE name = $name")
      .get({ name });
    const leaseIsCurrent = lock && Date.parse(lock.expires_at) > now;
    const heldByOther = lock && lock.holder !== holder && (leaseIsCurrent || holderIsAlive(lock.holder));
    if (heldByOther) return false;

    db.query(
      `INSERT INTO runner_lock (name, holder, expires_at) VALUES ($name, $holder, $expiresAt)
       ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at`,
    ).run({ name, holder, expiresAt: iso(now + leaseMs) });
    return true;
  });
  return acquire.immediate();
}

export function releaseLock(db, name, holder) {
  db.query("DELETE FROM runner_lock WHERE name = $name AND holder = $holder").run({ name, holder });
}

// Run with the target's lock held: any in_progress row on it belongs to a run that died
// mid-evaluation.
export function prepareTarget(db, { targetKey, expireAfterMs, now = Date.now() }) {
  const prepare = db.transaction(() => {
    db.query(
      `UPDATE permission_asks SET status = 'pending', attempts = attempts + 1
       WHERE status = 'in_progress' AND target_key = $targetKey`,
    ).run({ targetKey });
    db.query(
      `UPDATE permission_asks
       SET status = 'stale', reason = 'expired before evaluation', decided_at = $now
       WHERE status = 'pending' AND target_key = $targetKey AND created_at < $cutoff`,
    ).run({ targetKey, now: iso(now), cutoff: iso(now - expireAfterMs) });
  });
  prepare.immediate();
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

// Writes below only touch rows this run still holds, so a run that lost its lease cannot
// overwrite the verdicts of the run that took over.
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
