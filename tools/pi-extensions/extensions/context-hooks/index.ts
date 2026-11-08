/**
 * Shapes pi's system prompt from ~/.pi/agent/context-hooks.json:
 *
 * - `sessionStart`: shell commands run on session start, reload, new, resume, and fork;
 *   their stdout becomes a `<session_context>` section.
 * - `appendSystemPrompt`: per-model replacement for APPEND_SYSTEM.md, first match wins.
 *   With no match, pi's own APPEND_SYSTEM.md (or --append-system-prompt) stays.
 *
 * A rule's `file` may start with `~/`; a missing file is skipped with a warning. Files are
 * re-read on every run; the config and commands re-run on /reload.
 *
 * Example:
 * {
 *   "sessionStart": [{ "command": "rex __internal session-start --agent pi", "timeoutMs": 5000 }],
 *   "appendSystemPrompt": [
 *     { "model": "openai-codex/*", "file": "~/.pi/agent/APPEND_SYSTEM.gpt.md" },
 *     { "model": "anthropic/*", "file": "~/.pi/agent/APPEND_SYSTEM.md" }
 *   ]
 * }
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configFile, readConfig } from "../../src/config.ts";
import { findModelRule, modelRef } from "../../src/model-rule.ts";

const SECTION = "session_context";
const DEFAULT_TIMEOUT_MS = 5_000;

interface Config {
  sessionStart?: { command: string; timeoutMs?: number }[];
  appendSystemPrompt?: { model: string; file: string }[];
}

export default function (pi: ExtensionAPI) {
  let config: Config = {};
  let sessionContext: Promise<string> = Promise.resolve("");

  pi.on("session_start", async (_event, ctx) => {
    config = (readConfig(configFile("context-hooks")) as Config | undefined) ?? {};
    // Not awaited, so a slow command does not hold up startup; the first run waits for it.
    sessionContext = Promise.all(
      (config.sessionStart ?? []).map(async ({ command, timeoutMs }) => {
        const result = await pi.exec("/bin/sh", ["-c", command], {
          cwd: ctx.cwd,
          timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        if (result.code !== 0) ctx.ui.notify(`pi-context-hooks: \`${command}\` exited ${result.code}`, "warning");
        return result.stdout.trim();
      }),
    ).then((outputs) => outputs.filter(Boolean).join("\n\n"));
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const options = event.systemPromptOptions;

    const text = await sessionContext;
    if (text) options.sections[SECTION] = text;
    else delete options.sections[SECTION];

    const rule = findModelRule(config.appendSystemPrompt ?? [], ctx.model ? modelRef(ctx.model) : "");
    if (!rule) return;
    const path = rule.file.startsWith("~/") ? join(homedir(), rule.file.slice(2)) : rule.file;
    if (!existsSync(path)) {
      ctx.ui.notify(`pi-context-hooks: ${rule.file} not found; using the default APPEND_SYSTEM`, "warning");
      return;
    }
    options.appendSystemPrompt = readFileSync(path, "utf8").trim();
  });
}
