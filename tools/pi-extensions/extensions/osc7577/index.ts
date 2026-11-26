/**
 * Implements the Program Resume Protocol (OSC 7577): reports `pi --session <file>` to any
 * terminal that sets OSC7577_TOKEN, so it can bring the session back after a restart.
 * Spec: https://www.superlogical.com/rex/docs/build/program-resume
 *
 * The terminal decides whether to trust the command. Rex, for example, needs a rule in
 * ~/.config/rex/init.lua:
 *   rex.set("resume.trust.pi", { command = { "pi", "--session", rex.match.under("~") } })
 * and shows the record with: rex block call -b "$REX_BLOCK" program_resume_records
 */
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { osc7577, resumePairs } from "./report.ts";

const TOKEN_KEY = Symbol.for("pi-extensions.osc7577.token");
const store = globalThis as { [TOKEN_KEY]?: string };

// Children (bash tool, subagents) must not get the token, or they could replace pi's record.
// It lives on globalThis because /reload re-imports this module after the env var is gone.
if (process.env.OSC7577_TOKEN) {
  store[TOKEN_KEY] = process.env.OSC7577_TOKEN;
  delete process.env.OSC7577_TOKEN;
}

function report(ctx: ExtensionContext) {
  const token = store[TOKEN_KEY];
  if (!token || ctx.mode !== "tui") return;
  const sm = ctx.sessionManager;
  // The file, not the id: pi finds an id only in the default session dir, and --session-dir
  // or --session <path> sessions live elsewhere. A relative --session-dir leaves the file relative,
  // and the resumed pi may start elsewhere. --no-session has no file, so drop any record.
  const file = sm.getSessionFile();
  const pairs = file ? resumePairs(["pi", "--session", resolve(file)], sm.getCwd()) : "clear=1";
  process.stdout.write(osc7577(token, process.pid, Math.floor(Date.now() / 1000), pairs));
}

export default function (pi: ExtensionAPI) {
  // Fires on startup, /reload, /new, /resume and /fork, so the record follows the active session.
  // No clear on exit: the spec forbids one on SIGHUP or SIGTERM, which pi's quit reason can't tell
  // apart, and a terminal drops the record once pi's pid exits.
  pi.on("session_start", async (_event, ctx) => report(ctx));
}
