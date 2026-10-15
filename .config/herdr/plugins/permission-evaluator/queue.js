#!/usr/bin/env bun

// Queue CLI.
//
//   bun queue.js enqueue --harness claude   Permission hook entry point; reads the hook payload on stdin.
//   bun queue.js status                     Row counts by status.
//
// `enqueue` never decides or blocks the prompt: it always exits 0 and prints nothing, so the
// harness shows its normal dialog. It then starts a detached runner so the ask is evaluated within
// seconds instead of at launchd's next tick. Failures go to enqueue.err.log in the state directory.

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { insertAsk, openQueue, stateDirectory, statusCounts } from "./db.js";
import { HARNESSES } from "./harnesses/index.js";
import { detectTarget } from "./targets/index.js";

const STRING_LIMIT = 4_000;

// The evaluator prompt sends any row containing this marker to a human.
export const TRUNCATION_MARKER = "…[truncated]";

// Caps every string in the context so one huge tool input cannot bloat the queue or the prompt.
export function truncateStrings(value) {
  if (typeof value === "string") {
    return value.length > STRING_LIMIT ? `${value.slice(0, STRING_LIMIT)}${TRUNCATION_MARKER}` : value;
  }
  if (Array.isArray(value)) return value.map(truncateStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncateStrings(item)]));
  }
  return value;
}

// Returns the new row ID, or null when the ask is not one the runner could act on.
export function enqueue(db, { harnessName, hookInput, env }) {
  const harness = HARNESSES[harnessName];
  if (!harness) throw new Error(`unknown harness: ${harnessName}`);

  const detected = detectTarget(env);
  if (!detected) return null;

  const ask = harness.parseHookInput(hookInput);
  if (!ask) return null;

  const { driver, target } = detected;
  return insertAsk(db, {
    harness: harness.name,
    sessionId: ask.sessionId,
    target,
    targetKey: driver.key(target),
    context: truncateStrings(ask.context),
  });
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function logEnqueueError(error) {
  try {
    const stateDir = stateDirectory();
    mkdirSync(stateDir, { recursive: true });
    const message = error instanceof Error ? error.message : String(error);
    appendFileSync(join(stateDir, "enqueue.err.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Nowhere left to report; the prompt is still shown to the human.
  }
}

const RUNNER_ENV_NAMES = ["HOME", "USER", "LOGNAME", "SHELL", "HERDR_PLUGIN_STATE_DIR"];

// The hook runs inside the agent's session. Give the runner what launchd gives it, including the
// plist's PATH, so the evaluator's `claude -p` inherits none of that session's variables.
export function runnerEnvironment(env) {
  const environment = {
    PATH: [`${env.HOME}/.local/bin`, `${env.HOME}/.bun/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":"),
  };
  for (const name of RUNNER_ENV_NAMES) {
    if (env[name]) environment[name] = env[name];
  }
  return environment;
}

// If a runner already holds the lock, this one exits at once and the running one picks the row up.
function startRunner() {
  const logFd = openSync(join(stateDirectory(), "runner.log"), "a", 0o600);
  try {
    spawn(process.execPath, [join(import.meta.dir, "runner.js")], {
      // Bun loads `.env` and `bunfig.toml` from the working directory, which for the hook is the
      // agent's project; the plugin directory keeps that project out of the runner.
      cwd: import.meta.dir,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: runnerEnvironment(process.env),
    }).unref();
  } finally {
    closeSync(logFd);
  }
}

async function runEnqueue(args) {
  try {
    const hookInput = JSON.parse(await Bun.stdin.text());
    const id = enqueue(openQueue(), { harnessName: flagValue(args, "--harness"), hookInput, env: process.env });
    if (id !== null) startRunner();
  } catch (error) {
    logEnqueueError(error);
  }
  process.exit(0);
}

function printStatus() {
  for (const { status, count } of statusCounts(openQueue())) console.log(`${status}\t${count}`);
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);

  if (command === "enqueue") {
    await runEnqueue(args);
  } else if (command === "status") {
    printStatus();
  } else {
    console.error("usage: queue.js enqueue --harness <name> | status");
    process.exit(2);
  }
}
