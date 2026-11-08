// After a successful `read`, load the AGENTS.md/CLAUDE.md files of the folders between the read file and the cwd,
// unless the model can already see them.
import * as fs from "node:fs";
import * as path from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, getMarkdownTheme, loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { findContextFiles, isBelow, realpath, resolveReadPath } from "./discover.ts";

export const TYPE = "nested-agents-md";

interface Details {
  paths: string[];
}

/** Realpaths of the files our messages injected that the model can still see (current leaf, after compaction). */
function visiblePaths(ctx: ExtensionContext): Set<string> {
  const seen = new Set<string>();
  for (const entry of ctx.sessionManager.buildSessionProjection().entries) {
    const source = entry.sourceEntry;
    if (source.type !== "custom_message" || source.customType !== TYPE || entry.messages.length === 0) continue;
    for (const p of (source.details as Partial<Details> | undefined)?.paths ?? []) seen.add(p);
  }
  return seen;
}

function render(file: string, content: string): string {
  return `<project_instructions path="${file}">\n${content}\n</project_instructions>`;
}

export default function (pi: ExtensionAPI) {
  /** Files in the system prompt of the current run. */
  let inPrompt = new Set<string>();
  /**
   * Files sent but not yet appended to the session. Pi appends our queued message right after the
   * `turn_end` handlers return (and flushes on run start/abort), so the set is cleared there.
   * (`message_end` is not emitted to extensions for queued custom messages.)
   */
  const pending = new Set<string>();
  /** Context files are turned off for the current run (`-nc`). */
  let off = false;
  /** Realpath of the cwd, for display. */
  let displayRoot = process.cwd();

  pi.on("session_start", async (_event, ctx) => {
    displayRoot = realpath(ctx.cwd) ?? ctx.cwd;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    pending.clear(); // a new run starts only after earlier queued messages were flushed
    const files = event.systemPromptOptions.contextFiles;
    inPrompt = new Set(files.map((f) => realpath(f.path) ?? f.path));
    // An empty list is either `-nc` or a project with no context files; only the first has files on disk.
    off = files.length === 0 && loadProjectContextFiles({ cwd: ctx.cwd, agentDir: getAgentDir() }).length > 0;
  });

  pi.on("tool_result", async (event, ctx) => {
    if (off || event.toolName !== "read" || event.isError) return;
    // handler boundary: pi would report a thrown error to the user; a missed injection is not worth that
    try {
      const root = realpath(ctx.cwd);
      const input = (event.input as { path?: unknown }).path;
      if (!root || typeof input !== "string") return;
      const file = resolveReadPath(input, ctx.cwd);
      if (!file || !isBelow(file, root)) return;

      const candidates = findContextFiles(file, root).filter((f) => !inPrompt.has(f) && !pending.has(f));
      if (candidates.length === 0) return;
      const visible = visiblePaths(ctx);
      const found = candidates.filter((f) => !visible.has(f));
      const parts: { file: string; text: string }[] = [];
      for (const f of found) {
        try {
          parts.push({ file: f, text: render(f, fs.readFileSync(f, "utf8")) });
        } catch {
          // unreadable: skip
        }
      }
      if (parts.length === 0) return;

      const paths = parts.map((p) => p.file);
      for (const p of paths) pending.add(p);
      pi.sendMessage<Details>(
        { customType: TYPE, content: parts.map((p) => p.text).join("\n\n"), display: true, details: { paths } },
        { triggerTurn: false },
      );
    } catch {
      // pi would report a handler error to the user; a missed injection is not worth that
    }
  });

  pi.on("turn_end", async () => {
    pending.clear(); // all tool results of the step are in; pi appends the queued message next
  });

  pi.registerMessageRenderer<Details>(TYPE, (message, { expanded, outputPad }, theme) => {
    const paths = message.details?.paths ?? [];
    const names = paths.map((p) => (isBelow(p, displayRoot) ? path.relative(displayRoot, p) : p));
    const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(theme.fg("customMessageLabel", `Loaded ${names.join(", ")}`), 0, 0));
    if (expanded && typeof message.content === "string") box.addChild(new Markdown(message.content, 0, 0, getMarkdownTheme(), { color: (t: string) => theme.fg("customMessageText", t) }));
    return box;
  });
}
