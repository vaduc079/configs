import { describe, expect, test } from "bun:test";
import {
  agentIdentity,
  agentView,
  durationDeadline,
  nextRefreshAt,
  reconcileSnoozes,
  snoozeLease,
  statusRank,
  titleTokens,
  tomorrowAt,
} from "./core.js";

const agent = (overrides = {}) => ({
  terminal_id: "term-1",
  pane_id: "w1:p1",
  agent_status: "working",
  terminal_title_stripped: "Implement sidebar",
  ...overrides,
});

describe("identity and ordering", () => {
  test("prefers a native session identity", () => {
    const identity = agentIdentity(agent({
      agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "abc" },
    }));
    expect(identity).toBe("session:herdr:codex:codex:id:abc");
  });

  test("orders attention, idle, unknown, then working", () => {
    expect(["blocked", "done", "idle", "unknown", "working"].map(statusRank)).toEqual(["0", "1", "2", "3", "4"]);
    expect(agentView().sort).toEqual([
      { field: "status", order: "asc" },
      { field: "workspace_order", order: "asc" },
      { field: "tab_order", order: "asc" },
      { field: "pane_order", order: "asc" },
    ]);
  });
});

describe("snooze lifecycle", () => {
  test("keeps an active snooze while an agent is working", () => {
    const snoozes = { "terminal:term-1": { until_ms: 2_000, pane_id: "w1:p1" } };
    const current = agent({ tokens: { sidebar_snoozed: "true" } });
    expect(reconcileSnoozes(snoozes, [current], 1_000).snoozes).toEqual(snoozes);
  });

  test.each(["blocked", "done"])("clears snooze when status becomes %s", (status) => {
    const snoozes = { "terminal:term-1": { until_ms: 2_000 } };
    const result = reconcileSnoozes(
      snoozes,
      [agent({ agent_status: status, tokens: { sidebar_snoozed: "true" } })],
      1_000,
    );
    expect(result.snoozes).toEqual({});
    expect(result.ended[0].reason).toBe(status);
  });

  test("clears snooze at its deadline", () => {
    const snoozes = { "terminal:term-1": { until_ms: 1_000 } };
    const result = reconcileSnoozes(snoozes, [agent()], 1_000);
    expect(result.snoozes).toEqual({});
    expect(result.ended[0].reason).toBe("expired");
  });

  test("missing marker permanently clears snooze during normal reconciliation", () => {
    const snoozes = { "terminal:term-1": { until_ms: 2_000 } };
    const result = reconcileSnoozes(snoozes, [agent()], 1_000);
    expect(result.snoozes).toEqual({});
    expect(result.ended[0].reason).toBe("marker_missing");
  });

  test("startup may restore an unexpired missing marker", () => {
    const snoozes = { "terminal:term-1": { until_ms: 2_000 } };
    const result = reconcileSnoozes(snoozes, [agent()], 1_000, { restoreMissingMarkers: true });
    expect(result.snoozes["terminal:term-1"]).toEqual({ until_ms: 2_000, pane_id: "w1:p1" });
    expect(result.restore).toHaveLength(1);
  });
});

describe("presentation", () => {
  test("uses a dimmable background title outside attention states", () => {
    expect(titleTokens(agent())).toEqual({
      sidebar_attention_title: null,
      sidebar_background_title: "Implement sidebar",
      sidebar_rank: null,
    });
  });

  test("uses a bright title and removes snooze in attention states", () => {
    expect(titleTokens(agent({ agent_status: "blocked" }))).toEqual({
      sidebar_attention_title: "Implement sidebar",
      sidebar_background_title: null,
      sidebar_rank: null,
    });
  });
});

describe("deadlines", () => {
  test("uses an exact TTL and no sleeper for a short snooze", () => {
    expect(snoozeLease(3_601_000, 1_000)).toEqual({
      ttlMs: 3_600_000,
      tokenUntilMs: 3_601_000,
      refreshAtMs: null,
    });
  });

  test("uses a 24-hour lease with a 12-hour renewal for a long snooze", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(snoozeLease(3 * day, 0)).toEqual({
      ttlMs: day,
      tokenUntilMs: day,
      refreshAtMs: day / 2,
    });
    expect(nextRefreshAt({ one: { until_ms: 3 * day, token_until_ms: day } })).toBe(day / 2);
  });

  test("the final lease has no successor sleeper", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(snoozeLease(3 * day, 2 * day)).toEqual({
      ttlMs: day,
      tokenUntilMs: 3 * day,
      refreshAtMs: null,
    });
  });

  test("supports fractional custom hours", () => {
    expect(durationDeadline(1_000, 1.5)).toBe(5_401_000);
  });

  test("tomorrow means the next calendar day at configured local time", () => {
    const now = new Date(2026, 9, 18, 7, 30);
    expect(tomorrowAt(now, "09:00")).toEqual(new Date(2026, 9, 19, 9, 0));
  });
});
