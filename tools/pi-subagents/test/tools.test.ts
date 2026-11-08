// Needs pi's packages at runtime: run `npm run link-pi` once (links pi's node_modules here).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Agent } from "../agents.ts";
import type { Subagents } from "../manager.ts";
import { registerTools } from "../tools.ts";

type Row = { render(width: number): string[] };
type Tool = { name: string; renderCall(args: unknown, theme: unknown, context: { expanded: boolean }): Row };

const tools: Tool[] = [];
const general: Agent = { name: "general", description: "General agent", systemPrompt: "" };
registerTools({ registerTool: (tool: Tool) => tools.push(tool) } as unknown as ExtensionAPI, [general], () => ({}) as Subagents);
const subagent = tools.find((tool) => tool.name === "subagent")!;
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const render = (args: object, expanded: boolean) =>
  subagent.renderCall(args, theme, { expanded }).render(200).map((line) => line.trimEnd());

const args = { agent: "general", description: "find bug", model: "anthropic/claude-opus-5-5", prompt: "Look at auth.ts.\nReport the bug." };

test("a call shows its model and thinking level, or the default when none is given", () => {
  assert.deepEqual(render({ ...args, thinking: "high" }, false), ['subagent general "find bug" anthropic/claude-opus-5-5 · thinking high']);
  assert.deepEqual(render(args, false), ['subagent general "find bug" anthropic/claude-opus-5-5 · thinking default']);
  assert.deepEqual(render({ agent: "general", description: "find bug" }, false), ['subagent general "find bug"'], "model not streamed in yet");
});

test("an expanded call also shows the full sessionID and the prompt", () => {
  assert.deepEqual(render({ ...args, thinking: "low", sessionID: "12345678-aaaa" }, true), [
    'subagent general → 12345678 "find bug" anthropic/claude-opus-5-5 · thinking low',
    "sessionID: 12345678-aaaa",
    "",
    "Look at auth.ts.",
    "Report the bug.",
  ]);
});
