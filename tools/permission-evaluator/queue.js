#!/usr/bin/env bun

// Queue CLI.
//
//   bun queue.js enqueue --harness claude   Permission hook entry point; reads the hook payload on stdin.
//   bun queue.js status                     Row counts by status.
//
// `enqueue` first applies the deterministic rules in rules.js. An ask a rule approves is allowed
// through the hook's output; one a rule escalates is recorded and notified without an evaluator
// run. Otherwise it prints nothing, so the harness shows its normal dialog, and starts a detached
// runner for the ask's target so the ask is evaluated within seconds instead of at launchd's next
// sweep. It always exits 0. Failures go to enqueue.err.log in the state directory.

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "./config.js";
import { getAsks, insertAsk, openQueue, stateDirectory, statusCounts } from "./db.js";
import { HARNESSES } from "./harnesses/index.js";
import { appendAudit, escalationNotice, notifyHuman } from "./report.js";
import { loadRules, ruleDecision } from "./rules.js";
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

// Returns { id, targetKey, decision } for a stored ask, where `decision` is set when a rule decided
// it and the runner must not. Returns { decision } for a rule-decided ask outside a supported target,
// and null when the ask is neither decided nor one the runner could act on.
export function enqueue(db, { harnessName, hookInput, env, rules = { slackChannels: [] }, dryRun = false }) {
  const harness = HARNESSES[harnessName];
  if (!harness) throw new Error(`unknown harness: ${harnessName}`);

  const ask = harness.parseHookInput(hookInput);
  if (!ask) return null;

  const decision = ruleDecision(ask.context, rules);
  const detected = detectTarget(env);
  if (!detected) return decision ? { decision } : null;

  const { driver, target } = detected;
  const targetKey = driver.key(target);
  const id = insertAsk(db, {
    harness: harness.name,
    sessionId: ask.sessionId,
    target,
    targetKey,
    context: truncateStrings(ask.context),
    decision: decision && { status: decision.status, reason: `rule ${decision.rule}: ${decision.reason}`, dryRun },
  });
  return { id, targetKey, decision };
}

const ALLOW_OUTPUT = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
});

// Reports a rule decision for a stored ask the way the runner reports the evaluator's.
function reportRuleDecision(db, id, dryRun) {
  const [ask] = getAsks(db, [id]);
  if (ask.status === "need_human") notifyHuman(escalationNotice(ask));
  appendAudit([
    {
      paneId: ask.target.pane_id ?? ask.target_key,
      askId: ask.id,
      harness: ask.harness,
      summary: ask.context.summary,
      dryRun,
      completed: true,
      decision: ask.status === "handled" ? (dryRun ? "dry_run_would_approve" : "approved") : "human_review",
      reason: ask.reason,
    },
  ]);
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

const RUNNER_ENV_NAMES = ["HOME", "USER", "LOGNAME", "SHELL", "PERMISSION_EVALUATOR_STATE_DIR"];

// The hook runs inside the agent's session. Give the runner what launchd gives it, so the
// evaluator's `claude -p` inherits none of that session's variables. Keep PATH in sync with
// Library/LaunchAgents/com.duc.permission-evaluator-runner.plist.
export function runnerEnvironment(env) {
  const home = env.HOME || homedir();
  const environment = {
    PATH: [`${home}/.local/bin`, `${home}/.bun/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":"),
  };
  for (const name of RUNNER_ENV_NAMES) {
    if (env[name]) environment[name] = env[name];
  }
  return environment;
}

// Starts a detached runner for one target. If a runner already holds that target's lock, the new
// one exits at once and the running one picks the row up.
export function startRunner(targetKey) {
  const logFd = openSync(join(stateDirectory(), "runner.log"), "a", 0o600);
  try {
    spawn(process.execPath, [join(import.meta.dir, "runner.js"), "--target", targetKey], {
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
    const db = openQueue();
    const { dryRun } = CONFIG;
    const queued = enqueue(db, {
      harnessName: flagValue(args, "--harness"),
      hookInput,
      env: process.env,
      rules: loadRules(import.meta.dir),
      dryRun,
    });
    if (queued?.decision?.status === "handled" && !dryRun) process.stdout.write(ALLOW_OUTPUT);
    if (queued?.decision && queued.id) reportRuleDecision(db, queued.id, dryRun);
    else if (queued?.id) startRunner(queued.targetKey);
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
