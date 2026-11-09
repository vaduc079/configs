// Needs pi's packages at runtime: run `npm run link-pi` once (links pi's node_modules here).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Subagent } from "./subagent.ts";
import { modelLabel, registerResultRenderer, SubagentList } from "./ui.ts";

type Row = { render(width: number): string[]; handleMouse(event: unknown): unknown };
type Renderer = (message: unknown, options: { expanded: boolean }, theme: unknown) => Row;

let renderer: Renderer | undefined;
registerResultRenderer({ registerMessageRenderer: (_type: string, r: Renderer) => (renderer = r) } as unknown as ExtensionAPI);
const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };

const result = (state: string) => ({
  content: `<subagent_response sessionID="s1" state="${state}" description="find bug">\nline 1\nline 2\nline 3\nline 4\n</subagent_response>`,
  details: {
    sessionID: "s1",
    agent: "general",
    description: "find bug",
    state,
    usage: { turns: 2, input: 10, output: 5, cost: 0.01 },
    durationMs: 62_400,
  },
});
const render = (message: unknown, expanded: boolean) => renderer!(message, { expanded }, theme);
const text = (row: Row) => row.render(80).map((line) => line.trim()).filter(Boolean);
const click = (row: Row) => row.handleMouse({ type: "click", button: "left", x: 1, y: 1, width: 80, height: 3 });

test("a result shows as one row until it is clicked open", () => {
  const message = result("completed");
  const row = render(message, false);
  assert.deepEqual(text(row), ['▸ subagent general "find bug"  ✓ 1m 2s']);

  click(row);
  assert.deepEqual(text(row), [
    '▾ subagent general "find bug"  ✓ 1m 2s · 2 turns ↑10 ↓5 $0.0100',
    "sessionID: s1",
    "line 1",
    "line 2",
    "line 3",
    "line 4",
  ]);
  assert.equal(text(render(message, false)).length, 6, "the click survives a rebuild");
});

test("ctrl+o overrides a click, and pressing it again collapses the row", () => {
  const message = result("completed");
  click(render(message, false));
  assert.equal(text(render(message, true)).length, 6);
  assert.equal(text(render(message, false)).length, 1);
});

test("the running list names the model and thinking level the child reports, else the requested ones", () => {
  const child = (effective?: Subagent["effective"], thinking?: string) =>
    ({ model: { provider: "anthropic", id: "claude-opus-5-5", thinking }, effective }) as Subagent;
  assert.equal(modelLabel(child({ model: "Claude Opus 5.5", thinking: "medium" })), "Opus 5.5 medium");
  assert.equal(modelLabel(child(undefined, "high")), "claude-opus-5-5 high");
  assert.equal(modelLabel(child()), "claude-opus-5-5");
  assert.equal(modelLabel(child({ model: "Claude Opus 5.5", thinking: "off" })), "Opus 5.5 thinking off");
});

test("a failed result shows a three-line preview when collapsed", () => {
  assert.deepEqual(text(render(result("error"), false)), ['▸ subagent general "find bug"  ✗ error 1m 2s', "line 1", "line 2", "line 3"]);
});

type ListChild = Pick<Subagent, "id" | "description" | "state" | "runStartedAt" | "lastRun" | "model" | "effective" | "agent">;

function listSetup(children: ListChild[], copyError?: Error) {
  const aborted: string[] = [];
  const copied: string[] = [];
  let closed = false;
  const keys: Record<string, string> = { "tui.select.cancel": "esc", "tui.select.up": "up", "tui.select.down": "down" };
  const list = new SubagentList({
    subagents: {
      list: () => children as Subagent[],
      abort: async (id) => {
        aborted.push(id);
      },
    },
    theme: theme as unknown as Theme,
    keybindings: { matches: (data, binding) => keys[binding] === data },
    openCommand: (id) => `pi --session ${id}`,
    copy: async (text) => {
      if (copyError) throw copyError;
      copied.push(text);
    },
    requestRender: () => {},
    done: () => (closed = true),
  });
  const lines = () => list.render(120).map((line) => line.trim()).filter((line) => line && !line.startsWith("─"));
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { list, lines, aborted, copied, closed: () => closed, settle };
}

const child = (id: string, state: Subagent["state"], lastRun?: Subagent["lastRun"]): ListChild => ({
  id,
  description: `task ${id}`,
  state,
  runStartedAt: Date.now() - 62_000,
  lastRun,
  model: { provider: "anthropic", id: "claude-haiku-5-5", thinking: "low" },
  effective: undefined,
  agent: { name: "general", description: "", systemPrompt: "" },
});

test("/subagents lists running children first, then newest first, with how each last run ended", (t) => {
  const { list, lines } = listSetup([
    child("a", "stopped", { state: "completed", durationMs: 243_000 }),
    child("b", "running"),
    child("c", "idle", { state: "error", durationMs: 1_500 }),
    child("d", "stopped", { state: "cancelled" }),
  ]);
  t.after(() => list.dispose());
  assert.deepEqual(lines(), [
    "Subagents",
    "→ general · task b · claude-haiku-5-5 low · running 1m 2s",
    "general · task d · claude-haiku-5-5 low · cancelled",
    "general · task c · claude-haiku-5-5 low · error 1.5s",
    "general · task a · claude-haiku-5-5 low · completed 4m 3s",
    "↑↓ navigate  x abort  c copy open command  esc close",
  ]);
});

test("x aborts only a running child; c copies the open command of the selected child", async (t) => {
  const { list, aborted, copied, lines, settle } = listSetup([child("a", "idle", { state: "completed" }), child("b", "running")]);
  t.after(() => list.dispose());
  list.handleInput("x");
  list.handleInput("j");
  list.handleInput("x");
  list.handleInput("c");
  await settle();
  assert.deepEqual(aborted, ["b"]);
  assert.deepEqual(copied, ["pi --session a"]);
  assert.ok(lines().includes("Copied: pi --session a"));
});

test("a failed copy shows under the rows, and esc closes the list", async (t) => {
  const { list, lines, closed, settle } = listSetup([child("a", "running")], new Error("no clipboard"));
  t.after(() => list.dispose());
  list.handleInput("c");
  await settle();
  assert.ok(lines().includes("Copy failed: no clipboard"));
  list.handleInput("esc");
  assert.equal(closed(), true);
});

test("a key acts on the highlighted child even if the rows reorder before it is pressed", async (t) => {
  const children = [child("a", "idle", { state: "completed" }), child("b", "running")];
  const { list, lines, copied, settle } = listSetup(children);
  t.after(() => list.dispose());
  assert.ok(lines()[1].startsWith("→ general · task b"));
  children.push(child("c", "running"));
  list.handleInput("c");
  await settle();
  assert.deepEqual(copied, ["pi --session b"]);
});

test("esc closes the list even when no child is left", (t) => {
  const children = [child("a", "running")];
  const { list, closed } = listSetup(children);
  t.after(() => list.dispose());
  children.pop();
  list.handleInput("esc");
  assert.equal(closed(), true);
});
