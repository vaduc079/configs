// Needs pi's packages at runtime: run `npm run link-pi` once (links pi's node_modules here).
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Subagents } from "./manager.ts";
import type { Subagent } from "./subagent.ts";
import { modelLabel, registerResultRenderer, registerSubagentsCommand, SessionUi, SubagentList } from "./ui.ts";

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

function listSetup(children: ListChild[], copyError?: Error, canFloat = true) {
  const aborted: string[] = [];
  const copied: string[] = [];
  const floated: string[] = [];
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
    openFloat: canFloat
      ? async (subagent) => {
          floated.push(subagent.id);
        }
      : undefined,
    copy: async (text) => {
      if (copyError) throw copyError;
      copied.push(text);
    },
    requestRender: () => {},
    done: () => (closed = true),
  });
  const lines = () => list.render(120).map((line) => line.trim()).filter((line) => line && !line.startsWith("─"));
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { list, lines, aborted, copied, floated, closed: () => closed, settle };
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
    "↑↓ navigate  x abort  o open in float  c copy open command  esc close",
  ]);
});

test("/subagents rows line up in columns; a long description is cut to 50 columns or the room left, at least 10", (t) => {
  const { list } = listSetup([
    { ...child("a", "stopped", { state: "completed", durationMs: 1_500 }), description: "short" },
    { ...child("b", "running"), description: `long\n${"x".repeat(80)}`, model: { provider: "anthropic", id: "claude-opus-5-5" } },
  ]);
  t.after(() => list.dispose());
  const rows = (width: number) => list.render(width).filter((line) => line.includes("general")).map((line) => line.trimEnd());
  const descriptions = (width: number) => [`long ${"x".repeat(width - 6)}…`, `short${" ".repeat(width - 5)}`];
  const [long, short] = descriptions(50);
  assert.deepEqual(rows(120), [
    ` → general · ${long} · claude-opus-5-5      · running 1m 2s`,
    `   general · ${short} · claude-haiku-5-5 low · completed 1.5s`,
  ]);
  // 80 columns leave 26 for the description: 80 - 4 (padding, marker) - 7 - 20 - 14 (other columns) - 9 (separators).
  const [long26, short26] = descriptions(26);
  assert.deepEqual(rows(80), [
    ` → general · ${long26} · claude-opus-5-5      · running 1m 2s`,
    `   general · ${short26} · claude-haiku-5-5 low · completed 1.5s`,
  ]);
  assert.ok(rows(40)[0].startsWith(` → general · ${descriptions(10)[0]} ·`));
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

test("o opens the selected child in a float, and says when it opened a snapshot of a live child", async (t) => {
  const { list, lines, floated, settle } = listSetup([
    child("a", "stopped", { state: "completed" }),
    child("b", "running"),
    child("c", "idle", { state: "completed" }),
  ]);
  t.after(() => list.dispose());
  list.handleInput("o");
  await settle();
  assert.match(lines().join(" "), /Opened a snapshot of task b: it is still running, so a message sent there starts a separate branch\./);
  list.handleInput("j");
  list.handleInput("o");
  await settle();
  assert.match(lines().join(" "), /Opened a snapshot of task c: it is still idle,/);
  list.handleInput("j");
  list.handleInput("o");
  await settle();
  assert.deepEqual(floated, ["b", "c", "a"]);
  assert.ok(lines().includes("Opened task a."));
});

test("o does nothing where pi can't open a float", (t) => {
  const { list, lines } = listSetup([child("a", "running")], undefined, false);
  t.after(() => list.dispose());
  list.handleInput("o");
  assert.equal(lines().at(-1), "↑↓ navigate  x abort  o open in float  c copy open command  esc close");
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

test("the running list shows a running child's name, time, description and model, without quotes", (t) => {
  const statuses = new Map<string, string | undefined>();
  const ui = { theme, setStatus: (key: string, text: string | undefined) => statuses.set(key, text) };
  const sessionUi = new SessionUi({ ui, hasUI: true } as unknown as ExtensionContext, () => [
    child("a", "stopped") as Subagent,
    child("b", "running") as Subagent,
  ]);
  t.after(() => sessionUi.dispose());
  sessionUi.renderRunningList();
  assert.equal(statuses.get("lines:subagents"), "└── general 1m 2s · task b · claude-haiku-5-5 low");
});

/**
 * Runs /subagents against a fake `rex` on PATH that logs its arguments, so the test covers the real Rex opener and its
 * process call. `REX_FAIL` makes the layer call fail the way rex does: a reason on stderr and a non-zero exit.
 */
async function openThroughRex(t: { after: (fn: () => void) => void }, failLayer: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-rex-"));
  const calls = path.join(dir, "calls");
  fs.writeFileSync(
    path.join(dir, "rex"),
    `#!/bin/sh
printf '%s\\n' "$@" -- >> "${calls}"
case "$1" in
  block) echo '{"block":{"window_id":"window:1"}}' ;;
  api) if [ -n "$REX_FAIL" ]; then echo "Error: window window:1 not found" >&2; exit 3; fi; echo '{}' ;;
esac
`,
    { mode: 0o755 },
  );
  const saved = { PATH: process.env.PATH, REX_SESSION: process.env.REX_SESSION, REX_BLOCK: process.env.REX_BLOCK, REX_FAIL: process.env.REX_FAIL };
  Object.assign(process.env, { PATH: `${dir}:${process.env.PATH}`, REX_SESSION: "session:1", REX_BLOCK: "block:1", REX_FAIL: failLayer ? "1" : "" });
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
  const pi = { registerCommand: (_name: string, command: { handler: typeof handler }) => (handler = command.handler) };
  const subagents = { list: () => [child("s1", "stopped", { state: "completed" })], abort: async () => {} };
  registerSubagentsCommand(pi as unknown as ExtensionAPI, () => subagents as unknown as Subagents, "/sessions", { width: 0.5, height: 0.4 });
  let list: SubagentList | undefined;
  const ui = {
    notify: () => {},
    custom: async (factory: (...args: unknown[]) => SubagentList) => {
      list = factory({ requestRender: () => {} }, theme, { matches: () => false }, () => {});
    },
  };
  await handler!("", { cwd: "/work", ui });
  t.after(() => list!.dispose());
  list!.handleInput("o");
  const lines = () => list!.render(200).map((line) => line.trim());
  for (let i = 0; i < 100 && !lines().some((line) => line.startsWith("Open")); i++) await new Promise((r) => setTimeout(r, 20));
  const invocations = fs.readFileSync(calls, "utf8").split("\n--\n").filter(Boolean).map((call) => call.split("\n"));
  return { invocations, notice: lines().find((line) => line.startsWith("Open")) };
}

test("o runs this pi's session command in a Rex float at the configured size, in the parent's cwd", async (t) => {
  const { invocations, notice } = await openThroughRex(t, false);
  assert.equal(notice, "Opened task s1.");
  assert.deepEqual(invocations[0], ["block", "inspect", "-s", "session:1", "block:1", "--json"]);
  assert.deepEqual(invocations[1].slice(0, 5), ["api", "call", "-s", "session:1", "session.new_layer"]);
  const layer = JSON.parse(invocations[1][5]) as { bounds: number[]; layout: { block: { label: string; options: { command: string[]; cwd: string } } } };
  assert.deepEqual(layer.bounds, [0.25, 0.3, 0.5, 0.4]);
  const { label, options } = layer.layout.block;
  assert.equal(label, "subagent: task s1");
  assert.equal(options.cwd, "/work");
  assert.equal(options.command[0], process.execPath);
  assert.deepEqual(options.command.slice(-4), ["--session", "s1", "--session-dir", "/sessions"]);
});

test("when rex fails, the list shows rex's reason", async (t) => {
  const { notice } = await openThroughRex(t, true);
  assert.equal(notice, "Open failed: Error: window window:1 not found");
});
