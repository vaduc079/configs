#!/usr/bin/env bun

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, getAsks, insertAsk, openQueue } from "./db.js";
import { drainTarget, runTarget, sweep } from "./runner.js";

const CONFIG = {
  dryRun: false,
  maxRowsPerTarget: 10,
  minAgeMs: 0,
  maxAttempts: 3,
  expireAfterMs: 15 * 60_000,
};

const PANE = { type: "herdr", pane_id: "w1:p2" };
const TARGET_KEY = "herdr:w1:p2";

function pluginRootWithPolicy() {
  const pluginRoot = mkdtempSync(join(tmpdir(), "permission-runner-"));
  writeFileSync(join(pluginRoot, "policy.md"), "Approve read-only commands.");
  return pluginRoot;
}

function addAsk(db, { target = PANE, harness = "claude", now } = {}) {
  return insertAsk(db, {
    harness,
    target,
    targetKey: `${target.type}:${target.pane_id}`,
    context: { summary: "Bash: ls" },
    now,
  });
}

// Drains one target as run-1, recording every evaluator, notification and audit call.
async function drain(db, evaluate, { config = CONFIG, targetKey = TARGET_KEY } = {}) {
  const calls = { evaluate: [], notify: [], audit: [] };
  await drainTarget(db, {
    targetKey,
    runId: "run-1",
    config,
    pluginRoot: pluginRootWithPolicy(),
    evaluate: (input) => {
      calls.evaluate.push(input);
      return evaluate(input);
    },
    notify: (notification) => calls.notify.push(notification),
    audit: (entries) => calls.audit.push(...entries),
  });
  return calls;
}

const approveAll = ({ rows }) => ({
  results: rows.map((row) => ({ id: row.id, status: "handled", reason: "ok" })),
  exitStatus: 0,
});

const shouldNotRun = () => {
  throw new Error("should not run");
};

const evaluatedIds = (calls) => calls.evaluate.map((input) => input.rows.map((row) => row.id));

describe("drainTarget", () => {
  test("does not start an evaluator when nothing is pending", async () => {
    const db = openQueue(":memory:");
    const calls = await drain(db, shouldNotRun);

    expect(calls.evaluate).toEqual([]);
  });

  test("evaluates the target's rows in order in one call and leaves other targets alone", async () => {
    const db = openQueue(":memory:");
    const [first, other, second] = [addAsk(db), addAsk(db, { target: { type: "herdr", pane_id: "w1:p3" } }), addAsk(db)];

    const calls = await drain(db, approveAll);

    expect(evaluatedIds(calls)).toEqual([[first, second]]);
    expect(getAsks(db, [first, other, second]).map((ask) => ask.status)).toEqual(["handled", "pending", "handled"]);
    expect(calls.audit.map((entry) => entry.decision)).toEqual(["approved", "approved"]);
  });

  test("notifies escalations and keeps deferred rows pending without auditing them", async () => {
    const db = openQueue(":memory:");
    const [first, second] = [addAsk(db), addAsk(db)];

    const calls = await drain(db, () => ({
      results: [
        { id: first, status: "need_human", reason: "pushes to remote" },
        { id: second, status: "deferred", reason: "behind prompt" },
      ],
      exitStatus: 0,
    }));

    expect(getAsks(db, [first, second]).map((ask) => ask.status)).toEqual(["need_human", "pending"]);
    expect(calls.notify).toHaveLength(1);
    expect(calls.notify[0].message).toContain("pushes to remote");
    expect(calls.audit.map((entry) => entry.askId)).toEqual([first]);
  });

  test("passes the open escalation so the evaluator can defer behind it", async () => {
    const db = openQueue(":memory:");
    const first = addAsk(db);
    await drain(db, () => ({ results: [{ id: first, status: "need_human", reason: "x" }], exitStatus: 0 }));

    const second = addAsk(db);
    const calls = await drain(db, () => ({ results: [{ id: second, status: "deferred", reason: "waiting" }], exitStatus: 0 }));

    expect(calls.evaluate[0].awaitingHuman.id).toBe(first);
  });

  test("returns rows to pending on evaluator failure and does not retry them in the same run", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);

    const calls = await drain(db, () => ({ results: null, exitStatus: 1, error: "timeout" }));

    expect(getAsks(db, [id])[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(calls.evaluate).toHaveLength(1);
    expect(calls.audit[0]).toMatchObject({ completed: false, error: "timeout" });
    expect(calls.notify).toEqual([]);
  });

  test("fails rows from an unregistered harness without running the evaluator", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db, { harness: "retired" });

    const calls = await drain(db, shouldNotRun);

    expect(calls.evaluate).toEqual([]);
    expect(getAsks(db, [id])[0].reason).toBe("evaluator failed: unsupported harness: retired");
  });

  test("fails rows with an unsupported target without running the evaluator", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db, { target: { type: "tmux", pane_id: "%1" } });

    const calls = await drain(db, shouldNotRun, { targetKey: "tmux:%1" });

    expect(calls.evaluate).toEqual([]);
    expect(getAsks(db, [id])[0].reason).toBe("evaluator failed: unsupported target: tmux:%1");
  });

  test("recovers a crashed run's claims even when nothing else is pending", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);
    db.query("UPDATE permission_asks SET status = 'in_progress', run_id = 'crashed' WHERE id = $id").run({ id });

    const calls = await drain(db, approveAll);

    expect(evaluatedIds(calls)).toEqual([[id]]);
    expect(getAsks(db, [id])[0]).toMatchObject({ status: "handled", attempts: 1 });
  });

  test("does not notify or audit rows another run took over mid-evaluation", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);

    const calls = await drain(db, () => {
      // run-1's lease lapsed and run-2 took the lock and the row.
      db.query("UPDATE target_lock SET holder = $holder").run({ holder: `${process.pid}:run-2` });
      db.query("UPDATE permission_asks SET run_id = 'run-2'").run();
      return { results: [{ id, status: "need_human", reason: "x" }], exitStatus: 0 };
    });

    expect(calls.notify).toEqual([]);
    expect(calls.audit).toEqual([]);
    expect(getAsks(db, [id])[0]).toMatchObject({ status: "in_progress", run_id: "run-2" });
  });

  test("leaves claimed rows in progress when the evaluator throws, for the next run to recover", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);

    await expect(drain(db, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");

    expect(getAsks(db, [id])[0].status).toBe("in_progress");
  });
});

describe("drainTarget loop", () => {
  test("handles an ask that arrives while the target is being evaluated", async () => {
    const db = openQueue(":memory:");
    const first = addAsk(db);
    let second;

    const calls = await drain(db, (input) => {
      second ??= addAsk(db);
      return approveAll(input);
    });

    expect(evaluatedIds(calls)).toEqual([[first], [second]]);
    expect(getAsks(db, [first, second]).map((ask) => ask.status)).toEqual(["handled", "handled"]);
  });

  test("waits for a young row instead of leaving it for the next run", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);
    const startedAt = Date.now();

    const calls = await drain(db, approveAll, { config: { ...CONFIG, minAgeMs: 100 } });

    expect(evaluatedIds(calls)).toEqual([[id]]);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90);
  });

  test("skips a row dated in the future (wall clock stepped back) without blocking newer rows", async () => {
    const db = openQueue(":memory:");
    const future = addAsk(db, { now: Date.now() + 60 * 60_000 });
    const current = addAsk(db);

    const calls = await drain(db, approveAll, { config: { ...CONFIG, minAgeMs: 100 } });

    expect(evaluatedIds(calls)).toEqual([[current]]);
    expect(getAsks(db, [future, current]).map((ask) => ask.status)).toEqual(["pending", "handled"]);
  });

  test("stops without touching the other runner's claims when the target's lock is held", async () => {
    const db = openQueue(":memory:");
    const theirs = addAsk(db);
    db.query("UPDATE permission_asks SET status = 'in_progress', run_id = 'run-2' WHERE id = $id").run({ id: theirs });
    const ours = addAsk(db);
    acquireLock(db, TARGET_KEY, `${process.pid}:run-2`);

    const calls = await drain(db, shouldNotRun);

    expect(calls.evaluate).toEqual([]);
    expect(getAsks(db, [theirs, ours]).map((ask) => ask.status)).toEqual(["in_progress", "pending"]);
  });

  test("is not blocked by another target's lock", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);
    acquireLock(db, "herdr:w1:p3", `${process.pid}:run-2`);

    const calls = await drain(db, approveAll);

    expect(evaluatedIds(calls)).toEqual([[id]]);
  });
});

describe("runTarget", () => {
  test("retakes the lock when an ask arrived after the drain's final check", async () => {
    const db = openQueue(":memory:");
    let rounds = 0;
    let lateAsk;

    await runTarget(db, TARGET_KEY, {
      drain: async () => {
        rounds += 1;
        if (rounds > 1) return lateAsk;
        // The drain saw nothing, then a hook inserted; its runner found our lock held and exited.
        lateAsk = addAsk(db);
        return 0;
      },
    });

    expect(rounds).toBe(2);
  });
});

describe("sweep", () => {
  test("starts one runner per target with pending or in-progress rows", () => {
    const db = openQueue(":memory:");
    addAsk(db);
    addAsk(db);
    const crashed = addAsk(db, { target: { type: "herdr", pane_id: "w1:p3" } });
    db.query("UPDATE permission_asks SET status = 'in_progress' WHERE id = $id").run({ id: crashed });
    const decided = addAsk(db, { target: { type: "herdr", pane_id: "w1:p4" } });
    db.query("UPDATE permission_asks SET status = 'handled' WHERE id = $id").run({ id: decided });

    const started = [];
    sweep(db, { start: (targetKey) => started.push(targetKey) });

    expect(started.sort()).toEqual(["herdr:w1:p2", "herdr:w1:p3"]);
  });
});
