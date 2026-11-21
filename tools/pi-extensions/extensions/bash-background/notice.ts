import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { InboxMessage } from "../../src/inbox.ts";
import { collapsibleRow } from "../../src/collapsible-row.ts";
import { formatElapsed } from "../../src/format.ts";

const NOTICE_TYPE = "bash-background-notice";

type NoticeDetails = { summary: string };

type Command = { id: string; command: string; logPath: string };

export function runningMessage(jobs: (Command & { startedAt: number })[]): InboxMessage {
  return notice(`${count(jobs.length)} still running`, [
    "Background commands still running:",
    ...jobs.map((job) => `- ${job.id} (running ${formatElapsed(Date.now() - job.startedAt)}): ${job.command}\n  log: ${job.logPath}`),
    "Each posts a message when it exits. To stop one, call background_stop with its id.",
  ]);
}

export function interruptedMessage(jobs: Command[]): InboxMessage {
  return notice(`${count(jobs.length)} interrupted when pi stopped`, [
    "Background commands interrupted: pi stopped while they ran, or before their results were posted. Their output so far is in the log.",
    ...jobs.map((job) => `- ${job.id}: ${job.command}\n  log: ${job.logPath}`),
  ]);
}

const count = (n: number) => `${n} background ${n === 1 ? "command" : "commands"}`;

function notice(summary: string, lines: string[]): InboxMessage {
  const details: NoticeDetails = { summary };
  return { customType: NOTICE_TYPE, display: true, content: lines.join("\n"), details };
}

export function registerNoticeRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer<NoticeDetails>(NOTICE_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details;
    if (!details) return undefined;
    return collapsibleRow({
      message,
      expanded,
      outputPad,
      background: (text) => theme.bg("customMessageBg", text),
      fill: (box, open) => {
        box.addChild(new Text(`${theme.fg("muted", open ? "▾ " : "▸ ")}${theme.fg("toolTitle", "bash")} ${theme.fg("dim", details.summary)}`, 0, 0));
        if (open && typeof message.content === "string") box.addChild(new Text(theme.fg("customMessageText", message.content), 0, 0));
      },
    });
  });
}
