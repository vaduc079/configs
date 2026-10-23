#!/usr/bin/env bun

import { describe, expect, test } from "bun:test";
import {
  acquireLock,
  awaitingHuman,
  claimTarget,
  deleteOldRows,
  getAsks,
  insertAsk,
  openQueue,
  pendingAsks,
  prepareTarget,
  recordFailure,
  recordResults,
  releaseLock,
} from "./db.js";
import { enqueue, runnerEnvironment, truncateStrings } from "./queue.js";

const HERDR_ENV = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2", HERDR_SOCKET_PATH: "/tmp/herdr.sock" };
const REX_ENV = {
  REX_BLOCK: "block:01a15a0d-8bef",
  REX_SESSION: "session:01a159d8",
  REX_SERVER: "unix:///Users/me/Library/Application%20Support/rex/server.sock",
  REX_BIN_DIR: "/Users/me/Library/Application Support/rex/Rex Server.app/Contents/MacOS",
};

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
    const { id, targetKey } = enqueue(db, { harnessName: "claude", hookInput: permissionRequest(), env: HERDR_ENV });

    expect(targetKey).toBe("herdr:w1:p2");
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

  test("stores a permission request for a Rex block", () => {
    const db = openQueue(":memory:");
    const { id, targetKey } = enqueue(db, { harnessName: "claude", hookInput: permissionRequest(), env: REX_ENV });

    expect(targetKey).toBe("rex:block:01a15a0d-8bef");
    expect(getAsks(db, [id])[0].target).toEqual({
      type: "rex",
      pane_id: "block:01a15a0d-8bef",
      server: REX_ENV.REX_SERVER,
      bin_dir: REX_ENV.REX_BIN_DIR,
      session_id: REX_ENV.REX_SESSION,
    });
  });

  test("prefers the Herdr pane when Herdr runs inside a Rex block", () => {
    const db = openQueue(":memory:");
    const { targetKey } = enqueue(db, {
      harnessName: "claude",
      hookInput: permissionRequest(),
      env: { ...REX_ENV, ...HERDR_ENV },
    });

    expect(targetKey).toBe("herdr:w1:p2");
  });

  test("skips Rex asks whose block, server or bin dir is unsafe", () => {
    const db = openQueue(":memory:");
    const unsafeEnvironments = [
      { ...REX_ENV, REX_BLOCK: "block:x; rm -rf /" },
      { ...REX_ENV, REX_SERVER: "unix:///tmp/rex.sock; rm -rf /" },
      { ...REX_ENV, REX_SERVER: undefined },
      { ...REX_ENV, REX_BIN_DIR: "/opt/rex:/tmp/evil" },
    ];

    for (const env of unsafeEnvironments) {
      expect(enqueue(db, { harnessName: "claude", hookInput: permissionRequest(), env })).toBeNull();
    }
  });

  test("approves a Slack message to an allowlisted channel without a runner", () => {
    const db = openQueue(":memory:");
    const hookInput = {
      ...permissionRequest(),
      tool_name: "mcp__slack__slack_send_message",
      tool_input: { channel_id: "C1", message: "hi" },
    };
    const queued = enqueue(db, { harnessName: "claude", hookInput, env: HERDR_ENV, rules: { slackChannels: ["C1"] } });

    expect(queued.decision.status).toBe("handled");
    const [ask] = getAsks(db, [queued.id]);
    expect(ask.status).toBe("handled");
    expect(ask.reason).toStartWith("rule slack-allowlisted-channel:");
    expect(pendingAsks(db, "herdr:w1:p2")).toEqual([]);
  });

  test("approves an allowlisted Slack message outside a multiplexer without storing it", () => {
    const db = openQueue(":memory:");
    const hookInput = {
      ...permissionRequest(),
      tool_name: "mcp__slack__slack_send_message",
      tool_input: { channel_id: "C1", message: "hi" },
    };
    const queued = enqueue(db, { harnessName: "claude", hookInput, env: {}, rules: { slackChannels: ["C1"] } });

    expect(queued).toEqual({ decision: expect.objectContaining({ status: "handled" }) });
  });

  test("queues a Slack message to another channel for the evaluator", () => {
    const db = openQueue(":memory:");
    const hookInput = {
      ...permissionRequest(),
      tool_name: "mcp__slack__slack_send_message",
      tool_input: { channel_id: "C2", message: "hi" },
    };
    const queued = enqueue(db, { harnessName: "claude", hookInput, env: HERDR_ENV, rules: { slackChannels: ["C1"] } });

    expect(queued.decision).toBeNull();
    expect(getAsks(db, [queued.id])[0].status).toBe("pending");
  });

  test("escalates AskUserQuestion without an evaluator run", () => {
    const db = openQueue(":memory:");
    const hookInput = { ...permissionRequest(), tool_name: "AskUserQuestion", tool_input: { questions: [] } };
    const queued = enqueue(db, { harnessName: "claude", hookInput, env: HERDR_ENV });

    expect(queued.decision.status).toBe("need_human");
    expect(getAsks(db, [queued.id])[0].status).toBe("need_human");
  });

  test("records a rule approval in dry run as a dry-run row", () => {
    const db = openQueue(":memory:");
    const hookInput = {
      ...permissionRequest(),
      tool_name: "mcp__slack__slack_send_message",
      tool_input: { channel_id: "C1", message: "hi" },
    };
    const queued = enqueue(db, {
      harnessName: "claude",
      hookInput,
      env: HERDR_ENV,
      rules: { slackChannels: ["C1"] },
      dryRun: true,
    });

    expect(getAsks(db, [queued.id])[0].dry_run).toBe(1);
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

    expect(Object.keys(environment).sort()).toEqual(["HOME", "PATH", "USER"]);
    expect(environment.PATH).not.toContain("/repo/node_modules/.bin");
  });

  test("truncates long strings anywhere in the context", () => {
    const truncated = truncateStrings({ a: ["x".repeat(5_000)], b: 1 });
    expect(truncated.a[0].length).toBeLessThan(4_100);
    expect(truncated.a[0].endsWith("…[truncated]")).toBe(true);
    expect(truncated.b).toBe(1);
  });
});

describe("target lock", () => {
  const live = (run) => `${process.pid}:${run}`;

  test("is exclusive per target while its holder lives, until released", () => {
    const db = openQueue(":memory:");

    expect(acquireLock(db, "herdr:p1", live("a"))).toBe(true);
    expect(acquireLock(db, "herdr:p1", live("b"))).toBe(false);
    expect(acquireLock(db, "herdr:p2", live("b"))).toBe(true);
    expect(acquireLock(db, "herdr:p1", live("a"))).toBe(true);

    releaseLock(db, "herdr:p1", live("a"));
    expect(acquireLock(db, "herdr:p1", live("c"))).toBe(true);
  });

  test("is free once its holder process is gone or the holder has no pid", () => {
    const db = openQueue(":memory:");

    acquireLock(db, "herdr:p1", "999999999:dead-run");
    expect(acquireLock(db, "herdr:p1", live("b"))).toBe(true);

    acquireLock(db, "herdr:p2", "12ab-uuid-without-pid");
    expect(acquireLock(db, "herdr:p2", live("b"))).toBe(true);
  });
});

describe("queue lifecycle", () => {
  const options = { targetKey: "herdr:w1:p2", expireAfterMs: 15 * 60_000, maxAttempts: 3 };

  function claimAll(db, runId = "r") {
    return claimTarget(db, { targetKey: "herdr:w1:p2", runId, limit: 10 });
  }

  test("recovers rows from a dead run and expires old pending rows, on its own target only", () => {
    const db = openQueue(":memory:");
    const now = Date.now();
    const old = addAsk(db, { now: now - 20 * 60_000 });
    const claimed = addAsk(db, { now });
    const otherClaimed = addAsk(db, { pane: "w1:p3", now });
    claimTarget(db, { targetKey: "herdr:w1:p2", runId: "dead", limit: 10, claimableBefore: now });
    claimTarget(db, { targetKey: "herdr:w1:p3", runId: "live", limit: 10, claimableBefore: now });
    const otherOld = addAsk(db, { pane: "w1:p3", now: now - 20 * 60_000 });

    prepareTarget(db, { ...options, now });

    const asks = getAsks(db, [old, claimed, otherOld, otherClaimed]);
    expect(asks.map((ask) => ask.status)).toEqual(["stale", "pending", "pending", "in_progress"]);
    expect(asks[1].attempts).toBe(1);
  });

  test("sends rows that crashed a run maxAttempts times to a human", () => {
    const db = openQueue(":memory:");
    const [crashing, fresh] = [addAsk(db), addAsk(db)];
    db.query("UPDATE permission_asks SET status = 'in_progress', attempts = 2 WHERE id = $id").run({ id: crashing });
    db.query("UPDATE permission_asks SET status = 'in_progress' WHERE id = $id").run({ id: fresh });

    const escalated = prepareTarget(db, options);

    expect(escalated).toEqual([crashing]);
    const asks = getAsks(db, [crashing, fresh]);
    expect(asks.map((ask) => ask.status)).toEqual(["need_human", "pending"]);
    expect(asks[0].reason).toBe("runner crashed while evaluating");
  });

  test("deletes only decided rows past retention", () => {
    const db = openQueue(":memory:");
    const now = Date.now();
    const [decided, pending] = [addAsk(db, { now: now - 40 * 86_400_000 }), addAsk(db, { now: now - 40 * 86_400_000 })];
    db.query("UPDATE permission_asks SET status = 'handled' WHERE id = $id").run({ id: decided });

    deleteOldRows(db, { retentionMs: 30 * 86_400_000, now });

    expect(getAsks(db, [pending])[0].status).toBe("pending");
    expect(db.query("SELECT COUNT(*) AS count FROM permission_asks WHERE id = $id").get({ id: decided }).count).toBe(0);
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
    prepareTarget(db, options);
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
