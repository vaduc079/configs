#!/usr/bin/env bun

// Drains the permission queue. launchd starts it every minute; a run that finds the lock held
// or nothing pending exits without starting Claude. Pending rows are grouped by target and each
// target gets one evaluator run; up to `maxConcurrentTargets` targets are evaluated at once.

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
  pendingTargetKeys,
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
  // The hook runs just before the dialog is drawn; younger rows could be misread as stale.
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
async function processTarget(targetKey, { db, runId, config, evaluate, notify, audit, pluginRoot, policy, policyDigest }) {
  // Another runner owns the queue once our lease is lost; claiming now could double-press enter.
  if (!acquireLock(db, runId, config.lockLeaseMs)) throw new Error("runner lock lost");

  const rows = claimTarget(db, {
    targetKey,
    runId,
    limit: config.maxRowsPerTarget,
    claimableBefore: Date.now() - config.minAgeMs,
  });
  if (rows.length === 0) return;

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

// One pass over the queue with the lock already held. Dependencies are injectable for tests.
export async function drainQueue(db, {
  runId,
  config = CONFIG,
  evaluate = evaluateTarget,
  notify = notifyHuman,
  audit = appendAudit,
  pluginRoot = import.meta.dir,
} = {}) {
  prepareQueue(db, config);
  const targetKeys = pendingTargetKeys(db);
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

async function main() {
  const db = openQueue();
  const runId = randomUUID();
  if (!acquireLock(db, runId, CONFIG.lockLeaseMs)) return;

  try {
    await drainQueue(db, { runId });
  } finally {
    releaseLock(db, runId);
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
