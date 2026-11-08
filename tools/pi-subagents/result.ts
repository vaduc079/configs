/**
 * Posts a finished run back into the parent session as a `subagent-result` message.
 * Long text is cut like OpenCode's tool output (packages/core/src/tool-output.ts).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { JobEntry } from "./manager.ts";
import type { RunResult, RunState, Subagent, Usage } from "./subagent.ts";

export const RESULT_TYPE = "subagent-result";

export type ResultDetails = {
  sessionID: string;
  agent: string;
  description: string;
  state: RunState;
  usage: Usage;
  /** Unset on results saved before it was added. */
  durationMs?: number;
  fullOutputPath?: string;
};

const MAX_LINES = 2_000;
const MAX_BYTES = 50 * 1024;

type HeldResult = { subagent: Subagent; result: RunResult; delivered(): void };

/**
 * Delivers results without pi's follow-up queue, which Esc empties. While the parent is busy, results wait
 * here and go out when it settles: after a normal finish the last one starts a turn; after Esc none does,
 * so they show in the chat and wait for the user's next message.
 */
export class ResultDelivery {
  private readonly pi: ExtensionAPI;
  private readonly sessionDir: string;
  private readonly isIdle: () => boolean;
  private held: HeldResult[] = [];

  constructor(pi: ExtensionAPI, sessionDir: string, isIdle: () => boolean) {
    this.pi = pi;
    this.sessionDir = sessionDir;
    this.isIdle = isIdle;
  }

  deliver(subagent: Subagent, result: RunResult, delivered: () => void) {
    if (!this.isIdle()) {
      this.held.push({ subagent, result, delivered });
      return;
    }
    this.post({ subagent, result, delivered }, true);
  }

  /**
   * Posts the held results; the last starts a turn if `startTurn`. Taken one at a time, so if posting one
   * throws, the rest stay held for the next flush.
   */
  flush(startTurn: boolean) {
    for (let item = this.held.shift(); item; item = this.held.shift()) this.post(item, startTurn && this.held.length === 0);
  }

  /** Compaction and /tree summaries also hold results (the parent is not idle) but end without `agent_settled`. */
  flushIfIdle() {
    if (this.isIdle()) this.flush(true);
  }

  private post({ subagent, result, delivered }: HeldResult, triggerTurn: boolean) {
    postResult(this.pi, this.sessionDir, subagent, result, triggerTurn);
    delivered();
  }
}

function postResult(pi: ExtensionAPI, sessionDir: string, subagent: Subagent, result: RunResult, triggerTurn: boolean) {
  const { text, fullOutputPath } = capText(result.text, path.join(sessionDir, `${subagent.id}-result-${Date.now()}.md`));
  pi.sendMessage<ResultDetails>(
    {
      customType: RESULT_TYPE,
      display: true,
      content: subagentBlock(subagent.id, result.state, subagent.description, text),
      details: {
        sessionID: subagent.id,
        agent: subagent.agent.name,
        description: subagent.description,
        state: result.state,
        usage: result.usage,
        durationMs: result.durationMs,
        fullOutputPath,
      },
    },
    { triggerTurn },
  );
}

/** Told on the parent's next prompt rather than starting a turn: pi just started and the user may not be there. */
export function deliverInterrupted(pi: ExtensionAPI, jobs: JobEntry[]) {
  pi.sendMessage(
    {
      customType: RESULT_TYPE,
      display: true,
      content: jobs
        .map((job) =>
          subagentBlock(
            job.id,
            "cancelled",
            job.description,
            "Interrupted when pi stopped. Call subagent with this sessionID to continue it.",
          ),
        )
        .join("\n"),
    },
    { deliverAs: "nextTurn" },
  );
}

function subagentBlock(id: string, state: RunState, description: string, text: string) {
  return `<subagent_response sessionID="${id}" state="${state}" description="${description}">\n${text}\n</subagent_response>`;
}

/** The text inside a block built by subagentBlock, for display. */
export function blockBody(content: string) {
  return content.replace(/^<subagent_response[^>]*>\n?/, "").replace(/\n?<\/subagent_response>$/, "");
}

function capText(text: string, fullOutputPath: string) {
  const lines = text.split("\n");
  if (lines.length <= MAX_LINES && Buffer.byteLength(text) <= MAX_BYTES) return { text };
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines.slice(0, MAX_LINES)) {
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > MAX_BYTES) break;
    kept.push(line);
  }
  fs.mkdirSync(path.dirname(fullOutputPath), { recursive: true });
  fs.writeFileSync(fullOutputPath, text);
  return {
    text: `${kept.join("\n")}\n[showing lines 1-${kept.length} of ${lines.length}; full output saved to ${fullOutputPath}]`,
    fullOutputPath,
  };
}
