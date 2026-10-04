#!/usr/bin/env bun

// Serves audit-viewer.html and the live audit log on localhost.
//
// Usage:
//   bun audit-viewer.js [--port 7788] [--no-open]   Serve in the foreground until Ctrl-C.
//   bun audit-viewer.js --background [--port 7788]  Reuse or start a detached server, open it, exit.
//   bun audit-viewer.js --stop [--port 7788]        Stop a running server.
//
// The Herdr action uses --background because plugin actions are short-lived commands.
// A background server exits after IDLE_EXIT_MS without requests; an open viewer tab
// polls every few seconds, so it stays alive while you are looking at it.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const IDLE_EXIT_MS = 15 * 60_000;
const SERVER_HEADER = "x-herdr-audit-viewer";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 7788;
const url = `http://127.0.0.1:${port}/`;

const stateDir =
  process.env.HERDR_PLUGIN_STATE_DIR ||
  join(homedir(), ".local/state/herdr/plugins/local.permission-evaluator");
const auditPath = join(stateDir, "audit.jsonl");
const viewerPath = join(import.meta.dir, "audit-viewer.html");

function openBrowser() {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function viewerIsRunning() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    return response.headers.has(SERVER_HEADER);
  } catch {
    return false;
  }
}

function serve({ idleExit }) {
  let lastRequestAt = Date.now();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      lastRequestAt = Date.now();
      const { pathname } = new URL(request.url);
      const headers = { [SERVER_HEADER]: "1", "cache-control": "no-store" };

      if (pathname === "/") {
        return new Response(Bun.file(viewerPath), {
          headers: { ...headers, "content-type": "text/html; charset=utf-8" },
        });
      }

      // The custom header forces a CORS preflight, which this server never answers,
      // so web pages cannot trigger a shutdown; only local clients like --stop can.
      if (pathname === "/stop" && request.method === "POST" && request.headers.has(SERVER_HEADER)) {
        setTimeout(() => {
          server.stop();
          process.exit(0);
        }, 50);
        return new Response("stopping", { headers });
      }

      if (pathname === "/audit.jsonl") {
        const file = Bun.file(auditPath);
        if (!(await file.exists())) return new Response("", { status: 404, headers });
        return new Response(file, {
          headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
        });
      }

      return new Response("Not found", { status: 404, headers });
    },
  });

  if (idleExit) {
    setInterval(() => {
      if (Date.now() - lastRequestAt < IDLE_EXIT_MS) return;
      server.stop();
      process.exit(0);
    }, 30_000);
  }

  return server;
}

async function startInBackground() {
  if (!(await viewerIsRunning())) {
    spawn(process.execPath, [import.meta.path, "--serve-detached", "--port", String(port)], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, HERDR_PLUGIN_STATE_DIR: stateDir },
    }).unref();

    for (let attempt = 0; attempt < 20 && !(await viewerIsRunning()); attempt++) {
      await Bun.sleep(100);
    }
    if (!(await viewerIsRunning())) {
      throw new Error(`audit viewer did not start on ${url} (is the port in use?)`);
    }
  }

  openBrowser();
  console.log(`Audit viewer: ${url}`);
}

async function stopServer() {
  if (!(await viewerIsRunning())) {
    console.log(`No audit viewer running on ${url}`);
    return;
  }

  await fetch(`${url}stop`, { method: "POST", headers: { [SERVER_HEADER]: "1" } });
  console.log(`Stopped audit viewer on ${url}`);
}

if (args.includes("--stop")) {
  await stopServer();
} else if (args.includes("--background")) {
  await startInBackground();
} else if (args.includes("--serve-detached")) {
  serve({ idleExit: true });
} else {
  serve({ idleExit: false });
  console.log(`Audit viewer: ${url}`);
  console.log(`Reading: ${auditPath}`);
  if (!args.includes("--no-open")) openBrowser();
}
