/** The model-facing tools: `subagent` (start, steer, or follow up) and `subagent_models`. */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Agent } from "./agents.ts";
import type { Subagents } from "./manager.ts";
import * as subagentPrompt from "./prompts/subagent.ts";
import * as modelsPrompt from "./prompts/subagent-models.ts";
import { type ModelChoice, THINKING_LEVELS, type Thinking } from "./subagent.ts";

export function registerTools(pi: ExtensionAPI, agents: Agent[], current: () => Subagents) {
  pi.registerTool({
    name: "subagent_models",
    label: "Subagent models",
    description: modelsPrompt.DESCRIPTION,
    promptSnippet: modelsPrompt.PROMPT_SNIPPET,
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: modelsPrompt.PARAMETERS.query })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const query = params.query?.toLowerCase() ?? "";
      const scoped = ctx.scopedModels.map((entry) => entry.model);
      const current = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      const lines = (scoped.length > 0 ? scoped : ctx.modelRegistry.getAvailable())
        .filter((model) => `${model.provider}/${model.id} ${model.name}`.toLowerCase().includes(query))
        .map((model) => {
          const ref = `${model.provider}/${model.id}`;
          return `${ref}${model.name ? ` (${model.name})` : ""}${model.reasoning ? ", reasoning" : ""}${ref === current ? ", current" : ""}`;
        });
      const text = lines.length > 0 ? lines.join("\n") : `No models match "${params.query}".`;
      return { content: [{ type: "text", text }], details: undefined };
    },
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: subagentPrompt.description(agents),
    promptSnippet: subagentPrompt.PROMPT_SNIPPET,
    parameters: Type.Object({
      agent: StringEnum(agents.map((agent) => agent.name) as [string, ...string[]], {
        description: subagentPrompt.PARAMETERS.agent,
      }),
      description: Type.String({ description: subagentPrompt.PARAMETERS.description }),
      prompt: Type.String({ description: subagentPrompt.PARAMETERS.prompt }),
      model: Type.String({ description: subagentPrompt.PARAMETERS.model }),
      thinking: Type.Optional(StringEnum(THINKING_LEVELS, { description: subagentPrompt.PARAMETERS.thinking })),
      sessionID: Type.Optional(Type.String({ description: subagentPrompt.PARAMETERS.sessionID })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const agent = agents.find((candidate) => candidate.name === params.agent);
      if (!agent) throw new Error(`Unknown agent "${params.agent}".`);
      const model = resolveModel(ctx, params.model, params.thinking as Thinking | undefined);

      if (params.sessionID) {
        const outcome = await current().message(params.sessionID, params.prompt, model);
        const text =
          outcome === "steered"
            ? `Subagent ${params.sessionID} steered; it gets the message after its current step. You will be notified when it finishes.`
            : `Subagent ${params.sessionID} is running again with the new prompt. You will be notified when it finishes.`;
        return { content: [{ type: "text", text }], details: { sessionID: params.sessionID, outcome } };
      }

      const subagent = await current().start({ agent, description: params.description, prompt: params.prompt, model });
      const text = `Subagent started in the background (sessionID: ${subagent.id}). You will be notified when it finishes; do not poll it.`;
      return { content: [{ type: "text", text }], details: { sessionID: subagent.id, outcome: "started" } };
    },
    renderCall(args, theme) {
      const target = args.sessionID ? theme.fg("warning", " → ") + theme.fg("dim", String(args.sessionID).slice(0, 8)) : "";
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent ")) +
        theme.fg("accent", `${args.agent ?? ""}`) +
        target +
        theme.fg("muted", ` "${args.description ?? ""}"`) +
        theme.fg("dim", ` ${args.model ?? ""}`),
        0,
        0,
      );
    },
  });
}

function resolveModel(ctx: ExtensionContext, input: string, thinking: Thinking | undefined): ModelChoice {
  const slash = input.indexOf("/");
  const provider = input.slice(0, slash);
  const id = input.slice(slash + 1);
  const available = ctx.modelRegistry.getAvailable().some((model) => model.provider === provider && model.id === id);
  if (slash <= 0 || !available)
    throw new Error(`Model "${input}" is not available. Call subagent_models to list valid "provider/id" values.`);
  return { provider, id, thinking };
}
