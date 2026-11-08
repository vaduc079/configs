/** Model-facing text for the `subagent` tool: its system-prompt line, description, and parameter descriptions. */
import type { Agent } from "../agents.ts";

export const PROMPT_SNIPPET = "Run an agent in a background child session; its final response arrives as a message";

export function description(agents: Agent[]) {
  return [
    "Start an agent in a child session to work on a task in the background. Returns at once with a sessionID; you are notified with the child's final response when it finishes.",
    "DO NOT sleep, poll, or check on a running subagent, and do not duplicate its work or edit the files it is working on.",
    "DO NOT assign a subagent a higher reasoning level than your own unless specifically requested.",
    "A new subagent starts with no context: put everything it needs in the prompt.",
    "To redirect a running subagent or follow up with a finished one, call subagent again with its sessionID. A running subagent receives the prompt after its current step.",
    "",
    "Available agents:",
    ...agents.map((agent) => `- ${agent.name}: ${agent.description}`),
  ].join("\n");
}

export const PARAMETERS = {
  agent: "Agent to run",
  description: "A short 3-5 word label for the task, shown to the user",
  prompt: "The task, or the follow-up message when sessionID is set",
  model: 'Model as "provider/id", for example the one you run on. Look it up with subagent_models; do not guess IDs.',
  thinking: "Set the thinking level for reasoning models.",
  sessionID: "Continue or steer an existing subagent. Omit to start a new one.",
};
