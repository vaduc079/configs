import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askUser, type PromptUi } from "./prompt.ts";
import type { Rule } from "./types.ts";

async function titleFor(toolName: string, input: unknown, rule?: Rule): Promise<string> {
  const { ui, calls } = selectUi(() => undefined);
  await askUser(ui, { toolName, action: toolName, resource: "*", rule, input });
  return calls.title;
}

/** A `select` that picks by `pick`; `undefined` is a dismissed dialog. */
function selectUi(pick: (options: string[]) => string | undefined) {
  const calls = { title: "", options: [] as string[], opts: undefined as unknown };
  const ui = {
    select: async (title: string, options: string[], opts: unknown) => {
      Object.assign(calls, { title, options, opts });
      return pick(options);
    },
  };
  return { ui: ui as unknown as PromptUi, calls };
}

const request = { toolName: "bash", action: "shell", resource: "deploy *", input: { command: "deploy prod" } };

describe("dialog", () => {
  it("reports pi as blocked on a permission and returns the picked option", async () => {
    const { ui, calls } = selectUi((options) => options[0]);
    assert.deepEqual(await askUser(ui, request), { allow: true });
    assert.equal(calls.title, "Run bash command?\n\n  deploy prod\n\nRule: ask · shell deploy *");
    assert.deepEqual(calls.options, ["Allow", "Deny", "Deny with reason"]);
    assert.deepEqual(calls.opts, { blockedKind: "permission" });
  });
  it("Deny denies", async () => {
    const { ui } = selectUi((options) => options[1]);
    assert.deepEqual(await askUser(ui, request), { allow: false });
  });
  it("a dismissed dialog denies", async () => {
    const { ui } = selectUi(() => undefined);
    assert.deepEqual(await askUser(ui, request), { allow: false });
  });
  it("Deny with reason sends the trimmed reason to the model", async () => {
    const { ui } = selectUi((options) => options[2]);
    const withReason = { ...ui, input: async () => "  too risky " } as PromptUi;
    assert.deepEqual(await askUser(withReason, request), { allow: false, reason: "too risky" });
    const blank = { ...ui, input: async () => " " } as PromptUi;
    assert.deepEqual(await askUser(blank, request), { allow: false });
  });
});

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
    const keys = [...title.matchAll(/^ {4}"(\w+)"/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ["channel", "page_id", "pageId", "issueIdOrKey", "cloudId", "b", "a"]);
  });
  it("bash shows the command first and the matched rule last; non-objects are untouched", async () => {
    const rule: Rule = { action: "shell", resource: "glab mr approve *", effect: "ask" };
    assert.equal(
      await titleFor("bash", { command: "false && glab mr approve 1" }, rule),
      "Run bash command?\n\n  false && glab mr approve 1\n\nRule: ask · shell glab mr approve *",
    );
    assert.ok((await titleFor("x", [1, 2])).includes("1,"));
  });
});
