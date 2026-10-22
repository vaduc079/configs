// Audit log and macOS notifications, shared by the runner and the hook's rule decisions.

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "./config.js";
import { stateDirectory } from "./db.js";
import { oneLine } from "./evaluator.js";
import { TARGETS } from "./targets/index.js";

export function appendAudit(entries) {
  if (!CONFIG.auditEnabled || entries.length === 0) return;

  const timestamp = new Date().toISOString();
  const lines = entries.map((entry) => `${JSON.stringify({ timestamp, ...entry })}\n`);
  appendFileSync(join(stateDirectory(), "audit.jsonl"), lines.join(""));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// macOS runs the click action later in a bare environment, so the command carries an absolute
// executable and the variables that reach the target's server.
export function focusShellCommand({ argv, environment }) {
  const [executable, ...args] = argv;
  const variables = Object.entries(environment).map(([name, value]) => `${name}=${shellQuote(value)}`);
  const command = [Bun.which(executable) ?? executable, ...args].map(shellQuote);
  // `env` first keeps the value from starting with a quote, which terminal-notifier rejects.
  return ["/usr/bin/env", ...variables, ...command].join(" ");
}

// terminal-notifier rejects a value starting with one of these unless it is escaped.
export function notifierValue(text) {
  return /^[-[({<"']/.test(text) ? `\\${text}` : text;
}

// terminal-notifier, when installed, brings the target's app forward and focuses the pane on click;
// a notice for the same target replaces the previous one. Otherwise falls back to osascript, which
// has no click action.
export function notifyHuman({ title, message, group, app, focus }) {
  if (!CONFIG.notifyEnabled) return;

  const notifier = Bun.which("terminal-notifier");
  if (notifier) {
    const args = [
      "-title", title,
      "-message", notifierValue(message),
      "-group", group,
    ];
    if (app) args.push("-activate", app);
    if (focus) args.push("-execute", focusShellCommand(focus));
    spawnSync(notifier, args, { stdio: "ignore", timeout: 5_000 });
    return;
  }

  // Uses `on run argv` so the notification text is passed as data, never parsed as AppleScript.
  spawnSync(
    "osascript",
    [
      "-e",
      "on run argv",
      "-e",
      "display notification (item 2 of argv) with title (item 1 of argv)",
      "-e",
      "end run",
      title,
      message,
    ],
    { stdio: "ignore", timeout: 5_000 },
  );
}

// Shows only the reason: the command summary is usually long enough to push it out of the banner.
export function escalationNotice(ask) {
  const driver = TARGETS[ask.target.type];
  const canFocus = driver?.isValid(ask.target);
  return {
    title: `Permission needs you (${ask.target_key})`,
    // The evaluator may return an empty reason, and terminal-notifier drops an empty message.
    message: oneLine(ask.reason) || "needs review",
    group: ask.target_key,
    app: driver?.appBundleId ?? null,
    focus: canFocus
      ? { argv: driver.focusCommand(ask.target), environment: driver.serverEnvironment(ask.target) }
      : null,
  };
}
