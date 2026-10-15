#!/usr/bin/env bun

// Serves the permission dashboard (dashboard.html) and its live state from queue.db on localhost.
//
// Usage:
//   bun dashboard.js [--port 7788] [--no-open]   Serve in the foreground until Ctrl-C.
//   bun dashboard.js --background [--port 7788]  Reuse or start a detached server, open it, exit.
//   bun dashboard.js --stop [--port 7788]        Stop a running server.
//
// The Herdr action uses --background because plugin actions are short-lived commands.
// A background server exits after IDLE_EXIT_MS without requests; an open dashboard tab
// polls every few seconds, so it stays alive while you are looking at it.

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { holderIsAlive, openQueue, stateDirectory } from "./db.js";
import { loadPolicy, policyHash } from "./evaluator.js";
import { CONFIG } from "./runner.js";
import { TARGETS } from "./targets/index.js";

const IDLE_EXIT_MS = 5 * 60_000;
const SERVER_HEADER = "x-herdr-permission-dashboard";
const LAUNCHD_LABEL = "com.duc.herdr-permission-runner";
const HOUR_MS = 60 * 60_000;
const HISTORY_LIMIT = 300;
const PREVIEW_LIMIT = 300;
const LOG_TAIL_BYTES = 32_000;
const LOG_TAIL_LINES = 60;
// A row still pending after this long points at a runner that is not picking it up.
const SLOW_PENDING_MS = 2 * 60_000;

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 7788;
const url = `http://127.0.0.1:${port}/`;

const stateDir = stateDirectory();
const pageFile = join(import.meta.dir, "dashboard.html");
// Each server generates a token and keeps it in the 0700 state dir. The API and POSTs require it in
// SERVER_HEADER, so other local users and processes cannot read the queue through the port. The
// browser gets it in the URL fragment, which is never sent to the server or logged.
const tokenFile = join(stateDir, "dashboard.token");

function readToken() {
  try {
    return readFileSync(tokenFile, "utf8").trim();
  } catch {
    return null;
  }
}

// Through a rename, so a reader never sees a half-written token.
function writeToken(path, token) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, token, { mode: 0o600 });
  renameSync(temporary, path);
}

function hasToken(request, token) {
  const given = Buffer.from(request.headers.get(SERVER_HEADER) ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length))];
}

// A row without its full context, which can be several KB; the page fetches that on demand.
function preview(row) {
  const { context, target, ...rest } = row;
  const { tool, summary, cwd } = JSON.parse(context);
  return {
    ...rest,
    pane_id: JSON.parse(target).pane_id ?? null,
    tool: tool ?? null,
    summary: String(summary ?? "").slice(0, PREVIEW_LIMIT),
    cwd: cwd ?? null,
    latency_ms: row.decided_at ? Date.parse(row.decided_at) - Date.parse(row.created_at) : null,
  };
}

// Everything the dashboard shows that comes from the queue. `agents` is the multiplexer's live
// agent list, or null when it cannot be read; it tells which escalations still wait.
export function snapshot(db, { now = Date.now(), config = CONFIG, agents = null } = {}) {
  const open = db
    .query("SELECT * FROM permission_asks WHERE status IN ('pending', 'in_progress') ORDER BY id")
    .all()
    .map(preview);
  const history = db
    .query(
      `SELECT * FROM permission_asks WHERE status NOT IN ('pending', 'in_progress')
       ORDER BY id DESC LIMIT $limit`,
    )
    .all({ limit: HISTORY_LIMIT })
    .map(preview);

  const agentByPane = new Map((agents ?? []).map((agent) => [agent.pane_id, agent]));
  const paneStatus = (paneId) => agentByPane.get(paneId)?.agent_status ?? (agents ? "gone" : "unknown");

  // Escalations recent enough that their prompt may still be on screen.
  const needsYou = db
    .query("SELECT * FROM permission_asks WHERE status = 'need_human' AND decided_at >= $since ORDER BY id DESC")
    .all({ since: iso(now - config.expireAfterMs) })
    .map((row) => {
      const ask = preview(row);
      return { ...ask, pane_status: paneStatus(ask.pane_id) };
    });

  // Blocked panes the queue has nothing current for: a harness without the hook, a failed hook,
  // or an escalation older than the window above.
  const trackedPanes = new Set([...open, ...needsYou].map((ask) => ask.pane_id));
  const untrackedBlocked = (agents ?? [])
    .filter((agent) => agent.agent_status === "blocked" && !trackedPanes.has(agent.pane_id))
    .map((agent) => ({ pane_id: agent.pane_id, agent: agent.agent, title: agent.terminal_title_stripped }));

  const counts = { handled: 0, dry_run: 0, need_human: 0, stale: 0, open: 0 };
  const hourly = Array.from({ length: 24 }, () => ({ handled: 0, need_human: 0, stale: 0, open: 0 }));
  const approvalLatencies = [];
  const lastDay = db
    .query("SELECT status, dry_run, created_at, decided_at FROM permission_asks WHERE created_at >= $since")
    .all({ since: iso(now - 24 * HOUR_MS) });
  for (const row of lastDay) {
    const bucket = row.status === "pending" || row.status === "in_progress" ? "open" : row.status;
    const hoursAgo = Math.floor((now - Date.parse(row.created_at)) / HOUR_MS);
    if (hoursAgo >= 0 && hoursAgo < 24) hourly[23 - hoursAgo][bucket] += 1;
    counts[row.status === "handled" && row.dry_run ? "dry_run" : bucket] += 1;
    if (row.status === "handled") approvalLatencies.push(Date.parse(row.decided_at) - Date.parse(row.created_at));
  }
  approvalLatencies.sort((a, b) => a - b);

  const locks = db
    .query("SELECT name, holder FROM target_lock ORDER BY name")
    .all()
    .map((lock) => ({ ...lock, alive: holderIsAlive(lock.holder) }));
  const liveLocks = new Set(locks.filter((lock) => lock.alive).map((lock) => lock.name));

  return {
    generatedAt: iso(now),
    config: { dryRun: config.dryRun, model: config.model },
    open,
    needsYou,
    untrackedBlocked,
    history,
    stats: {
      counts,
      hourly,
      approvalP50Ms: percentile(approvalLatencies, 0.5),
      approvalP90Ms: percentile(approvalLatencies, 0.9),
    },
    locks,
    queueHealth: {
      slowPending: open.filter((ask) => ask.status === "pending" && now - Date.parse(ask.created_at) > SLOW_PENDING_MS)
        .length,
      // Claims whose runner is gone; the next sweep recovers them.
      orphanedClaims: open.filter((ask) => ask.status === "in_progress" && !liveLocks.has(ask.target_key)).length,
    },
  };
}

export function askDetail(db, id) {
  const row = db.query("SELECT * FROM permission_asks WHERE id = $id").get({ id });
  return row ? { ...row, target: JSON.parse(row.target), context: JSON.parse(row.context) } : null;
}

async function run(argv, { env = process.env, timeoutMs = 2_000 } = {}) {
  try {
    const child = Bun.spawn(argv, { env, stdout: "pipe", stderr: "ignore", timeout: timeoutMs });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { ok: exitCode === 0, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

async function launchdStatus() {
  const { ok, stdout } = await run(["launchctl", "print", `gui/${process.getuid()}/${LAUNCHD_LABEL}`]);
  if (!ok) return { loaded: false };
  const field = (name) => new RegExp(`^\\s*${name} = (.+)$`, "m").exec(stdout)?.[1]?.trim() ?? null;
  return { loaded: true, state: field("state"), runs: Number(field("runs")), lastExit: field("last exit code") };
}

async function logTail(name) {
  const file = Bun.file(join(stateDir, name));
  if (!(await file.exists())) return { exists: false, lines: [] };
  const lines = (await file.slice(Math.max(0, file.size - LOG_TAIL_BYTES)).text()).split("\n").filter(Boolean);
  // After slicing, the first line may start mid-line.
  if (file.size > LOG_TAIL_BYTES) lines.shift();
  return { exists: true, lines: lines.slice(-LOG_TAIL_LINES) };
}

function policyStatus() {
  try {
    return { present: true, hash: policyHash(loadPolicy(import.meta.dir)) };
  } catch (error) {
    return { present: false, error: error.message };
  }
}

// The Herdr server the agents run in: this process's when a Herdr action started it, else the
// one the latest ask recorded.
function herdrSocket(db) {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  return db
    .query("SELECT json_extract(target, '$.socket_path') AS socket FROM permission_asks ORDER BY id DESC LIMIT 1")
    .get()?.socket;
}

async function herdrAgents(db) {
  const socket = herdrSocket(db);
  const { ok, stdout } = await run(["herdr", "agent", "list"], {
    env: socket ? { ...process.env, HERDR_SOCKET_PATH: socket } : process.env,
  });
  if (!ok) return null;
  try {
    return JSON.parse(stdout).result.agents;
  } catch {
    return null;
  }
}

async function fullState(db) {
  const [agents, launchd, runnerLog, enqueueLog] = await Promise.all([
    herdrAgents(db),
    launchdStatus(),
    logTail("runner.log"),
    logTail("enqueue.err.log"),
  ]);
  return {
    ...snapshot(db, { agents }),
    agents,
    launchd,
    policy: policyStatus(),
    logs: { runner: runnerLog, enqueue: enqueueLog },
    stateDir,
  };
}

// Focuses the pane an ask came from. The pane is read from the DB, never taken from the request.
async function focusAsk(db, id) {
  const ask = askDetail(db, id);
  const driver = ask && TARGETS[ask.target.type];
  if (!driver?.isValid(ask.target)) return false;
  const { ok } = await run(driver.focusCommand(ask.target), { env: driver.environment(ask.target) });
  return ok;
}

function pageUrl(token) {
  return `${url}#${token}`;
}

function openBrowser(token) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [pageUrl(token)], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

// True only for our own server: it must accept the token from the state dir, so a process
// squatting on the port is never handed the token through the browser.
async function dashboardIsRunning() {
  const token = readToken();
  if (!token) return false;
  try {
    const response = await fetch(`${url}api/ping`, {
      headers: { [SERVER_HEADER]: token },
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Throws when the port is taken. The token is written only once the port is bound, so a server
// that fails to start cannot replace the token of the one already running.
export function serve({ port, db = openQueue(), tokenPath = tokenFile, idleExit = false }) {
  const token = randomBytes(24).toString("hex");
  let lastRequestAt = Date.now();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    error: () => new Response("Internal error", { status: 500 }),
    async fetch(request, server) {
      const headers = { "cache-control": "no-store" };
      // The API serves command text, so only requests addressed to this host are answered: a page
      // that rebinds its own DNS name to 127.0.0.1 still sends that name in Host.
      const allowedHosts = [`127.0.0.1:${server.port}`, `localhost:${server.port}`];
      if (!allowedHosts.includes(request.headers.get("host"))) {
        return new Response("Forbidden", { status: 403, headers });
      }

      const { pathname } = new URL(request.url);
      // The page holds no data, so it is served without the token.
      if (pathname === "/") {
        return new Response(Bun.file(pageFile), {
          headers: { ...headers, "content-type": "text/html; charset=utf-8" },
        });
      }
      if (!hasToken(request, token)) return new Response("Unauthorized", { status: 401, headers });
      lastRequestAt = Date.now();
      const isPost = request.method === "POST";

      if (pathname === "/api/ping") return new Response("ok", { headers });
      if (pathname === "/api/state") return Response.json(await fullState(db), { headers });

      const askMatch = /^\/api\/asks\/(\d+)(\/focus)?$/.exec(pathname);
      if (askMatch && !askMatch[2]) {
        const ask = askDetail(db, Number(askMatch[1]));
        return ask ? Response.json(ask, { headers }) : new Response("Not found", { status: 404, headers });
      }
      if (askMatch && isPost) {
        const focused = await focusAsk(db, Number(askMatch[1]));
        return new Response(focused ? "focused" : "could not focus", { status: focused ? 200 : 502, headers });
      }

      if (pathname === "/stop" && isPost) {
        setTimeout(() => {
          server.stop();
          process.exit(0);
        }, 50);
        return new Response("stopping", { headers });
      }

      return new Response("Not found", { status: 404, headers });
    },
  });
  writeToken(tokenPath, token);

  if (idleExit) {
    setInterval(() => {
      if (Date.now() - lastRequestAt < IDLE_EXIT_MS) return;
      server.stop();
      process.exit(0);
    }, 30_000);
  }

  return { server, token };
}

async function startInBackground() {
  if (!(await dashboardIsRunning())) {
    spawn(process.execPath, [import.meta.path, "--serve-detached", "--port", String(port)], {
      cwd: import.meta.dir,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, HERDR_PLUGIN_STATE_DIR: stateDir },
    }).unref();

    for (let attempt = 0; attempt < 20 && !(await dashboardIsRunning()); attempt++) {
      await Bun.sleep(100);
    }
    if (!(await dashboardIsRunning())) {
      throw new Error(`dashboard did not start on ${url} (is the port in use?)`);
    }
  }

  openBrowser(readToken());
  console.log(`Permission dashboard: ${url}`);
}

async function stopServer() {
  if (!(await dashboardIsRunning())) {
    console.log(`No dashboard running on ${url}`);
    return;
  }

  await fetch(`${url}stop`, { method: "POST", headers: { [SERVER_HEADER]: readToken() ?? "" } });
  console.log(`Stopped dashboard on ${url}`);
}

if (import.meta.main) {
  if (args.includes("--stop")) {
    await stopServer();
  } else if (args.includes("--background")) {
    await startInBackground();
  } else if (args.includes("--serve-detached")) {
    serve({ port, idleExit: true });
  } else {
    const { token } = serve({ port });
    console.log(`Permission dashboard: ${pageUrl(token)}`);
    console.log(`Reading: ${stateDir}`);
    if (!args.includes("--no-open")) openBrowser(token);
  }
}
