import assert from "node:assert/strict";
import { test } from "node:test";
import { blockBody, resultMessage } from "./result.ts";
import type { Subagent } from "./subagent.ts";

test("a result is a subagent_response block with its details", () => {
  const child = { id: "s1", agent: { name: "general" }, description: "find bug" } as Subagent;
  const message = resultMessage("/tmp/sessions", child, { state: "completed", text: "found it", usage: { turns: 1, input: 2, output: 3, cost: 0 }, durationMs: 1_000 });

  assert.equal(message.content, '<subagent_response sessionID="s1" state="completed" description="find bug">\nfound it\n</subagent_response>');
  assert.equal(blockBody(message.content as string), "found it");
  assert.deepEqual(message.details, {
    sessionID: "s1",
    agent: "general",
    description: "find bug",
    state: "completed",
    usage: { turns: 1, input: 2, output: 3, cost: 0 },
    durationMs: 1_000,
    fullOutputPath: undefined,
  });
});
