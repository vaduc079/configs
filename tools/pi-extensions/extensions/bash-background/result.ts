/** The message a finished background command posts, and its row in the chat. */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { collapsibleRow } from "../../src/collapsible-row.ts";
import { cutToWidth, formatDuration } from "../../src/format.ts";
import type { JobEnd } from "./job.ts";

const RESULT_TYPE = "bash-background-result";

export type ResultDetails = JobEnd & { id: string; command: string; logPath: string; durationMs: number };

export function postResult(pi: ExtensionAPI, details: ResultDetails, triggerTurn: boolean) {
  const { id, command, status, durationMs, logPath, output } = details;
  pi.sendMessage<ResultDetails>(
    {
      customType: RESULT_TYPE,
      display: true,
      content: [
        `Background command ${id} finished after ${formatDuration(durationMs)}: ${status}`,
        `$ ${command}`,
        `Last lines of output (full log: ${logPath}):`,
        output || "(no output)",
      ].join("\n"),
      details,
    },
    { triggerTurn },
  );
}

/**
 * One row in the style of a subagent result: `▸ bash <command>  ✓ 5.0s`, the command cut to fit the line. Click it, or
 * press ctrl+o, to see the full command, the log path, and the last lines of output.
 */
export function registerResultRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer<ResultDetails>(RESULT_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details;
    // Every result carries details; without them pi's default row is shown.
    if (!details) return undefined;
    return collapsibleRow({
      message,
      expanded,
      outputPad,
      background: (text) => theme.bg(succeeded(details) ? "toolSuccessBg" : "toolErrorBg", text),
      fill: (box, open) => {
        // The header is built at render time: only then is the width known that the command is cut to.
        box.addChild({ render: (width) => new Text(resultHeader(details, open, theme, width), 0, 0).render(width), invalidate() {} });
        if (!open) return;
        box.addChild(new Text(theme.fg("toolOutput", `$ ${details.command}`), 0, 0));
        box.addChild(new Text(theme.fg("dim", `log: ${details.logPath}`), 0, 0));
        box.addChild(new Text(theme.fg("toolOutput", details.output || "(no output)"), 0, 0));
      },
    });
  });
}

const succeeded = (details: ResultDetails) => details.status === "exit 0";

/** Shortest command cut kept when the status is long (a left-running `&` warning): the line then wraps. */
const MIN_COMMAND_WIDTH = 20;

function resultHeader(details: ResultDetails, open: boolean, theme: Theme, width: number) {
  const duration = formatDuration(details.durationMs);
  const status = succeeded(details)
    ? theme.fg("success", "✓") + theme.fg("muted", ` ${duration}`)
    : theme.fg("error", "✗") + theme.fg("muted", ` ${details.status} · ${duration}`);
  const head = `${theme.fg("muted", open ? "▾ " : "▸ ")}${theme.fg("toolTitle", "bash")} `;
  const room = width - visibleWidth(`${head}  ${status}`);
  const command = cutToWidth(details.command.replace(/\s+/g, " "), Math.max(MIN_COMMAND_WIDTH, room));
  return `${head}${theme.fg("dim", command)}  ${status}`;
}
