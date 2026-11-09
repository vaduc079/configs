/** The message a finished background command posts, and its row in the chat. */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { collapsibleRow } from "../../src/collapsible-row.ts";
import { formatDuration } from "../../src/format.ts";
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
 * One row in the style of a subagent result: `▸ bash <command>  ✓ 5.0s`. Click it, or press ctrl+o, to see the log
 * path and the last lines of output.
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
        box.addChild(new Text(resultHeader(details, open, theme), 0, 0));
        if (!open) return;
        box.addChild(new Text(theme.fg("dim", `log: ${details.logPath}`), 0, 0));
        box.addChild(new Text(theme.fg("toolOutput", details.output || "(no output)"), 0, 0));
      },
    });
  });
}

const succeeded = (details: ResultDetails) => details.status === "exit 0";

function resultHeader(details: ResultDetails, open: boolean, theme: Theme) {
  const command = details.command.split("\n")[0];
  const head = `${theme.fg("muted", open ? "▾ " : "▸ ")}${theme.fg("toolTitle", "bash")} ${theme.fg("dim", command)}`;
  const duration = formatDuration(details.durationMs);
  const status = succeeded(details)
    ? theme.fg("success", "✓") + theme.fg("muted", ` ${duration}`)
    : theme.fg("error", "✗") + theme.fg("muted", ` ${details.status} · ${duration}`);
  return `${head}  ${status}`;
}
