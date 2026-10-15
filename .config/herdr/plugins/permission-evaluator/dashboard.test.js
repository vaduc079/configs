#!/usr/bin/env bun

import { describe, expect, test } from "bun:test";
import { askDetail, snapshot } from "./dashboard.js";
import { acquireLock, claimTarget, insertAsk, openQueue, recordResults } from "./db.js";

const CONFIG = { dryRun: false, model: "test-model", expireAfterMs: 15 * 60_000 };
const NOW = Date.parse("2026-10-15T12:00:00Z");

function addAsk(db, { pane = "w1:p2", summary = "Bash: ls", minutesAgo = 1 } = {}) {
  return insertAsk(db, {
    harness: "claude",
    sessionId: "s1",
    target: { type: "herdr", pane_id: pane },
    targetKey: `herdr:${pane}`,
    context: { tool: "Bash", summary, input: { command: "ls" }, cwd: "/repo" },
    now: NOW - minutesAgo * 60_000,
  });
}

function decide(db, { pane = "w1:p2", status, dryRun = false, reason = "because" }) {
  const runId = `run-${status}-${pane}`;
  const [row] = claimTarget(db, { targetKey: `herdr:${pane}`, runId, limit: 1, claimableBefore: NOW });
  recordResults(db, { runId, results: [{ id: row.id, status, reason }], policyHash: "p", dryRun, now: NOW - 30_000 });
  return row.id;
}

describe("snapshot", () => {
  test("splits open rows from history and leaves out the full context", () => {
    const db = openQueue(":memory:");
    addAsk(db, { summary: "Bash: git push" });
    decide(db, { status: "handled" });
    addAsk(db, { summary: "Bash: rm -rf build" });

    const view = snapshot(db, { now: NOW, config: CONFIG });

    expect(view.open.map((ask) => ask.summary)).toEqual(["Bash: rm -rf build"]);
    expect(view.history.map((ask) => ask.summary)).toEqual(["Bash: git push"]);
    expect(view.history[0]).toMatchObject({ pane_id: "w1:p2", tool: "Bash", cwd: "/repo", latency_ms: 30_000 });
    expect(view.history[0]).not.toHaveProperty("context");
  });

  test("marks whether each recent escalation's pane is still blocked", () => {
    const db = openQueue(":memory:");
    addAsk(db, { pane: "w1:p2" });
    decide(db, { pane: "w1:p2", status: "need_human" });
    addAsk(db, { pane: "w1:p3" });
    decide(db, { pane: "w1:p3", status: "need_human" });
    addAsk(db, { pane: "w1:p4" });
    decide(db, { pane: "w1:p4", status: "need_human" });
    const agents = [
      { pane_id: "w1:p2", agent: "claude", agent_status: "blocked" },
      { pane_id: "w1:p3", agent: "claude", agent_status: "working" },
    ];

    const view = snapshot(db, { now: NOW, config: CONFIG, agents });

    expect(view.needsYou.map((ask) => [ask.pane_id, ask.pane_status])).toEqual([
      ["w1:p4", "gone"],
      ["w1:p3", "working"],
      ["w1:p2", "blocked"],
    ]);
    expect(snapshot(db, { now: NOW, config: CONFIG }).needsYou[0].pane_status).toBe("unknown");
  });

  test("leaves escalations older than the expiry window out of needsYou", () => {
    const db = openQueue(":memory:");
    addAsk(db, { minutesAgo: 30 });
    decide(db, { status: "need_human" });

    expect(snapshot(db, { now: NOW + 20 * 60_000, config: CONFIG }).needsYou).toEqual([]);
  });

  test("lists blocked panes the queue has nothing current for", () => {
    const db = openQueue(":memory:");
    addAsk(db, { pane: "w1:p2" });
    const agents = [
      { pane_id: "w1:p2", agent: "claude", agent_status: "blocked" },
      { pane_id: "w1:p5", agent: "codex", agent_status: "blocked", terminal_title_stripped: "Refactor" },
      { pane_id: "w1:p6", agent: "claude", agent_status: "idle" },
    ];

    expect(snapshot(db, { now: NOW, config: CONFIG, agents }).untrackedBlocked).toEqual([
      { pane_id: "w1:p5", agent: "codex", title: "Refactor" },
    ]);
  });

  test("counts the last day by outcome, with dry runs apart from approvals", () => {
    const db = openQueue(":memory:");
    addAsk(db, { pane: "w1:p2" });
    decide(db, { pane: "w1:p2", status: "handled" });
    addAsk(db, { pane: "w1:p3" });
    decide(db, { pane: "w1:p3", status: "handled", dryRun: true });
    addAsk(db, { pane: "w1:p4" });
    decide(db, { pane: "w1:p4", status: "stale" });
    addAsk(db, { pane: "w1:p5" });
    addAsk(db, { pane: "w1:p6", minutesAgo: 25 * 60 });

    const { counts, hourly, approvalP50Ms } = snapshot(db, { now: NOW, config: CONFIG }).stats;

    expect(counts).toEqual({ handled: 1, dry_run: 1, need_human: 0, stale: 1, open: 1 });
    expect(hourly[23]).toEqual({ handled: 2, need_human: 0, stale: 1, open: 1 });
    expect(approvalP50Ms).toBe(30_000);
  });

  test("flags slow pending rows and claims without a live runner", () => {
    const db = openQueue(":memory:");
    addAsk(db, { pane: "w1:p2", minutesAgo: 5 });
    addAsk(db, { pane: "w1:p3" });
    claimTarget(db, { targetKey: "herdr:w1:p3", runId: "dead", limit: 1, claimableBefore: NOW });
    addAsk(db, { pane: "w1:p4" });
    acquireLock(db, "herdr:w1:p4", `${process.pid}:live`);
    claimTarget(db, { targetKey: "herdr:w1:p4", runId: "live", limit: 1, claimableBefore: NOW });

    const view = snapshot(db, { now: NOW, config: CONFIG });

    expect(view.queueHealth).toEqual({ slowPending: 1, orphanedClaims: 1 });
    expect(view.locks).toEqual([{ name: "herdr:w1:p4", holder: `${process.pid}:live`, alive: true }]);
  });
});

test("askDetail returns the full row with parsed JSON, or null", () => {
  const db = openQueue(":memory:");
  const id = addAsk(db);

  expect(askDetail(db, id)).toMatchObject({ id, target: { pane_id: "w1:p2" }, context: { input: { command: "ls" } } });
  expect(askDetail(db, id + 1)).toBeNull();
});
