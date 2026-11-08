/**
 * Pieces of a tool row as pi's default shell draws them, for rows drawn with `renderShell: "self"`.
 * pi does not export its fallbacks, so `callFallback` and `resultFallback` copy them from pi 1.5.0
 * (`core/tools/render-utils.js`, `modes/interactive/components/tool-execution.js`).
 */
import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  getCapabilities,
  getImageDimensions,
  imageFallback,
  sliceByColumn,
  Text,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { formatDuration } from "../../src/format.ts";

export type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

/** pi's tool box: vertical padding 1, outputPad horizontal padding, background by state. */
export function frame(content: Component, context: ToolRenderContext, theme: Theme): Box {
  const bg = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
  const box = new Box(context.outputPad, 1, (text) => theme.bg(bg, text));
  box.addChild(content);
  return box;
}

const FALLBACK_PREVIEW_LINES = 10;

/** pi's `formatToolCallWithArgs` when expanded: the title, then one `key: value` line per argument. */
export function callFallback(toolName: string, args: unknown, theme: Theme): Text {
  const header = theme.fg("toolTitle", theme.bold(toolName));
  const entries = typeof args === "object" && args !== null && !Array.isArray(args)
    ? Object.entries(args)
    : [["args", args] as const];
  if (args == null || entries.length === 0) return new Text(header, 0, 0);
  const lines = entries.map(([key, value]) => {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- JSON.stringify returns undefined for undefined, a function or a symbol, despite its declared type
    const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
    return `  ${key}: ${text.replace(/\t/g, "   ").replace(/\r/g, "").split("\n").join("\n    ")}`;
  });
  return new Text(`${header}\n${theme.fg("muted", lines.join("\n"))}`, 0, 0);
}

/** pi's text preview of a result: the first 10 lines and an expand hint when collapsed; nothing without text. */
export function resultFallback(
  result: AgentToolResult<unknown>,
  context: ToolRenderContext,
  theme: Theme,
): Text | undefined {
  const output = textOutput(result, context.showImages);
  if (!output) return undefined;
  const lines = output.split("\n");
  const shown = context.expanded ? lines : lines.slice(0, FALLBACK_PREVIEW_LINES);
  const remaining = lines.length - shown.length;
  let text = shown.map((line) => theme.fg("toolOutput", line)).join("\n");
  if (remaining > 0) {
    text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${context.keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
  }
  return new Text(text, 0, 0);
}

/** pi's `getTextOutput`: text blocks without escape and control codes, plus image placeholders when images are not drawn. */
function textOutput(result: AgentToolResult<unknown>, showImages: boolean): string {
  const texts = result.content.flatMap((c) => (c.type === "text" ? [c] : []));
  const images = result.content.flatMap((c) => (c.type === "image" ? [c] : []));
  let output = texts
    // oxlint-disable-next-line no-control-regex -- strips control characters on purpose, as pi's getTextOutput does
    .map((c) => stripVTControlCharacters(c.text || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g, "").replace(/\r/g, ""))
    .join("\n");
  if (images.length > 0 && (!getCapabilities().images || !showImages)) {
    const placeholders = images
      .map((img) => {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- same fallback as pi's getTextOutput (render-utils.js): image blocks from extension tools are not validated, so mimeType can be missing
        const mimeType = img.mimeType ?? "image/unknown";
        const dims = img.data && img.mimeType ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
        return imageFallback(mimeType, dims);
      })
      .join("\n");
    output = output ? `${output}\n${placeholders}` : placeholders;
  }
  return output;
}

/** Argument keys that best describe a call, in order of preference. */
const HINT_KEYS = ["command", "path", "file_path", "pattern", "query", "url", "code", "description"];

/** The collapsed row: `▸ <tool> <short hint>  ✓ 1.2s`. */
export function quietLine(toolName: string, context: ToolRenderContext, theme: Theme): Component {
  const head = `${theme.fg("muted", "▸ ")}${theme.fg("toolTitle", toolName)}`;
  return new QuietLine(head, argHint(context.args), statusText(context, theme), theme);
}

/**
 * `▸ <tool> <hint>  <status>` on one line. The plain hint is shortened first so the status stays
 * visible; the whole line is cut only when the tool name and status alone do not fit. No reset code
 * is added: pi-tui's `truncateToWidth` ends with `\x1b[0m`, which also clears the row background.
 */
class QuietLine implements Component {
  head: string;
  hint: string;
  tail: string;
  theme: Theme;

  constructor(head: string, hint: string, tail: string, theme: Theme) {
    this.head = head;
    this.hint = hint;
    this.tail = tail;
    this.theme = theme;
  }

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

/** First meaningful line of the most descriptive string argument, skipping comment lines such as `// @options`. */
function argHint(args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const record = args as Record<string, unknown>;
  const key = HINT_KEYS.find((k) => typeof record[k] === "string") ??
    Object.keys(record).find((k) => typeof record[k] === "string");
  if (!key) return "";
  const lines = (record[key] as string).split("\n").map((line) => line.trim());
  return lines.find((line) => line && !line.startsWith("//") && !line.startsWith("#")) ?? lines[0];
}

function statusText(context: ToolRenderContext, theme: Theme): string {
  if (context.isError) return theme.fg("error", "✗");
  if (context.isPartial) return theme.fg("muted", "…");
  const duration = context.durationMs === undefined ? "" : ` ${formatDuration(context.durationMs)}`;
  return theme.fg("success", "✓") + theme.fg("muted", duration);
}
