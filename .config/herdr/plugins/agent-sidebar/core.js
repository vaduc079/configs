export const ATTENTION_STATUSES = new Set(["blocked", "done"]);
export const MAX_SNOOZE_TTL_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_REFRESH_MARGIN_MS = 12 * 60 * 60 * 1000;

export function agentIdentity(agent) {
  const session = agent?.agent_session;
  if (session?.source && session?.agent && session?.kind && session?.value) {
    return ["session", session.source, session.agent, session.kind, session.value].join(":");
  }
  return agent?.terminal_id ? `terminal:${agent.terminal_id}` : "";
}

export function statusRank(status) {
  return {
    blocked: "0",
    done: "1",
    idle: "2",
    unknown: "3",
    working: "4",
  }[status] ?? "5";
}

export function snoozeLease(untilMs, nowMs) {
  const remainingMs = untilMs - nowMs;
  if (remainingMs <= 0) return null;

  const ttlMs = Math.min(remainingMs, MAX_SNOOZE_TTL_MS);
  const tokenUntilMs = nowMs + ttlMs;
  return {
    ttlMs: Math.max(1, Math.ceil(ttlMs)),
    tokenUntilMs,
    refreshAtMs: tokenUntilMs < untilMs
      ? tokenUntilMs - SNOOZE_REFRESH_MARGIN_MS
      : null,
  };
}

export function nextRefreshAt(snoozes) {
  let earliest = null;
  for (const snooze of Object.values(snoozes)) {
    if (!snooze.token_until_ms || snooze.token_until_ms >= snooze.until_ms) continue;
    const refreshAt = snooze.token_until_ms - SNOOZE_REFRESH_MARGIN_MS;
    earliest = earliest == null ? refreshAt : Math.min(earliest, refreshAt);
  }
  return earliest;
}

export function reconcileSnoozes(
  snoozes,
  agents,
  nowMs = Date.now(),
  { restoreMissingMarkers = false } = {},
) {
  const next = structuredClone(snoozes);
  const ended = [];
  const restore = [];
  const agentsByIdentity = new Map(agents.map((agent) => [agentIdentity(agent), agent]));

  for (const [identity, snooze] of Object.entries(next)) {
    const agent = agentsByIdentity.get(identity);
    if (!agent) {
      delete next[identity];
      ended.push({ identity, pane_id: snooze.pane_id, reason: "agent_gone" });
      continue;
    }

    const expired = snooze.until_ms <= nowMs;
    const needsAttention = ATTENTION_STATUSES.has(agent.agent_status);
    const markerPresent = agent.tokens?.sidebar_snoozed === "true";
    const markerMissing = !markerPresent && !restoreMissingMarkers;
    if (!expired && !needsAttention && !markerMissing) {
      snooze.pane_id = agent.pane_id;
      if (!markerPresent) restore.push({ identity, agent, snooze });
      continue;
    }

    delete next[identity];
    ended.push({
      identity,
      pane_id: agent.pane_id,
      reason: expired ? "expired" : needsAttention ? agent.agent_status : "marker_missing",
    });
  }

  return { snoozes: next, ended, restore };
}

export function titleTokens(agent) {
  const title = String(agent?.terminal_title_stripped ?? "").trim();
  const attention = ATTENTION_STATUSES.has(agent?.agent_status);

  return {
    sidebar_attention_title: attention && title ? title : null,
    sidebar_background_title: !attention && title ? title : null,
    sidebar_rank: null,
  };
}

export function tomorrowAt(now, configuredTime) {
  const match = /^(\d{2}):(\d{2})$/.exec(configuredTime);
  if (!match) throw new Error(`Invalid tomorrow_time ${JSON.stringify(configuredTime)}; expected HH:MM`);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid tomorrow_time ${JSON.stringify(configuredTime)}; expected HH:MM`);
  }

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    hour,
    minute,
    0,
    0,
  );
}

export function durationDeadline(nowMs, hours) {
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("Hours must be a positive number");
  return nowMs + hours * 60 * 60 * 1000;
}

export function agentView() {
  return {
    source: "plugin:local.agent-sidebar",
    label: "queue",
    filter: {
      op: "any",
      filters: [
        { op: "in", field: "status", values: ["blocked", "done"] },
        {
          op: "not",
          filter: {
            op: "eq",
            field: { token: "sidebar_snoozed" },
            value: "true",
          },
        },
      ],
    },
    sort: [
      { field: "status", order: "asc" },
      { field: "workspace_order", order: "asc" },
      { field: "tab_order", order: "asc" },
      { field: "pane_order", order: "asc" },
    ],
  };
}
