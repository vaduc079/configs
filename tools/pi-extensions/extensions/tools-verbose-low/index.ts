/**
 * Quieter tool rows, in two modes switched with `/tool-verbose <low|normal>`. The mode is saved in
 * `~/.pi/agent/tools-verbose-low.json` (`{ "mode": "low" }`) and used by new sessions; a missing file means `normal`.
 *
 * - `normal` (default): when tool output is collapsed, every tool call shows as one line,
 *   `▸ <tool> <short hint>  ✓ 1.2s`, without its script, arguments, or output. Click a row to expand
 *   just that call, or press ctrl+o to expand all of them; expanded rows use the tool's normal renderer.
 *   Failed calls also show the tool's collapsed error preview.
 * - `low`: consecutive tool calls fold into one header line, styled like pi's hidden-thinking line:
 *   `Running 3 tools...` while the run is open and `Ran 3 tools` once text or another message ends it. Click the header to open the run
 *   into `normal` rows. A failed call keeps its own `normal` row and ends the run. ctrl+o shows every
 *   row as in `normal`. Hidden thinking renders nothing.
 *
 * Images in a result still show: pi draws them outside the renderers. Applies to every tool, including
 * built-ins, MCP tools, and codemode, through `pi.registerToolRenderer`. Every row is drawn with
 * `renderShell: "self"` in a frame that looks like pi's default shell (frame.ts), so a hidden call takes
 * no lines and the mode can change without rebuilding rows. Runs come from the message stream (runs.ts),
 * rebuilt from the entries pi draws (`buildContextEntries()`) on start, `/tree` and compaction.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
  getAgentDir,
  type Theme,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { type Box, type Component, Container, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import { callFallback, frame, quietLine, resultFallback, type ToolRenderContext } from "./frame.ts";
import { createRunTracker, type Run } from "./runs.ts";

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;
type RenderResult = NonNullable<ToolRenderers["renderResult"]>;

const MODES = ["normal", "low"] as const;
type Mode = (typeof MODES)[number];

interface QuietState {
  /** Components the tool's own renderers last returned, kept apart because a renderer may reuse its `lastComponent`. */
  baseCall?: Component;
  baseResult?: Component;
  /** The frame the call slot drew this update; the result slot adds the result into it. */
  frame?: Box;
}

/** What the renderers need from the extension instance. */
interface Rows {
  /** The run this call is grouped in, or undefined when it draws as in `normal`. */
  groupOf(toolCallId: string): Run | undefined;
  register(toolCallId: string, invalidate: () => void): void;
  /** Redraws the leader of each run the tracker changed. */
  invalidate(runs: Run[]): void;
  /** Redraws every row of the run. */
  invalidateRun(run: Run): void;
}

export default function (pi: ExtensionAPI) {
  const configFile = path.join(getAgentDir(), "tools-verbose-low.json");
  let mode = loadMode(configFile);
  const tracker = createRunTracker();
  // Each row's `invalidate`; the latest row for an ID wins, because pi rebuilds rows.
  const registry = new Map<string, () => void>();
  // Captured from session_start to read ctrl+o; pi does not tell renderers whether a row was expanded by a click or ctrl+o.
  let ui: ExtensionUIContext | undefined;

  const rows: Rows = {
    groupOf: (id) => (mode === "low" && !ui?.getToolsExpanded() ? tracker.runOf(id) : undefined),
    register: (id, invalidate) => registry.set(id, invalidate),
    // A tracker change alters only a run's header (count, Running/Ran, a new leader after a split): members look
    // the same, and a new call's row is built after the tracker placed it. In normal no row depends on runs.
    invalidate: (runs) => {
      if (mode === "low") new Set(runs.map((run) => run.ids[0])).forEach((id) => registry.get(id)?.());
    },
    invalidateRun: (run) => run.ids.forEach((id) => registry.get(id)?.()),
  };
  const invalidateAll = () => registry.forEach((invalidate) => invalidate());
  const applyThinkingLabel = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setHiddenThinkingLabel(mode === "low" ? "" : undefined);
  };
  const rebuild = (_event: unknown, ctx: ExtensionContext) => {
    tracker.replay(ctx.sessionManager.buildContextEntries());
    invalidateAll();
  };

  pi.registerToolRenderer((toolName, next) => quietRenderers(toolName, next(), rows));

  pi.on("session_start", (event, ctx) => {
    ui = ctx.hasUI ? ctx.ui : undefined;
    applyThinkingLabel(ctx);
    rebuild(event, ctx);
  });
  // pi discards every row after /tree and compaction, then draws new ones; not on session_start (/reload draws first).
  const rebuildRows = (event: unknown, ctx: ExtensionContext) => {
    registry.clear();
    rebuild(event, ctx);
  };
  pi.on("session_tree", rebuildRows);
  pi.on("session_compact", rebuildRows);
  pi.on("turn_start", (_event, ctx) => {
    // pi appends a displayed custom message sent mid-run at turn_end without telling extensions; find it in the branch.
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0 && branch[i].type !== "message"; i--) {
      const entry = branch[i];
      if (entry.type === "custom_message" && entry.display) return rows.invalidate(tracker.closeOpen());
    }
  });
  pi.on("message_start", (event) => tracker.messageStart(event.message));
  pi.on("message_update", (event) => rows.invalidate(tracker.messageUpdate(event.message)));
  pi.on("message_end", (event) => {
    rows.invalidate(tracker.messageEnd(event.message));
    // A failed call leaves its run, so it is in no changed run.
    if (mode === "low" && event.message.role === "toolResult" && event.message.isError) {
      registry.get(event.message.toolCallId)?.();
    }
  });
  pi.on("agent_end", () => rows.invalidate(tracker.closeOpen()));

  pi.registerCommand("tool-verbose", {
    description: "Tool rows: low groups consecutive calls under one header, normal shows one row per call",
    getArgumentCompletions: (prefix) =>
      MODES.filter((m) => m.startsWith(prefix.trim())).map((m) => ({ value: m, label: m })),
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (!arg) return ctx.ui.notify(`Tool rows: ${mode}`, "info");
      if (!isMode(arg)) return ctx.ui.notify("Usage: /tool-verbose <low|normal>", "error");
      fs.writeFileSync(configFile, `${JSON.stringify({ mode: arg }, null, 2)}\n`);
      mode = arg;
      applyThinkingLabel(ctx);
      invalidateAll();
    },
  });
}

function quietRenderers(toolName: string, base: ToolRenderers | undefined, rows: Rows): ToolRenderers {
  // Such a tool (edit) draws its own box when expanded and its result outside the box.
  const selfShell = base?.renderShell === "self";

  const renderCall: RenderCall = (args, theme, context) => {
    const state = context.state as QuietState;
    // Run the tool's own renderers even when collapsed: some keep state in them across slots, such
    // as the bash timer, which the call renderer starts and only the result renderer stops.
    const baseCall = base?.renderCall?.(args, theme, { ...context, lastComponent: state.baseCall });
    state.baseCall = baseCall;
    state.frame = undefined;
    rows.register(context.toolCallId, context.invalidate);

    const run = rows.groupOf(context.toolCallId);
    const isLeader = run?.ids[0] === context.toolCallId;
    // A hidden member renders nothing in both slots, so pi draws no lines for it, spacer included.
    if (run && !run.expanded) return isLeader ? header(run, context, theme, rows) : new Text("", 0, 0);

    let row: Component;
    if (context.expanded && selfShell && baseCall) {
      row = baseCall;
    } else {
      const content = context.expanded
        ? (baseCall ?? callFallback(toolName, args, theme))
        : quietLine(toolName, context, theme);
      const box = frame(content, context, theme);
      if (!selfShell) state.frame = box;
      row = box;
    }
    if (!isLeader) return row;

    const opened = new Container();
    opened.addChild(header(run, context, theme, rows));
    opened.addChild(new Spacer(1));
    opened.addChild(row);
    return opened;
  };

  const renderResult: RenderResult = (result, options, theme, context) => {
    const state = context.state as QuietState;
    const baseResult = base?.renderResult?.(result, options, theme, { ...context, lastComponent: state.baseResult });
    state.baseResult = baseResult;
    const empty = new Text("", 0, 0);
    if (rows.groupOf(context.toolCallId)?.expanded === false) return empty;
    if (!options.expanded && !context.isError) return empty;

    const component = baseResult ?? resultFallback(result, context, theme);
    if (!state.frame) return component ?? empty;
    if (component) state.frame.addChild(component);
    return empty;
  };

  return { ...base, renderShell: "self", renderCall, renderResult };
}

/** `Running 3 tools...` or `Ran 3 tools`, drawn like pi's hidden-thinking line; a left click opens or closes the run. */
function header(run: Run, context: ToolRenderContext, theme: Theme, rows: Rows): Component {
  const count = `${run.ids.length} ${run.ids.length === 1 ? "tool" : "tools"}`;
  const label = run.closed ? `Ran ${count}` : `Running ${count}...`;
  const line = new Text(theme.italic(theme.fg("thinkingText", label)), context.outputPad, 0);
  // Handled here, so pi's own click toggle on the leader's row does not fire.
  return new MouseRegion(line, (event) => {
    if (event.type !== "click" || event.button !== "left") return undefined;
    run.expanded = !run.expanded;
    // Members appear or disappear.
    rows.invalidateRun(run);
    return { handled: true };
  });
}

function loadMode(file: string): Mode {
  if (!fs.existsSync(file)) return "normal";
  // A load error stops pi from starting, so the message must name the file.
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isMode(config?.mode)) throw new Error(`${file}: "mode" must be one of ${MODES.join(", ")}.`);
  return config.mode;
}

function isMode(value: unknown): value is Mode {
  return MODES.includes(value as Mode);
}
