import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { askUser, type PromptUi } from "./prompt.ts";
import type { Rule } from "./types.ts";

// Interactive mode sets pi's theme before any dialog; the selector reads it.
initTheme();

async function titleFor(toolName: string, input: unknown, rule?: Rule): Promise<string> {
  const { ui, calls } = customUi("\x1b");
  await askUser(ui, { toolName, action: toolName, resource: "*", rule, input });
  return calls.options.blocked.message;
}

/**
 * Shows the custom dialog and presses `keys` in it, as interactive mode would. On close, the editor holds
 * `calls.afterDialog`, as pi's draft restore leaves it.
 */
function customUi(...keys: string[]) {
  const calls = { options: { blocked: { message: "" } }, editor: "draft", afterDialog: "draft", setEditorText: 0 };
  const ui = {
    custom: (
      factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (result: unknown) => void) => Component,
      options: typeof calls.options,
    ) =>
      new Promise((resolve) => {
        calls.options = options;
        const close = (result: unknown) => {
          calls.editor = calls.afterDialog;
          resolve(result);
        };
        const dialog = factory(undefined, undefined, undefined, close);
        for (const key of keys) dialog.handleInput?.(key);
      }),
    getEditorText: () => calls.editor,
    setEditorText: (text: string) => {
      calls.setEditorText++;
      calls.editor = text;
    },
  };
  return { ui: ui as unknown as PromptUi, calls };
}

const request = { toolName: "bash", action: "shell", resource: "deploy *", input: { command: "deploy prod" } };

describe("dialog", () => {
  it("reports pi as blocked on a permission and returns the picked option", async () => {
    const { ui, calls } = customUi("\r");
    assert.deepEqual(await askUser(ui, request), { allow: true });
    assert.deepEqual(calls.options, {
      blocked: { kind: "permission", message: "Run bash command?\n\n  deploy prod\n\nRule: ask · shell deploy *" },
    });
  });
  it("Deny is the second option", async () => {
    const { ui } = customUi("\x1b[B", "\r");
    assert.deepEqual(await askUser(ui, request), { allow: false });
  });
  it("a dismissed dialog denies", async () => {
    const { ui } = customUi("\x1b");
    assert.deepEqual(await askUser(ui, request), { allow: false });
  });
  it("puts back a draft whose large paste pi's restore dropped, and leaves an intact draft alone", async () => {
    const lost = customUi("\r");
    lost.calls.editor = "see this:\n" + "line\n".repeat(20);
    lost.calls.afterDialog = "see this:\n[paste #1 +20 lines]";
    await askUser(lost.ui, request);
    assert.equal(lost.calls.editor, "see this:\n" + "line\n".repeat(20));
    const intact = customUi("\r");
    await askUser(intact.ui, request);
    assert.equal(intact.calls.setEditorText, 0);
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
