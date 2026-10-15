#!/usr/bin/env bun

import { describe, expect, test } from "bun:test";
import {
  acquireLock,
  awaitingHuman,
  claimTarget,
  getAsks,
  insertAsk,
  openQueue,
  pendingAsks,
  prepareQueue,
  recordFailure,
  recordResults,
  releaseLock,
} from "./db.js";
import { enqueue, runnerEnvironment, truncateStrings } from "./queue.js";

const HERDR_ENV = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2", HERDR_SOCKET_PATH: "/tmp/herdr.sock" };

function permissionRequest(command = "git push") {
  return {
    hook_event_name: "PermissionRequest",
    session_id: "s1",
    cwd: "/repo",
    tool_name: "Bash",
    tool_input: { command, description: "Push" },
  };
}

function addAsk(db, { pane = "w1:p2", now = Date.now() } = {}) {
  return insertAsk(db, {
    harness: "claude",
    sessionId: "s1",
    target: { type: "herdr", pane_id: pane },
    targetKey: `herdr:${pane}`,
    context: { summary: "Bash: ls" },
    now,
  });
}

describe("enqueue", () => {
  test("stores a Claude permission request for a herdr pane", () => {
    const db = openQueue(":memory:");
    const id = enqueue(db, { harnessName: "claude", hookInput: permissionRequest(), env: HERDR_ENV });

    const [ask] = getAsks(db, [id]);
    expect(ask.status).toBe("pending");
    expect(ask.target_key).toBe("herdr:w1:p2");
    expect(ask.target).toEqual({ type: "herdr", pane_id: "w1:p2", socket_path: "/tmp/herdr.sock" });
    expect(ask.context.summary).toBe("Bash: git push");
    expect(ask.context.input.command).toBe("git push");
  });

  test("keeps every consecutive ask as its own row", () => {
    const db = openQueue(":memory:");
    for (const command of ["git add .", "git commit", "git push"]) {
      enqueue(db, { harnessName: "claude", hookInput: permissionRequest(command), env: HERDR_ENV });
    }

    const rows = claimTarget(db, { targetKey: "herdr:w1:p2", runId: "r", limit: 10 });
    expect(rows.map((row) => row.context.input.command)).toEqual(["git add .", "git commit", "git push"]);
  });

  test("skips asks outside a multiplexer, other hook events and unsafe pane IDs", () => {
    const db = openQueue(":memory:");
    const outsideHerdr = enqueue(db, { harnessName: "claude", hookInput: permissionRequest(), env: {} });
    const otherEvent = enqueue(db, {
      harnessName: "claude",
      hookInput: { ...permissionRequest(), hook_event_name: "PreToolUse" },
      env: HERDR_ENV,
    });
    const unsafePane = enqueue(db, {
      harnessName: "claude",
      hookInput: permissionRequest(),
      env: { ...HERDR_ENV, HERDR_PANE_ID: "w1:p2; rm -rf /" },
    });

    expect([outsideHerdr, otherEvent, unsafePane]).toEqual([null, null, null]);
    expect(pendingAsks(db)).toEqual([]);
  });

  test("rejects unknown harnesses", () => {
    const db = openQueue(":memory:");
    expect(() => enqueue(db, { harnessName: "nope", hookInput: {}, env: HERDR_ENV })).toThrow();
  });

  test("gives the runner launchd's environment, not the agent session's", () => {
    const environment = runnerEnvironment({
      HOME: "/Users/me",
      USER: "me",
      PATH: "/repo/node_modules/.bin:/usr/bin",
      CLAUDECODE: "1",
      ANTHROPIC_BASE_URL: "http://evil",
      HERDR_PANE_ID: "w1:p2",
    });

    expect(environment).toEqual({
      HOME: "/Users/me",
      USER: "me",
      PATH: "/Users/me/.local/bin:/Users/me/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    });
  });

  test("truncates long strings anywhere in the context", () => {
    const truncated = truncateStrings({ a: ["x".repeat(5_000)], b: 1 });
    expect(truncated.a[0].length).toBeLessThan(4_100);
    expect(truncated.a[0].endsWith("…[truncated]")).toBe(true);
    expect(truncated.b).toBe(1);
  });
});

describe("runner lock", () => {
  test("is exclusive until released or expired, and renewable by its holder", () => {
    const db = openQueue(":memory:");
    const now = Date.now();

    expect(acquireLock(db, "a", 60_000, now)).toBe(true);
    expect(acquireLock(db, "b", 60_000, now)).toBe(false);
    expect(acquireLock(db, "a", 60_000, now)).toBe(true);
    expect(acquireLock(db, "b", 60_000, now + 61_000)).toBe(true);

    releaseLock(db, "b");
    expect(acquireLock(db, "c", 60_000, now)).toBe(true);
  });
});

describe("queue lifecycle", () => {
  const options = { expireAfterMs: 15 * 60_000, retentionMs: 30 * 86_400_000 };

  function claimAll(db, runId = "r") {
    return claimTarget(db, { targetKey: "herdr:w1:p2", runId, limit: 10 });
  }

  test("recovers rows from a dead run and expires old pending rows", () => {
    const db = openQueue(":memory:");
    const now = Date.now();
    const old = addAsk(db, { now: now - 20 * 60_000 });
    const claimed = addAsk(db, { pane: "w1:p3", now });
    claimTarget(db, { targetKey: "herdr:w1:p3", runId: "dead", limit: 10 });

    prepareQueue(db, { ...options, now });

    const [oldAsk, claimedAsk] = getAsks(db, [old, claimed]);
    expect(oldAsk.status).toBe("stale");
    expect(claimedAsk.status).toBe("pending");
    expect(claimedAsk.attempts).toBe(1);
  });

  test("leaves rows younger than claimableBefore for a later run", () => {
    const db = openQueue(":memory:");
    const now = Date.now();
    const settled = addAsk(db, { now: now - 10_000 });
    addAsk(db, { now });

    const rows = claimTarget(db, { targetKey: "herdr:w1:p2", runId: "r", limit: 10, claimableBefore: now - 5_000 });
    expect(rows.map((row) => row.id)).toEqual([settled]);
  });

  test("records verdicts and puts deferred rows back to pending", () => {
    const db = openQueue(":memory:");
    const [first, second, third] = [addAsk(db), addAsk(db), addAsk(db)];
    claimAll(db);

    recordResults(db, {
      runId: "r",
      results: [
        { id: first, status: "handled", reason: "safe" },
        { id: second, status: "need_human", reason: "push" },
        { id: third, status: "deferred", reason: "behind prompt" },
      ],
      policyHash: "abc",
      dryRun: false,
    });

    const asks = getAsks(db, [first, second, third]);
    expect(asks.map((ask) => ask.status)).toEqual(["handled", "need_human", "pending"]);
    expect(asks[2].attempts).toBe(0);
    expect(awaitingHuman(db, { targetKey: "herdr:w1:p2", since: Date.now() - 60_000 }).id).toBe(second);
  });

  test("ignores writes from a run that no longer holds the row", () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);
    claimAll(db, "old-run");
    prepareQueue(db, options);
    claimAll(db, "new-run");

    const recorded = recordResults(db, {
      runId: "old-run",
      results: [{ id, status: "handled", reason: "late" }],
      policyHash: "abc",
      dryRun: false,
    });
    const failed = recordFailure(db, { runId: "old-run", ids: [id], error: "late", maxAttempts: 1, policyHash: "abc" });

    expect(recorded).toEqual([]);
    expect(failed).toEqual([]);
    expect(getAsks(db, [id])[0]).toMatchObject({ status: "in_progress", run_id: "new-run" });
  });

  test("treats a dry-run approval as still on screen, but not a real one", () => {
    const db = openQueue(":memory:");
    const [dryRun, real] = [addAsk(db), addAsk(db, { pane: "w1:p3" })];
    claimAll(db);
    claimTarget(db, { targetKey: "herdr:w1:p3", runId: "r", limit: 10 });
    const handled = (id) => [{ id, status: "handled", reason: "ok" }];

    recordResults(db, { runId: "r", results: handled(dryRun), policyHash: "abc", dryRun: true });
    recordResults(db, { runId: "r", results: handled(real), policyHash: "abc", dryRun: false });

    const since = Date.now() - 60_000;
    expect(awaitingHuman(db, { targetKey: "herdr:w1:p2", since })?.id).toBe(dryRun);
    expect(awaitingHuman(db, { targetKey: "herdr:w1:p3", since })).toBeNull();
  });

  test("escalates rows after repeated evaluator failures", () => {
    const db = openQueue(":memory:");
    const id = addAsk(db);
    const fail = () => {
      claimAll(db);
      return recordFailure(db, { runId: "r", ids: [id], error: "timeout", maxAttempts: 2, policyHash: "abc" });
    };

    expect(fail()).toEqual([id]);
    expect(getAsks(db, [id])[0].status).toBe("pending");
    expect(fail()).toEqual([id]);

    const [ask] = getAsks(db, [id]);
    expect(ask.status).toBe("need_human");
    expect(ask.reason).toBe("evaluator failed: timeout");
  });
});
