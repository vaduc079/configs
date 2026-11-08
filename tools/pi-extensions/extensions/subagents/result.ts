/** Posts a finished run back into the parent session as a `subagent-response` message, long text capped. */
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { capText } from "../../src/output.ts";
import type { JobEntry } from "./manager.ts";
import type { RunResult, RunState, Subagent, Usage } from "./subagent.ts";

export const RESULT_TYPE = "subagent-response";

export type ResultDetails = {
  sessionID: string;
  agent: string;
  description: string;
  state: RunState;
  usage: Usage;
  durationMs: number;
  fullOutputPath?: string;
};

export function postResult(pi: ExtensionAPI, sessionDir: string, subagent: Subagent, result: RunResult, triggerTurn: boolean) {
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
