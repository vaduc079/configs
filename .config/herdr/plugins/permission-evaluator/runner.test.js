#!/usr/bin/env bun

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, getAsks, insertAsk, openQueue } from "./db.js";
import { drainQueue, drainUntilIdle } from "./runner.js";

const CONFIG = {
  dryRun: false,
  maxRowsPerTarget: 10,
  maxConcurrentTargets: 2,
  minAgeMs: 0,
  maxAttempts: 3,
  expireAfterMs: 15 * 60_000,
  lockLeaseMs: 60_000,
  retentionMs: 30 * 86_400_000,
};

function pluginRootWithPolicy() {
  const pluginRoot = mkdtempSync(join(tmpdir(), "permission-runner-"));
  writeFileSync(join(pluginRoot, "policy.md"), "Approve read-only commands.");
  return pluginRoot;
}

function addAsk(db, target = { type: "herdr", pane_id: "w1:p2" }) {
  return insertAsk(db, {
    harness: "claude",
    target,
    targetKey: `${target.type}:${target.pane_id}`,
    context: { summary: "Bash: ls" },
  });
}

async function run(db, evaluate) {
  const calls = { evaluate: [], notify: [], audit: [] };
  acquireLock(db, "run-1", CONFIG.lockLeaseMs);
  await drainQueue(db, {
    runId: "run-1",
    config: CONFIG,
    pluginRoot: pluginRootWithPolicy(),
    evaluate: (input) => {
      calls.evaluate.push(input);
      return evaluate(input);
    },
    notify: (notification) => calls.notify.push(notification),
    audit: (entries) => calls.audit.push(...entries),
  });
  return { calls };
}

describe("drainQueue", () => {
  test("does not start an evaluator when nothing is pending", async () => {
    const db = openQueue(":memory:");
    const { calls } = await run(db, () => {
      throw new Error("should not run");
    });

    expect(calls.evaluate).toEqual([]);
  });

  test("evaluates each target once with all of its rows in order", async () => {
    const db = openQueue(":memory:");
    const [a1, b1, a2] = [
      addAsk(db),
      addAsk(db, { type: "herdr", pane_id: "w1:p3" }),
      addAsk(db),
    ];

    const { calls } = await run(db, ({ rows }) => ({
      results: rows.map((row) => ({ id: row.id, status: "handled", reason: "safe" })),
      exitStatus: 0,
    }));

    expect(calls.evaluate.map((input) => input.rows.map((row) => row.id))).toEqual([[a1, a2], [b1]]);
    expect(getAsks(db, [a1, b1, a2]).map((ask) => ask.status)).toEqual(["handled", "handled", "handled"]);
    expect(calls.audit.map((entry) => entry.decision)).toEqual(["approved", "approved", "approved"]);
  });

  test("notifies escalations and keeps deferred rows pending without auditing them", async () => {
    const db = openQueue(":memory:");
    const [first, second] = [addAsk(db), addAsk(db)];

    const { calls } = await run(db, () => ({
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
    await run(db, () => ({ results: [{ id: first, status: "need_human", reason: "x" }], exitStatus: 0 }));

    const second = addAsk(db);
    const { calls } = await run(db, () => ({
      results: [{ id: second, status: "deferred", reason: "waiting" }],
      exitStatus: 0,
    }));

    expect(calls.evaluate[0].awaitingHuman.id).toBe(first);
  });

  test("returns rows to pending on evaluator failure", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);

    const { calls } = await run(db, () => ({ results: null, exitStatus: 1, error: "timeout" }));

    const [ask] = getAsks(db, [id]);
    expect(ask.status).toBe("pending");
    expect(ask.attempts).toBe(1);
    expect(calls.audit[0]).toMatchObject({ completed: false, error: "timeout" });
    expect(calls.notify).toEqual([]);
  });

  test("fails rows with an unsupported target without running the evaluator", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db, { type: "tmux", pane_id: "%1" });

    const { calls } = await run(db, () => {
      throw new Error("should not run");
    });

    expect(calls.evaluate).toEqual([]);
    expect(getAsks(db, [id])[0].reason).toBe("evaluator failed: unsupported target: tmux:%1");
  });
});

describe("drainQueue concurrency", () => {
  test("evaluates up to maxConcurrentTargets panes at once", async () => {
    const db = openQueue(":memory:");
    for (const pane of ["w1:p1", "w1:p2", "w1:p3", "w1:p4"]) addAsk(db, { type: "herdr", pane_id: pane });

    let inFlight = 0;
    let maxInFlight = 0;
    const { calls } = await run(db, async ({ rows }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(20);
      inFlight -= 1;
      return { results: rows.map((row) => ({ id: row.id, status: "handled", reason: "ok" })), exitStatus: 0 };
    });

    expect(calls.evaluate).toHaveLength(4);
    expect(maxInFlight).toBe(CONFIG.maxConcurrentTargets);
  });

  test("keeps going when one target throws", async () => {
    const db = openQueue(":memory:");
    const broken = addAsk(db, { type: "herdr", pane_id: "w1:p1" });
    const healthy = addAsk(db, { type: "herdr", pane_id: "w1:p2" });

    await run(db, async ({ rows }) => {
      if (rows[0].id === broken) throw new Error("boom");
      return { results: [{ id: healthy, status: "handled", reason: "ok" }], exitStatus: 0 };
    });

    expect(getAsks(db, [broken, healthy]).map((ask) => ask.status)).toEqual(["in_progress", "handled"]);
  });
});

describe("drainQueue lock", () => {
  test("stops claiming once another runner has taken the lock", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);
    acquireLock(db, "run-1", CONFIG.lockLeaseMs);
    // Simulates a lease that lapsed (e.g. during sleep) and was taken by another runner.
    db.query("UPDATE runner_lock SET holder = 'run-2'").run();

    const evaluated = [];
    await drainQueue(db, {
      runId: "run-1",
      config: CONFIG,
      pluginRoot: pluginRootWithPolicy(),
      evaluate: (input) => evaluated.push(input),
      notify: () => {},
      audit: () => {},
    });

    expect(evaluated).toEqual([]);
    expect(getAsks(db, [id])[0].status).toBe("pending");
  });
});

describe("drainQueue ownership", () => {
  test("fails rows from an unregistered harness without running the evaluator", async () => {
    const db = openQueue(":memory:");
    const id = insertAsk(db, {
      harness: "retired",
      target: { type: "herdr", pane_id: "w1:p2" },
      targetKey: "herdr:w1:p2",
      context: { summary: "Bash: ls" },
    });

    const { calls } = await run(db, () => {
      throw new Error("should not run");
    });

    expect(calls.evaluate).toEqual([]);
    expect(getAsks(db, [id])[0].reason).toBe("evaluator failed: unsupported harness: retired");
  });

  test("does not notify or audit rows another run took over mid-evaluation", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);

    const { calls } = await run(db, () => {
      db.query("UPDATE permission_asks SET run_id = 'run-2'").run();
      return { results: [{ id, status: "need_human", reason: "x" }], exitStatus: 0 };
    });

    expect(calls.notify).toEqual([]);
    expect(calls.audit).toEqual([]);
    expect(getAsks(db, [id])[0]).toMatchObject({ status: "in_progress", run_id: "run-2" });
  });
});

describe("drainUntilIdle", () => {
  function untilIdle(db, evaluate, config = CONFIG) {
    const evaluated = [];
    acquireLock(db, "run-1", config.lockLeaseMs);
    const done = drainUntilIdle(db, {
      runId: "run-1",
      config,
      pluginRoot: pluginRootWithPolicy(),
      evaluate: (input) => {
        evaluated.push(input.rows.map((row) => row.id));
        return evaluate(input);
      },
      notify: () => {},
      audit: () => {},
    });
    return done.then(() => ({ evaluated }));
  }

  const approveAll = ({ rows }) => ({
    results: rows.map((row) => ({ id: row.id, status: "handled", reason: "ok" })),
    exitStatus: 0,
  });

  test("handles an ask that arrives while the target is being evaluated", async () => {
    const db = openQueue(":memory:");
    const first = addAsk(db);
    let second;

    const { evaluated } = await untilIdle(db, (input) => {
      second ??= addAsk(db);
      return approveAll(input);
    });

    expect(evaluated).toEqual([[first], [second]]);
    expect(getAsks(db, [first, second]).map((ask) => ask.status)).toEqual(["handled", "handled"]);
  });

  test("does not retry deferred or failed rows in the same run", async () => {
    const db = openQueue(":memory:");
    const deferred = addAsk(db);
    const failed = addAsk(db, { type: "herdr", pane_id: "w1:p3" });

    const { evaluated } = await untilIdle(db, ({ rows }) =>
      rows[0].id === deferred
        ? { results: [{ id: deferred, status: "deferred", reason: "behind prompt" }], exitStatus: 0 }
        : { results: null, exitStatus: 1, error: "timeout" },
    );

    expect(evaluated).toEqual([[deferred], [failed]]);
    expect(getAsks(db, [deferred, failed]).map((ask) => ask.status)).toEqual(["pending", "pending"]);
  });

  test("waits for a young row instead of leaving it for the next run", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);
    const startedAt = Date.now();

    const { evaluated } = await untilIdle(db, approveAll, { ...CONFIG, minAgeMs: 100 });

    expect(evaluated).toEqual([[id]]);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90);
  });

  test("leaves a row dated in the future (wall clock stepped back) to a later run", async () => {
    const db = openQueue(":memory:");
    const id = insertAsk(db, {
      harness: "claude",
      target: { type: "herdr", pane_id: "w1:p2" },
      targetKey: "herdr:w1:p2",
      context: { summary: "Bash: ls" },
      now: Date.now() + 60 * 60_000,
    });

    const { evaluated } = await untilIdle(db, approveAll, { ...CONFIG, minAgeMs: 100 });

    expect(evaluated).toEqual([]);
    expect(getAsks(db, [id])[0].status).toBe("pending");
  });

  test("stops without touching the other runner's claims when the lock is lost", async () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);
    const theirs = addAsk(db, { type: "herdr", pane_id: "w1:p3" });
    db.query("UPDATE permission_asks SET status = 'in_progress', run_id = 'run-2' WHERE id = $id").run({ id: theirs });
    acquireLock(db, "run-1", CONFIG.lockLeaseMs);
    db.query("UPDATE runner_lock SET holder = 'run-2'").run();

    await drainUntilIdle(db, {
      runId: "run-1",
      config: CONFIG,
      pluginRoot: pluginRootWithPolicy(),
      evaluate: () => {
        throw new Error("should not run");
      },
      notify: () => {},
      audit: () => {},
    });

    expect(getAsks(db, [id, theirs]).map((ask) => ask.status)).toEqual(["pending", "in_progress"]);
  });
});
