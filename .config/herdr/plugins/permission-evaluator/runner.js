#!/usr/bin/env bun

// Drains the permission queue, one target (pane) per process.
//
//   bun runner.js --target <key>   Started by the enqueue hook. Takes that target's lock (or exits
//                                  if another runner holds it) and keeps going until no row it has
//                                  not yet tried is pending, so asks that arrive mid-run are handled.
//   bun runner.js                  launchd's sweep, every minute: starts one runner per target with
//                                  pending rows, for asks whose own runner never started or that
//                                  were deferred.
//
// Targets have separate locks, so different panes are evaluated in parallel.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireLock,
  awaitingHuman,
  claimTarget,
  deleteOldRows,
  getAsks,
  openQueue,
  pendingAsks,
  pendingTargetKeys,
  prepareTarget,
  recordFailure,
  recordResults,
  releaseLock,
  stateDirectory,
} from "./db.js";
import { evaluateTarget, loadPolicy, oneLine, policyHash } from "./evaluator.js";
import { HARNESSES } from "./harnesses/index.js";
import { startRunner } from "./queue.js";
import { TARGETS } from "./targets/index.js";

const MINUTE = 60_000;

const CONFIG = {
  dryRun: false,
  auditEnabled: true,
  notifyEnabled: true,
  model: "claude-haiku-5-5",
  maxRowsPerTarget: 10,
  baseTimeoutMs: 45_000,
  perRowTimeoutMs: 15_000,
  maxAttempts: 3,
  // The hook runs just before the dialog is drawn; younger rows could be misread as stale, so a
  // run waits until its rows are this old.
  minAgeMs: 1_000,
  // A prompt still pending after this long was almost certainly answered by a human.
  expireAfterMs: 15 * MINUTE,
  lockLeaseMs: 10 * MINUTE,
  retentionMs: 30 * 24 * 60 * MINUTE,
};

const AUDIT_DECISIONS = {
  handled: (dryRun) => (dryRun ? "dry_run_would_approve" : "approved"),
  need_human: () => "human_review",
  stale: () => "stale",
};

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function appendAudit(entries) {
  if (!CONFIG.auditEnabled || entries.length === 0) return;

  const timestamp = new Date().toISOString();
  const lines = entries.map((entry) => `${JSON.stringify({ timestamp, ...entry })}\n`);
  appendFileSync(join(stateDirectory(), "audit.jsonl"), lines.join(""));
}

// Uses `on run argv` so the notification text is passed as data, never parsed as AppleScript.
function notifyHuman({ title, message }) {
  if (!CONFIG.notifyEnabled) return;

  spawnSync(
    "osascript",
    [
      "-e",
      "on run argv",
      "-e",
      "display notification (item 2 of argv) with title (item 1 of argv)",
      "-e",
      "end run",
      title,
      message,
    ],
    { stdio: "ignore", timeout: 5_000 },
  );
}

function auditEntry({ ask, result, target, outcome, durationMs, config, policyDigest }) {
  const entry = {
    paneId: target.pane_id ?? ask.target_key,
    askId: ask.id,
    harness: ask.harness,
    summary: ask.context.summary,
    dryRun: config.dryRun,
    policyHash: policyDigest,
    completed: Boolean(result),
    exitStatus: outcome.exitStatus,
    durationMs,
  };
  if (!result) return { ...entry, error: outcome.error };
  return { ...entry, decision: AUDIT_DECISIONS[result.status](config.dryRun), reason: result.reason };
}

// Claims, evaluates and records the target's oldest claimable rows, adding them to `attempted`.
// The caller holds the target's lock.
async function processTarget(targetKey, { db, runId, config, evaluate, notify, audit, pluginRoot, policy, policyDigest, attempted }) {
  const rows = claimTarget(db, {
    targetKey,
    runId,
    limit: config.maxRowsPerTarget,
    claimableBefore: Date.now() - config.minAgeMs,
  });
  if (rows.length === 0) return;
  for (const row of rows) attempted.add(row.id);

  const { target } = rows[0];
  const driver = TARGETS[target.type];
  const unknownHarness = rows.find((row) => !HARNESSES[row.harness])?.harness;
  let unsupported = null;
  if (!driver?.isValid(target)) unsupported = `unsupported target: ${targetKey}`;
  else if (unknownHarness) unsupported = `unsupported harness: ${unknownHarness}`;

  const startedAt = Date.now();
  const outcome = unsupported
    ? { results: null, error: unsupported }
    : await evaluate({
      driver,
      target,
      rows,
      awaitingHuman: awaitingHuman(db, { targetKey, since: Date.now() - config.expireAfterMs }),
      policy,
      config,
      pluginRoot,
    });
  const durationMs = Date.now() - startedAt;

  const recordedIds = outcome.results
    ? recordResults(db, { runId, results: outcome.results, policyHash: policyDigest, dryRun: config.dryRun })
    : recordFailure(db, {
      runId,
      ids: rows.map((row) => row.id),
      error: outcome.error,
      maxAttempts: config.maxAttempts,
      policyHash: policyDigest,
    });
  // Only rows this run actually wrote: if it lost them to another run, that run reports them.
  const recordedAsks = getAsks(db, recordedIds);

  // Notify before auditing so a failed audit write cannot swallow an escalation.
  for (const ask of recordedAsks.filter((row) => row.status === "need_human")) {
    notify({
      title: `Permission needs you (${targetKey})`,
      message: oneLine(`${ask.context.summary} — ${ask.reason}`).slice(0, 200),
    });
  }

  const resultById = new Map(outcome.results?.map((result) => [result.id, result]));
  const decidedAsks = recordedAsks.filter((ask) => resultById.get(ask.id)?.status !== "deferred");
  audit(
    decidedAsks.map((ask) =>
      auditEntry({ ask, result: resultById.get(ask.id), target, outcome, durationMs, config, policyDigest }),
    ),
  );

  const summary = outcome.results
    ? outcome.results.map((result) => `${result.id}=${result.status}`).join(" ")
    : `failed: ${outcome.error}`;
  log(`${targetKey} ${summary}`);
}

// A row dated in the future means the wall clock stepped back; it waits until the clock passes it.
function isUntried(ask, attempted) {
  return !attempted.has(ask.id) && Date.parse(ask.created_at) <= Date.now();
}

// Drains one target: claims and evaluates until no untried row is pending on it, waiting for rows
// that are still too young to claim. A row deferred or failed in this run is only retried
// alongside a newer ask; otherwise the next run picks it up. Returns the highest pending id it
// last saw, so the caller can tell which asks arrived after its final check. Dependencies are
// injectable for tests.
export async function drainTarget(db, {
  targetKey,
  runId,
  attempted = new Set(),
  config = CONFIG,
  evaluate = evaluateTarget,
  notify = notifyHuman,
  audit = appendAudit,
  pluginRoot = import.meta.dir,
}) {
  while (true) {
    const pending = pendingAsks(db, targetKey);
    const lastSeenId = pending.at(-1)?.id ?? 0;
    const oldest = pending.find((ask) => isUntried(ask, attempted));
    if (!oldest) return lastSeenId;

    const claimableAt = Date.parse(oldest.created_at) + config.minAgeMs;
    const msUntilClaimable = claimableAt - Date.now();
    if (msUntilClaimable > 0) await Bun.sleep(msUntilClaimable);

    // Check before recovering in_progress rows: once another runner owns this target, recovery
    // would hand that runner's claims out a second time.
    if (!acquireLock(db, targetKey, runId, config.lockLeaseMs)) return lastSeenId;
    prepareTarget(db, { targetKey, expireAfterMs: config.expireAfterMs });

    // A missing policy throws: the rows stay pending, expire to stale, and the human answers.
    const policy = loadPolicy(pluginRoot);
    const attemptedBefore = attempted.size;
    await processTarget(targetKey, {
      db,
      runId,
      config,
      evaluate,
      notify,
      audit,
      pluginRoot,
      policy,
      policyDigest: policyHash(policy),
      attempted,
    });
    if (attempted.size > attemptedBefore) continue;

    // A claim that took nothing new although the oldest row was claimable cannot progress (the
    // claim limit is filled by rows already tried); stop instead of spinning. A row that is still
    // too young, e.g. after a wall-clock step, gets another wait.
    const oldestIsClaimable = claimableAt <= Date.now();
    const stillOldest = pendingAsks(db, targetKey).find((ask) => isUntried(ask, attempted))?.id === oldest.id;
    if (stillOldest && oldestIsClaimable) return lastSeenId;
  }
}

async function runTarget(db, targetKey) {
  const runId = randomUUID();
  const attempted = new Set();

  while (acquireLock(db, targetKey, runId, CONFIG.lockLeaseMs)) {
    let lastSeenId;
    try {
      lastSeenId = await drainTarget(db, { targetKey, runId, attempted });
    } finally {
      releaseLock(db, targetKey, runId);
    }
    // A hook that enqueued just before the release saw our lock held and its runner exited,
    // so pick its row up here. Each extra round needs a new ask, so this ends.
    const missedAsk = pendingAsks(db, targetKey).some((ask) => ask.id > lastSeenId);
    if (!missedAsk) return;
  }
}

// launchd's sweep: starts one runner per target with pending rows. A target whose runner is
// still working keeps it, since the new one exits on the held lock.
function sweep(db) {
  deleteOldRows(db, CONFIG);
  for (const targetKey of pendingTargetKeys(db)) startRunner(targetKey);
}

if (import.meta.main) {
  const [flag, targetKey] = process.argv.slice(2);
  const isTargetRun = flag === "--target" && Boolean(targetKey);
  try {
    // Match launchd's Umask when the hook starts the runner: the logs can contain command text.
    process.umask(0o077);
    const db = openQueue();
    if (isTargetRun) await runTarget(db, targetKey);
    else sweep(db);
    // Exit explicitly: a pipe still held by a leftover evaluator grandchild would keep the process
    // alive, and launchd starts no new run while this one lives. Exiting also lets launchd reap it.
    process.exit(0);
  } catch (error) {
    const scope = isTargetRun ? targetKey : "sweep";
    log(`${scope} runner failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
