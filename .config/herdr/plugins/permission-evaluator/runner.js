#!/usr/bin/env bun

// Drains the permission queue. The enqueue hook starts it for every new ask, and launchd starts it
// every minute as a sweep; a run that finds the lock held or nothing pending exits without
// starting Claude. Pending rows are grouped by target and each target gets one evaluator run; up
// to `maxConcurrentTargets` targets are evaluated at once. A run keeps going until no row it has
// not yet tried is pending, so asks that arrive mid-run are handled by that run.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireLock,
  awaitingHuman,
  claimTarget,
  getAsks,
  openQueue,
  pendingAsks,
  prepareQueue,
  recordFailure,
  recordResults,
  releaseLock,
  stateDirectory,
} from "./db.js";
import { evaluateTarget, loadPolicy, oneLine, policyHash } from "./evaluator.js";
import { HARNESSES } from "./harnesses/index.js";
import { TARGETS } from "./targets/index.js";

const MINUTE = 60_000;

const CONFIG = {
  dryRun: false,
  auditEnabled: true,
  notifyEnabled: true,
  model: "claude-haiku-5-5",
  maxRowsPerTarget: 10,
  maxConcurrentTargets: 3,
  baseTimeoutMs: 45_000,
  perRowTimeoutMs: 15_000,
  maxAttempts: 3,
  // The hook runs just before the dialog is drawn; younger rows could be misread as stale, so a
  // run waits until its rows are this old.
  minAgeMs: 5_000,
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

// Claims, evaluates and records one target. DB calls are synchronous, so concurrent targets
// interleave only while their evaluators run.
async function processTarget(targetKey, { db, runId, config, evaluate, notify, audit, pluginRoot, policy, policyDigest, attempted }) {
  // Another runner owns the queue once our lease is lost; claiming now could double-press enter.
  if (!acquireLock(db, runId, config.lockLeaseMs)) throw new Error("runner lock lost");

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

async function runWithConcurrency(items, limit, worker) {
  const remaining = [...items];
  const lanes = Array.from({ length: Math.min(limit, remaining.length) }, async () => {
    while (remaining.length > 0) await worker(remaining.shift());
  });
  await Promise.all(lanes);
}

function untriedAsks(db, attempted) {
  return pendingAsks(db).filter((ask) => !attempted.has(ask.id));
}

// One pass over the targets with an untried pending row, with the lock already held. Every row
// the pass claims is added to `attempted`. Dependencies are injectable for tests.
export async function drainQueue(db, {
  runId,
  attempted = new Set(),
  config = CONFIG,
  evaluate = evaluateTarget,
  notify = notifyHuman,
  audit = appendAudit,
  pluginRoot = import.meta.dir,
} = {}) {
  prepareQueue(db, config);
  const targetKeys = [...new Set(untriedAsks(db, attempted).map((ask) => ask.target_key))];
  if (targetKeys.length === 0) return;

  // A missing policy leaves every row pending; it expires to stale and the human answers.
  const policy = loadPolicy(pluginRoot);
  const context = {
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
  };

  await runWithConcurrency(targetKeys, config.maxConcurrentTargets, async (targetKey) => {
    // One target's failure must not stop the others; its claimed rows are recovered next run.
    try {
      await processTarget(targetKey, context);
    } catch (error) {
      log(`${targetKey} runner error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

// Repeats passes until no untried row is pending, waiting for rows that are still too young to
// claim. A row deferred or failed in this run is only retried alongside a newer ask on its target;
// otherwise the next run picks it up. Returns the highest pending id it last saw, so the caller
// can tell which asks arrived after its final check.
export async function drainUntilIdle(db, { attempted = new Set(), config = CONFIG, ...options }) {
  while (true) {
    const pending = pendingAsks(db);
    const lastSeenId = pending.at(-1)?.id ?? 0;
    const oldest = pending.find((ask) => !attempted.has(ask.id));
    if (!oldest) return lastSeenId;

    const claimableAt = Date.parse(oldest.created_at) + config.minAgeMs;
    const msUntilClaimable = claimableAt - Date.now();
    // Further ahead than minAgeMs means the wall clock stepped back; leave the row to a later run.
    if (msUntilClaimable > config.minAgeMs) return lastSeenId;
    if (msUntilClaimable > 0) await Bun.sleep(msUntilClaimable);

    // Check before the pass: once another runner owns the queue, even the pass's recovery of
    // in_progress rows would hand that runner's claims out a second time.
    if (!acquireLock(db, options.runId, config.lockLeaseMs)) return lastSeenId;

    const attemptedBefore = attempted.size;
    await drainQueue(db, { ...options, attempted, config });
    if (attempted.size > attemptedBefore) continue;

    // A pass that claimed nothing although the oldest row was claimable cannot progress (its
    // target's claim limit is filled by rows already tried); stop instead of spinning. A row
    // that is still too young, e.g. after a wall-clock step, gets another wait.
    const oldestIsClaimable = claimableAt <= Date.now();
    const stillOldest = untriedAsks(db, attempted)[0]?.id === oldest.id;
    if (stillOldest && oldestIsClaimable) return lastSeenId;
  }
}

async function main() {
  // Match launchd's Umask when the hook starts the runner: the logs can contain command text.
  process.umask(0o077);
  const db = openQueue();
  const runId = randomUUID();
  const attempted = new Set();

  while (acquireLock(db, runId, CONFIG.lockLeaseMs)) {
    let lastSeenId;
    try {
      lastSeenId = await drainUntilIdle(db, { runId, attempted });
    } finally {
      releaseLock(db, runId);
    }
    // A hook that enqueued just before the release saw our lock held and started no runner,
    // so pick its row up here. Each extra round needs a new ask, so this ends.
    const missedAsk = pendingAsks(db).some((ask) => ask.id > lastSeenId);
    if (!missedAsk) return;
  }
}

if (import.meta.main) {
  try {
    await main();
    // Exit explicitly: a pipe still held by a leftover evaluator grandchild would keep the process
    // alive, and launchd starts no new run while this one lives. Exiting also lets launchd reap it.
    process.exit(0);
  } catch (error) {
    log(`runner failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
