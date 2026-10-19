#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  ATTENTION_STATUSES,
  agentIdentity,
  agentView,
  nextRefreshAt,
  reconcileSnoozes,
  snoozeLease,
  titleTokens,
} from "./core.js";

const herdr = process.env.HERDR_BIN_PATH || "herdr";
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR
  || join(process.env.HOME, ".local/state/herdr/plugins/local.agent-sidebar");
const statePath = join(stateDir, "snoozes.json");
const lockPath = join(stateDir, "state.lock");
const lockOwnerPath = join(lockPath, "owner.json");
const scriptPath = import.meta.path;
const timerLabel = "agent-sidebar-timer";
const timerScript = 'sleep "$1" && exec "$2" "$3" timer "$4"';

function nowMs() {
  const overridden = Number(process.env.AGENT_SIDEBAR_NOW_MS);
  return Number.isFinite(overridden) && overridden > 0 ? overridden : Date.now();
}

function run(args, { allowFailure = false } = {}) {
  const result = spawnSync(herdr, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${herdr} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.status === 0 ? result.stdout.trim() : "";
}

function emptyState() {
  return { snoozes: {}, timer: null };
}

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (!parsed?.snoozes || typeof parsed.snoozes !== "object") return emptyState();
    return { snoozes: parsed.snoozes, timer: parsed.timer ?? null };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, statePath);
}

async function withStateLock(callback) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const nonce = randomUUID();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      mkdirSync(lockPath);
      writeFileSync(lockOwnerPath, JSON.stringify({ pid: process.pid, nonce }), { mode: 0o600 });
      try {
        return await callback();
      } finally {
        let stillOwned = false;
        try {
          stillOwned = JSON.parse(readFileSync(lockOwnerPath, "utf8")).nonce === nonce;
        } catch {
          // A missing owner means another recovery path already removed this lock.
        }
        if (stillOwned) {
          unlinkSync(lockOwnerPath);
          rmdirSync(lockPath);
        }
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let ownerPid = null;
      try {
        ownerPid = JSON.parse(readFileSync(lockOwnerPath, "utf8")).pid;
      } catch {
        // A process may have died between creating the directory and writing its owner.
      }
      let ownerAlive = false;
      try {
        if (Number.isInteger(ownerPid) && ownerPid > 0) process.kill(ownerPid, 0);
        ownerAlive = Number.isInteger(ownerPid) && ownerPid > 0;
      } catch {
        ownerAlive = false;
      }
      const stale = existsSync(lockPath)
        && nowMs() - statSync(lockPath).mtimeMs > 15_000
        && !ownerAlive;
      if (stale) {
        try {
          unlinkSync(lockOwnerPath);
        } catch {
          // The dead owner may never have written its owner file.
        }
        rmdirSync(lockPath);
        continue;
      }
      await Bun.sleep(20);
    }
  }

  throw new Error("Timed out waiting for the agent-sidebar state lock");
}

function agents({ allowUnavailable = false } = {}) {
  const output = run(["agent", "list"], { allowFailure: allowUnavailable });
  if (!output) return allowUnavailable ? null : [];
  return JSON.parse(output)?.result?.agents ?? [];
}

function actionPaneId() {
  if (process.env.HERDR_PANE_ID) return process.env.HERDR_PANE_ID;
  try {
    const context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");
    return context.pane_id || context.focused_pane_id || context.focused_pane?.pane_id || context.pane?.pane_id || "";
  } catch {
    return "";
  }
}

function matchingAgent(paneId, currentAgents) {
  return currentAgents.find((agent) => agent.pane_id === paneId);
}

function reportPresentationTokens(agent, desired = titleTokens(agent)) {
  const existing = agent.tokens ?? {};
  const args = ["pane", "report-metadata", agent.pane_id, "--source", "plugin:local.agent-sidebar"];
  let changed = false;

  for (const [name, value] of Object.entries(desired)) {
    if (value == null) {
      if (existing[name] == null) continue;
      args.push("--clear-token", name);
      changed = true;
      continue;
    }
    if (existing[name] === value) continue;
    args.push("--token", `${name}=${value}`);
    changed = true;
  }

  if (changed) run(args);
}

function reportSnoozeToken(agent, ttlMs) {
  run([
    "pane", "report-metadata", agent.pane_id,
    "--source", "plugin:local.agent-sidebar",
    "--token", "sidebar_snoozed=true",
    "--ttl-ms", String(Math.max(1, Math.ceil(ttlMs))),
  ]);
}

function clearSnoozeToken(agent) {
  if (agent?.tokens?.sidebar_snoozed !== "true") return;
  run([
    "pane", "report-metadata", agent.pane_id,
    "--source", "plugin:local.agent-sidebar",
    "--clear-token", "sidebar_snoozed",
  ]);
}

function socketRequest(method, params) {
  const socketPath = process.env.HERDR_SOCKET_PATH || join(process.env.HOME, ".config/herdr/herdr.sock");
  const id = `agent-sidebar:${process.pid}:${Date.now()}`;

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffered = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${method} timed out`));
    }, 5_000);

    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    socket.on("data", (chunk) => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;

      clearTimeout(timeout);
      socket.end();
      const response = JSON.parse(buffered.slice(0, newline));
      if (response.error) reject(new Error(`${response.error.code}: ${response.error.message}`));
      else resolve(response.result);
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function timerAlive(timer) {
  if (!timer) return false;
  if (process.env.AGENT_SIDEBAR_DISABLE_TIMER === "1" && timer.pid === 0) return true;
  if (!Number.isInteger(timer.pid) || timer.pid <= 0) return false;
  try {
    process.kill(timer.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isOurTimer(timer) {
  if (!timerAlive(timer)) return false;
  if (process.env.AGENT_SIDEBAR_DISABLE_TIMER === "1" && timer.pid === 0) return true;
  const result = spawnSync("ps", ["-o", "command=", "-p", String(timer.pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0
    && result.stdout.includes(scriptPath)
    && result.stdout.includes(timer.generation);
}

function stopTimer(timer) {
  if (!Number.isInteger(timer?.pid) || timer.pid <= 0) return;
  if (!isOurTimer(timer)) return;
  try {
    process.kill(-timer.pid, "SIGTERM");
  } catch {
    // A timer that exited between validation and the signal needs no cleanup.
  }
}

function spawnTimer(generation, wakeAtMs, currentTime) {
  if (process.env.AGENT_SIDEBAR_DISABLE_TIMER === "1") return 0;
  const delaySeconds = Math.max(1, Math.ceil((wakeAtMs - currentTime) / 1000));
  const child = spawn(
    "/bin/sh",
    ["-c", timerScript, timerLabel, String(delaySeconds), process.execPath, scriptPath, generation],
    { detached: true, stdio: "ignore", env: process.env },
  );
  child.unref();
  return child.pid;
}

function scheduleTimer(state, wakeAtMs, currentTime) {
  stopTimer(state.timer);
  const generation = randomUUID();
  state.timer = {
    generation,
    wake_at_ms: wakeAtMs,
    pid: spawnTimer(generation, wakeAtMs, currentTime),
  };
}

function armTimer(state, currentTime) {
  const wakeAtMs = nextRefreshAt(state.snoozes);
  if (wakeAtMs == null) {
    stopTimer(state.timer);
    state.timer = null;
    return;
  }

  const currentTimerIsUseful = state.timer
    && state.timer.wake_at_ms <= wakeAtMs
    && isOurTimer(state.timer);
  if (currentTimerIsUseful) return;

  scheduleTimer(state, wakeAtMs, currentTime);
}

async function publishSurface(currentAgents) {
  for (const agent of currentAgents) reportPresentationTokens(agent);
  await socketRequest("agent.view.set", agentView());
}

function clearEndedTokens(ended, currentAgents) {
  const agentsByIdentity = new Map(currentAgents.map((agent) => [agentIdentity(agent), agent]));
  for (const item of ended) clearSnoozeToken(agentsByIdentity.get(item.identity));
}

function clearOrphanTokens(snoozes, currentAgents) {
  for (const agent of currentAgents) {
    const markerPresent = agent.tokens?.sidebar_snoozed === "true";
    if (markerPresent && !snoozes[agentIdentity(agent)]) clearSnoozeToken(agent);
  }
}

async function sync({ startup = false, allowUnavailable = false, timerGeneration = null } = {}) {
  let currentAgents = null;
  await withStateLock(async () => {
    const currentTime = nowMs();
    const state = loadState();
    currentAgents = agents({ allowUnavailable });
    if (timerGeneration != null) {
      if (state.timer?.generation !== timerGeneration) return;
      state.timer = null;
    }
    if (currentAgents == null) {
      if (timerGeneration != null && Object.keys(state.snoozes).length > 0) {
        scheduleTimer(state, currentTime + 5 * 60 * 1000, currentTime);
        saveState(state);
      }
      return;
    }

    const reconciled = reconcileSnoozes(state.snoozes, currentAgents, currentTime, {
      restoreMissingMarkers: startup,
    });
    state.snoozes = reconciled.snoozes;
    clearEndedTokens(reconciled.ended, currentAgents);
    clearOrphanTokens(state.snoozes, currentAgents);

    if (startup) {
      for (const { identity, agent, snooze } of reconciled.restore) {
        const lease = snoozeLease(snooze.until_ms, currentTime);
        if (!lease) continue;
        reportSnoozeToken(agent, lease.ttlMs);
        state.snoozes[identity].token_until_ms = lease.tokenUntilMs;
      }
    }

    for (const [identity, snooze] of Object.entries(state.snoozes)) {
      const refreshAt = snooze.token_until_ms == null
        ? currentTime
        : snooze.token_until_ms - 12 * 60 * 60 * 1000;
      const shouldRefresh = timerGeneration != null && refreshAt <= currentTime;
      const needsMigration = snooze.token_until_ms == null;
      if (!shouldRefresh && !needsMigration) continue;

      const agent = currentAgents.find((candidate) => agentIdentity(candidate) === identity);
      const lease = agent && snoozeLease(snooze.until_ms, currentTime);
      if (!lease) continue;
      reportSnoozeToken(agent, lease.ttlMs);
      snooze.token_until_ms = lease.tokenUntilMs;
    }

    armTimer(state, currentTime);
    saveState(state);
  });

  if (currentAgents != null) await publishSurface(currentAgents);
}

async function setSnooze(paneId, untilMs) {
  let currentAgents;
  await withStateLock(async () => {
    currentAgents = agents();
    const agent = matchingAgent(paneId, currentAgents);
    if (!agent) throw new Error(`No agent is running in pane ${paneId}`);
    if (ATTENTION_STATUSES.has(agent.agent_status)) {
      throw new Error(`Cannot snooze an agent that is ${agent.agent_status}`);
    }

    const currentTime = nowMs();
    const lease = snoozeLease(untilMs, currentTime);
    if (!lease) throw new Error("Snooze deadline must be in the future");

    const state = loadState();
    const identity = agentIdentity(agent);
    reportSnoozeToken(agent, lease.ttlMs);
    state.snoozes[identity] = {
      until_ms: untilMs,
      token_until_ms: lease.tokenUntilMs,
      pane_id: agent.pane_id,
      agent_session: agent.agent_session ?? null,
      created_at: new Date(currentTime).toISOString(),
    };
    armTimer(state, currentTime);
    saveState(state);
  });
  await publishSurface(currentAgents);
}

async function unsnooze(paneId) {
  let currentAgents;
  await withStateLock(async () => {
    currentAgents = agents();
    const agent = matchingAgent(paneId, currentAgents);
    if (!agent) throw new Error(`No agent is running in pane ${paneId}`);

    const state = loadState();
    delete state.snoozes[agentIdentity(agent)];
    clearSnoozeToken(agent);
    armTimer(state, nowMs());
    saveState(state);
  });
  await publishSurface(currentAgents);
}

async function deactivate() {
  const currentAgents = agents();
  for (const agent of currentAgents) {
    reportPresentationTokens(agent, {
      sidebar_attention_title: null,
      sidebar_background_title: null,
      sidebar_rank: null,
    });
    clearSnoozeToken(agent);
  }
  await withStateLock(async () => {
    const state = loadState();
    stopTimer(state.timer);
    saveState(emptyState());
  });
  await socketRequest("agent.view.clear", { source: "plugin:local.agent-sidebar" });
}

function openSnooze() {
  const paneId = actionPaneId();
  if (!paneId) throw new Error("Snooze requires an agent pane context");
  run([
    "plugin", "pane", "open",
    "--plugin", "local.agent-sidebar",
    "--entrypoint", "snooze",
    "--placement", "popup",
    "--width", "52",
    "--height", "14",
    "--env", `HERDR_SNOOZE_TARGET=${paneId}`,
  ]);
}

async function main() {
  const [command = "sync", ...args] = process.argv.slice(2);
  if (command === "sync") {
    return sync({ startup: args.includes("--startup"), allowUnavailable: args.includes("--quiet") });
  }
  if (command === "timer") return sync({ timerGeneration: args[0], allowUnavailable: true });
  if (command === "open-snooze") return openSnooze();
  if (command === "set-snooze") return setSnooze(args[0], Number(args[1]));
  if (command === "unsnooze") return unsnooze(args[0] || actionPaneId());
  if (command === "deactivate") return deactivate();
  throw new Error(`Unknown command: ${command}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
