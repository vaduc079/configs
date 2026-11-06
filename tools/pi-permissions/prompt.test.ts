import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askUser } from "./prompt.ts";

async function titleFor(toolName: string, input: unknown): Promise<string> {
  let title = "";
  await askUser(
    {
      select: async (t) => {
        title = t;
        return "Deny";
      },
      input: async () => undefined,
    },
    { toolName, action: toolName, resource: "*", input },
  );
  return title;
}

describe("preview", () => {
  it("target keys come first, so a long text cannot push them past the cut", async () => {
    const title = await titleFor("mcp__slack__slack_send_message", {
      text: "x".repeat(5000),
      channel_id: "C123",
      thread_ts: "1.2",
    });
    assert.ok(title.includes("(truncated)"));
    assert.ok(title.indexOf('"channel_id": "C123"') < title.indexOf('"text"'));
    assert.ok(title.includes('"thread_ts": "1.2"'));
  });
  it("other keys keep their original order; all target keys are lifted", async () => {
    const title = await titleFor("mcp__atlassian__x", { b: 1, cloudId: "c", a: 2, issueIdOrKey: "K-1", page_id: "p", pageId: "q", channel: "n" });
    const keys = [...title.matchAll(/^  "(\w+)"/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ["channel", "page_id", "pageId", "issueIdOrKey", "cloudId", "b", "a"]);
  });
  it("bash still shows the command; non-objects are untouched", async () => {
    assert.ok((await titleFor("bash", { command: "glab mr approve 1" })).endsWith("glab mr approve 1"));
    assert.ok((await titleFor("x", [1, 2])).includes("1,"));
  });
});
