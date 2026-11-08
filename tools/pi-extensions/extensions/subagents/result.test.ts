import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { blockBody, postResult, type ResultDetails } from "./result.ts";
import type { Subagent } from "./subagent.ts";

test("a result is posted as a subagent_response block with its details", () => {
  const sent: { message: { content: string; details: ResultDetails }; options: { triggerTurn?: boolean } }[] = [];
  const pi = { sendMessage: (message: never, options: never) => sent.push({ message, options }) } as unknown as ExtensionAPI;
  const child = { id: "s1", agent: { name: "general" }, description: "find bug" } as Subagent;
  postResult(pi, "/tmp/sessions", child, { state: "completed", text: "found it", usage: { turns: 1, input: 2, output: 3, cost: 0 }, durationMs: 1_000 }, false);

  assert.equal(sent.length, 1);
  const { message, options } = sent[0];
  assert.equal(message.content, '<subagent_response sessionID="s1" state="completed" description="find bug">\nfound it\n</subagent_response>');
  assert.equal(blockBody(message.content), "found it");
  assert.deepEqual(message.details, {
    sessionID: "s1",
    agent: "general",
    description: "find bug",
    state: "completed",
    usage: { turns: 1, input: 2, output: 3, cost: 0 },
    durationMs: 1_000,
    fullOutputPath: undefined,
  });
  assert.equal(options.triggerTurn, false);
});
