/**
 * Quiet tool rows: when tool output is collapsed, every tool call shows as one line,
 * `▸ <tool> <short hint>  ✓ 1.2s`, without its script, arguments, or output.
 * Click a row to expand just that call, or press ctrl+o to expand all of them;
 * expanded rows use the tool's normal renderer. Failed calls also show the
 * tool's collapsed error preview. Images in a result still show: pi draws them
 * outside the renderers.
 *
 * Applies to every tool, including built-ins, MCP tools, and codemode, through
 * `pi.registerToolRenderer`.
 */
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, type Component, sliceByColumn, Text, visibleWidth } from "@earendil-works/pi-tui";

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;
type RenderResult = NonNullable<ToolRenderers["renderResult"]>;
type ToolRenderContext = Parameters<RenderCall>[2];

/** Argument keys that best describe a call, in order of preference. */
const HINT_KEYS = ["command", "path", "file_path", "pattern", "query", "url", "code", "description"];

/** Components each render slot last returned, kept apart because a renderer may reuse its own `lastComponent`. */
interface QuietState {
  baseCall?: Component;
  baseResult?: Component;
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

/** First meaningful line of the most descriptive string argument, skipping comment lines such as `// @options`. */
function argHint(args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const record = args as Record<string, unknown>;
  const key = HINT_KEYS.find((k) => typeof record[k] === "string") ??
    Object.keys(record).find((k) => typeof record[k] === "string");
  if (!key) return "";
  const lines = (record[key] as string).split("\n").map((line) => line.trim());
  return lines.find((line) => line && !line.startsWith("//") && !line.startsWith("#")) ?? lines[0] ?? "";
}

function statusText(context: ToolRenderContext, theme: Theme): string {
  if (context.isError) return theme.fg("error", "✗");
  if (context.isPartial) return theme.fg("muted", "…");
  const duration = context.durationMs === undefined ? "" : ` ${formatDuration(context.durationMs)}`;
  return theme.fg("success", "✓") + theme.fg("muted", duration);
}

/**
 * `▸ <tool> <hint>  <status>` on one line. The plain hint is shortened first so the status stays
 * visible; the whole line is cut only when the tool name and status alone do not fit. No reset code
 * is added: pi-tui's `truncateToWidth` ends with `\x1b[0m`, which also clears the row background.
 */
class QuietLine implements Component {
  constructor(private head: string, private hint: string, private tail: string, private theme: Theme) {}

  render(width: number): string[] {
    const room = width - visibleWidth(this.head) - visibleWidth(this.tail) - 3;
    let hint = "";
    if (this.hint && room > 0) {
      hint = visibleWidth(this.hint) <= room ? this.hint : `${sliceByColumn(this.hint, 0, room - 1, true)}…`;
    }
    const line = `${this.head}${hint ? ` ${this.theme.fg("dim", hint)}` : ""}  ${this.tail}`;
    return [sliceByColumn(line, 0, width, true)];
  }

  invalidate(): void {}
}

function quietLine(toolName: string, context: ToolRenderContext, theme: Theme): QuietLine {
  const head = `${theme.fg("muted", "▸ ")}${theme.fg("toolTitle", toolName)}`;
  return new QuietLine(head, argHint(context.args), statusText(context, theme), theme);
}

/**
 * A tool with `renderShell: "self"`, such as `edit`, draws its own background box, so pi adds none.
 * Wrap its quiet line in the box pi gives other tools: same state colour and outputPad padding.
 */
function shellBox(line: QuietLine, context: ToolRenderContext, theme: Theme): Box {
  const bg = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
  const box = new Box(context.outputPad, 1, (text) => theme.bg(bg, text));
  box.addChild(line);
  return box;
}

function quietRenderers(toolName: string, base: ToolRenderers | undefined): ToolRenderers {
  const renderCall: RenderCall = (args, theme, context) => {
    const state = context.state as QuietState;
    // Run the tool's own renderers even when collapsed: some keep state in them across slots, such
    // as the bash timer, which the call renderer starts and only the result renderer stops.
    const baseCall = base?.renderCall?.(args, theme, { ...context, lastComponent: state.baseCall });
    state.baseCall = baseCall;
    if (!context.expanded) {
      const line = quietLine(toolName, context, theme);
      return base?.renderShell === "self" ? shellBox(line, context, theme) : line;
    }
    // A throwing renderer makes pi draw its own fallback, as it does for tools without one.
    if (!baseCall) throw new Error(`${toolName} has no renderCall`);
    return baseCall;
  };

  const renderResult: RenderResult = (result, options, theme, context) => {
    const state = context.state as QuietState;
    const component = base?.renderResult?.(result, options, theme, { ...context, lastComponent: state.baseResult });
    state.baseResult = component;
    if (!options.expanded && !context.isError) return new Text("", 0, 0);
    if (!component) throw new Error(`${toolName} has no renderResult`);
    return component;
  };

  return { ...base, renderCall, renderResult };
}

export default function (pi: ExtensionAPI) {
  pi.registerToolRenderer((toolName, next) => quietRenderers(toolName, next()));
}
