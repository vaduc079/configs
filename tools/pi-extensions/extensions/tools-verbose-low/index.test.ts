import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import {
  buildContextEntries,
  createReadToolDefinition,
  type ExtensionAPI,
  initTheme,
  type RegisteredCommand,
  type Theme,
  ToolExecutionComponent,
  type ToolRendererResolver,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Text, type TUI } from "@earendil-works/pi-tui";
import quietToolRows from "./index.ts";

initTheme("dark", false);

const cwd = process.cwd();
const WIDTH = 80;
// pi keeps tool renderers with `args: unknown`; a built-in tool definition types its args.
const read = createReadToolDefinition(cwd) as ToolRenderers;

type Handler = (event: unknown, ctx: unknown) => unknown;

/** Loads the extension against a fake pi, with its own agent dir holding `config` (no file when undefined). */
function load(config?: string) {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const configFile = path.join(agentDir, "tools-verbose-low.json");
  if (config !== undefined) writeFileSync(configFile, config);

  const handlers = new Map<string, Handler>();
  let resolver: ToolRendererResolver | undefined;
  let command: Omit<RegisteredCommand, "name" | "sourceInfo"> | undefined;
  quietToolRows({
    registerToolRenderer: (r: ToolRendererResolver) => (resolver = r),
    registerCommand: (name: string, options: typeof command) => {
      assert.equal(name, "tool-verbose");
      command = options;
    },
    on: (event: string, handler: Handler) => handlers.set(event, handler),
  } as unknown as ExtensionAPI);

  let branch: unknown[] = [];
  let toolsExpanded = false;
  const labels: (string | undefined)[] = [];
  const notes: [string, string | undefined][] = [];
  const ctx = {
    hasUI: true,
    ui: {
      getToolsExpanded: () => toolsExpanded,
      setHiddenThinkingLabel: (label?: string) => labels.push(label),
      notify: (message: string, type?: string) => notes.push([message, type]),
    },
    sessionManager: { getBranch: () => branch, buildContextEntries: () => buildContextEntries(branch as never) },
  };

  const invalidations = new Map<string, number>();
  const components = new Map<string, ToolExecutionComponent>();
  /** A tool row as pi builds it; counts each `context.invalidate` through the row's own `requestRender`. */
  function row(id: string, result?: { isError: boolean; text?: string }) {
    const ui = { requestRender: () => invalidations.set(id, (invalidations.get(id) ?? 0) + 1) } as unknown as TUI;
    const component = new ToolExecutionComponent("read", id, { path: `src/${id}.ts` }, {}, resolver!("read", () => read), ui, cwd);
    if (result) component.updateResult({ content: [{ type: "text", text: result.text ?? "ok" }], isError: result.isError, durationMs: 1200 });
    components.set(id, component);
    return component;
  }

  return {
    configFile,
    labels,
    notes,
    invalidations,
    row,
    emit: (event: string, payload: unknown = {}) => handlers.get(event)!(payload, ctx),
    /** Chains the entries into a branch; an entry may set its own id. */
    setBranch(entries: object[]) {
      let parentId: string | null = null;
      branch = entries.map((e, i) => {
        const chained: { id: string; parentId: string | null } = { id: `e${i}`, parentId, ...e };
        parentId = chained.id;
        return chained;
      });
    },
    start(entries: object[]) {
      this.setBranch(entries);
      handlers.get("session_start")!({ type: "session_start", reason: "startup" }, ctx);
    },
    setToolsExpanded(expanded: boolean) {
      toolsExpanded = expanded;
      for (const component of components.values()) component.setExpanded(expanded);
    },
    run: (args: string) => command!.handler(args, ctx as never),
    complete: (prefix: string) => command!.getArgumentCompletions!(prefix) as AutocompleteItem[],
  };
}

const assistant = (...content: unknown[]) => ({ role: "assistant", content, timestamp: 0 });
const call = (id: string) => ({ type: "toolCall", id, name: "read", arguments: { path: `src/${id}.ts` } });
const say = (text: string) => ({ type: "text", text });
const toolResult = (id: string, isError = false) => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "read",
  content: [{ type: "text", text: isError ? "boom" : "ok" }],
  isError,
  timestamp: 0,
});
const entry = (message: unknown) => ({ type: "message", message });
const customEntry = (customType: string, display: boolean) => ({ type: "custom_message", customType, content: "c", display });
/** Three calls in one message, their results, then text: one closed run [a, b, c]. */
const closedRun = (failing?: string) => [
  entry(assistant(call("a"), call("b"), call("c"))),
  ...["a", "b", "c"].map((id) => entry(toolResult(id, id === failing))),
  entry(assistant(say("done"))),
];

const plain = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line).trim());
const ok = { isError: false };

let theme: Theme | undefined;
new ToolExecutionComponent("probe", "p", {}, {}, { renderCall: (_args, t) => ((theme = t), new Text("", 0, 0)) }, { requestRender() {} } as unknown as TUI, cwd);

/** The same row drawn by a `normal` instance, which matches pi's default shell (frame.test.ts). */
function normalRow(id: string, options: { result?: { isError: boolean; text?: string }; expanded?: boolean } = {}) {
  const component = load().row(id, options.result);
  component.setExpanded(options.expanded ?? false);
  return component.render(WIDTH);
}

function click(component: ToolExecutionComponent, y: number) {
  const height = component.render(WIDTH).length;
  return component.handleMouse({ type: "click", button: "left", x: 2, y, screenX: 2, screenY: y, width: WIDTH, height, shift: false, alt: false, ctrl: false, clickCount: 1 });
}

test("low: a collapsed closed run draws one header on the leader, members take 0 lines", () => {
  const pi = load(`{"mode":"low"}`);
  const rows = ["a", "b", "c"].map((id) => pi.row(id, ok));
  pi.start(closedRun());
  const [leader, b, c] = rows.map((r) => r.render(WIDTH));
  assert.deepEqual(plain(leader), ["", "Ran 3 tools"]);
  assert.ok(leader[1].includes(theme!.fg("thinkingText", "Ran 3 tools")), "the hidden-thinking colour (italic is not testable: chalk emits no codes without a TTY)");
  assert.deepEqual(b, []);
  assert.deepEqual(c, []);
});

test("low: an open run says Running", () => {
  const pi = load(`{"mode":"low"}`);
  pi.start([]);
  const message = assistant(call("a"), call("b"));
  pi.emit("message_start", { message });
  pi.emit("message_update", { message });
  // pi builds a call's row after extensions saw the event.
  const rows = ["a", "b"].map((id) => pi.row(id));
  const [leader, b] = rows.map((r) => r.render(WIDTH));
  assert.deepEqual(plain(leader), ["", "Running 2 tools..."]);
  assert.ok(leader[1].includes(theme!.fg("thinkingText", "Running 2 tools...")), "the hidden-thinking colour (italic is not testable: chalk emits no codes without a TTY)");
  assert.deepEqual(b, []);

  pi.emit("agent_end");
  assert.deepEqual(plain(rows[0].render(WIDTH)), ["", "Ran 2 tools"]);
});

test("low: a one-call run is grouped", () => {
  const pi = load(`{"mode":"low"}`);
  const a = pi.row("a", ok);
  pi.start([entry(assistant(call("a"))), entry(toolResult("a"))]);
  assert.deepEqual(plain(a.render(WIDTH)), ["", "Ran 1 tool"]);
});

test("low: clicking the header opens the run into normal rows without expanding the leader's own row", () => {
  const pi = load(`{"mode":"low"}`);
  const rows = ["a", "b", "c"].map((id) => pi.row(id, ok));
  pi.start(closedRun());
  const leader = rows[0];

  // Line 0 is pi's spacer; line 1 is the header.
  assert.ok(click(leader, 1)?.handled, "click on the header");

  // The header, a blank line, then the leader's own row exactly as normal draws it (minus pi's spacer).
  assert.deepEqual(leader.render(WIDTH).slice(2), ["", ...normalRow("a", { result: ok }).slice(1)]);
  assert.deepEqual(plain(leader.render(WIDTH)), ["", "Ran 3 tools", "", "", "▸ read src/a.ts  ✓ 1.2s", ""]);
  assert.deepEqual(rows[1].render(WIDTH), normalRow("b", { result: ok }));
  assert.deepEqual(rows[2].render(WIDTH), normalRow("c", { result: ok }));

  // A click on the leader's own row expands that call, as pi does for any row.
  click(leader, 4);
  assert.deepEqual(leader.render(WIDTH).slice(3), normalRow("a", { result: ok, expanded: true }).slice(1));

  // Clicking the header again collapses the run.
  click(leader, 1);
  assert.deepEqual(plain(leader.render(WIDTH)), ["", "Ran 3 tools"]);
  assert.deepEqual(rows[1].render(WIDTH), []);
});

test("low: a failed call renders as normal and splits the run", () => {
  const pi = load(`{"mode":"low"}`);
  const failure = { isError: true, text: "boom" };
  const rows = [pi.row("a", ok), pi.row("b", failure), pi.row("c", ok)];
  pi.start(closedRun("b"));
  assert.deepEqual(plain(rows[0].render(WIDTH)), ["", "Ran 1 tool"]);
  assert.deepEqual(rows[1].render(WIDTH), normalRow("b", { result: failure }));
  assert.deepEqual(plain(rows[2].render(WIDTH)), ["", "Ran 1 tool"]);
});

test("low: calls of an aborted response render exactly as normal", () => {
  const pi = load(`{"mode":"low"}`);
  const rows = ["a", "b"].map((id) => pi.row(id));
  pi.start([]);
  const message = { ...assistant(call("a"), call("b")), stopReason: "aborted" };
  pi.emit("message_start", { message });
  pi.emit("message_end", { message });
  // pi then marks each pending row as failed; no tool results exist.
  const aborted = { isError: true, text: "Operation aborted" };
  for (const row of rows) row.updateResult({ content: [{ type: "text", text: aborted.text }], isError: true, durationMs: 1200 });
  pi.emit("agent_end");
  assert.deepEqual(rows[0].render(WIDTH), normalRow("a", { result: aborted }));
  assert.deepEqual(rows[1].render(WIDTH), normalRow("b", { result: aborted }));
});

test("low: after a compaction that cuts mid-run, the first kept call shows the header", () => {
  const pi = load(`{"mode":"low"}`);
  const rows = ["k1", "k2"].map((id) => pi.row(id, ok));
  pi.start([
    entry({ role: "user", content: "go", timestamp: 0 }),
    entry(assistant(call("c1"))),
    entry(toolResult("c1")),
    { id: "kept", ...entry(assistant(call("k1"), call("k2"))) },
    entry(toolResult("k1")),
    entry(toolResult("k2")),
    { type: "compaction", summary: "s", firstKeptEntryId: "kept", tokensBefore: 1, timestamp: "" },
  ]);
  assert.deepEqual(plain(rows[0].render(WIDTH)), ["", "Ran 2 tools"]);
  assert.deepEqual(rows[1].render(WIDTH), []);
});

test("low: a displayed custom message appended at turn_end closes the run, as on replay", () => {
  const pi = load(`{"mode":"low"}`);
  const rows = ["a", "b"].map((id) => pi.row(id, ok));
  pi.start([]);
  const turn1 = [assistant(call("a")), toolResult("a")];
  const turn2 = [assistant(call("b")), toolResult("b")];
  const send = (message: unknown) => {
    pi.emit("message_start", { message });
    pi.emit("message_end", { message });
  };
  turn1.forEach(send);
  // pi wrote the custom message to the branch at turn_end; extensions saw no event for it.
  const branch = [...turn1.map(entry), customEntry("nested-agents-md", true)];
  pi.setBranch(branch);
  pi.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 0 });
  turn2.forEach(send);
  pi.emit("agent_end");
  const live = rows.map((r) => plain(r.render(WIDTH)));
  assert.deepEqual(live, [["", "Ran 1 tool"], ["", "Ran 1 tool"]]);

  pi.start([...branch, ...turn2.map(entry)]);
  assert.deepEqual(rows.map((r) => plain(r.render(WIDTH))), live);
});

test("low: turn_start ignores hidden custom messages and displayed ones before the last message", () => {
  const pi = load(`{"mode":"low"}`);
  pi.start([]);
  const rows: ToolExecutionComponent[] = [];
  const send = (id: string) => {
    for (const message of turn(id)) {
      pi.emit("message_start", { message });
      pi.emit("message_end", { message });
    }
    // pi builds a call's row after extensions saw the event.
    rows.push(pi.row(id, ok));
  };
  const turn = (id: string) => [assistant(call(id)), toolResult(id)];
  const turnStart = () => pi.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 0 });

  send("a");
  const branch = [...turn("a").map(entry), customEntry("nested-agents-md", true)];
  pi.setBranch(branch);
  turnStart();
  send("b");
  // The displayed message is now behind turn b's messages, and a hidden one ends the branch.
  pi.setBranch([...branch, ...turn("b").map(entry), customEntry("state", false)]);
  turnStart();
  send("c");
  pi.emit("agent_end");
  assert.deepEqual(rows.map((r) => plain(r.render(WIDTH))), [["", "Ran 1 tool"], ["", "Ran 2 tools"], []]);
});

test("low: a call the tracker does not know renders as normal", () => {
  const pi = load(`{"mode":"low"}`);
  pi.start(closedRun());
  assert.deepEqual(pi.row("x", ok).render(WIDTH), normalRow("x", { result: ok }));
  assert.deepEqual(pi.row("y").render(WIDTH), normalRow("y"));
});

test("low: ctrl+o renders every row as normal", () => {
  const pi = load(`{"mode":"low"}`);
  const rows = ["a", "b", "c"].map((id) => pi.row(id, ok));
  pi.start(closedRun());
  pi.setToolsExpanded(true);
  for (const [i, id] of ["a", "b", "c"].entries()) {
    assert.deepEqual(rows[i].render(WIDTH), normalRow(id, { result: ok, expanded: true }), id);
  }
  pi.setToolsExpanded(false);
  assert.deepEqual(plain(rows[0].render(WIDTH)), ["", "Ran 3 tools"]);
});

test("normal is the default and ignores runs", () => {
  const pi = load();
  const a = pi.row("a", ok);
  pi.start(closedRun());
  assert.deepEqual(a.render(WIDTH), normalRow("a", { result: ok }));
  assert.deepEqual(pi.labels, [undefined], "session_start restores the default thinking label");

  pi.invalidations.clear();
  const message = assistant(call("a"));
  pi.emit("message_start", { message });
  pi.emit("message_end", { message });
  pi.emit("message_end", { message: toolResult("a", true) });
  pi.emit("agent_end");
  assert.deepEqual([...pi.invalidations], [], "no row depends on runs");
});

test("message events build runs and redraw only the leader of each changed run", () => {
  const pi = load(`{"mode":"low"}`);
  for (const id of ["a", "b", "c", "d"]) pi.row(id);
  pi.start([]);
  pi.invalidations.clear();

  const first = assistant(call("a"));
  pi.emit("message_start", { message: first });
  pi.emit("message_update", { message: first });
  assert.deepEqual([...pi.invalidations], [["a", 1]]);

  const all = assistant(call("a"), call("b"), call("c"), call("d"));
  pi.emit("message_update", { message: all });
  pi.emit("message_end", { message: all });
  assert.deepEqual([...pi.invalidations], [["a", 2]], "members of a growing run are not redrawn");

  pi.invalidations.clear();
  pi.emit("message_start", { message: toolResult("b", true) });
  pi.emit("message_end", { message: toolResult("b", true) });
  assert.deepEqual([...pi.invalidations].sort(([a], [b]) => a.localeCompare(b)), [["a", 1], ["b", 1], ["c", 1]], "both leaders and the failed row");

  pi.invalidations.clear();
  pi.emit("agent_end");
  assert.deepEqual([...pi.invalidations], [["c", 1]], "closing redraws the leader");
});

test("session_start replays the branch and redraws every row; session_tree and session_compact forget the old rows", async () => {
  const pi = load(`{"mode":"low"}`);
  const rows = ["a", "b", "x"].map((id) => pi.row(id, ok));
  pi.invalidations.clear();
  pi.start(closedRun());
  assert.deepEqual([...pi.invalidations].sort(([a], [b]) => a.localeCompare(b)), [["a", 1], ["b", 1], ["x", 1]]);
  assert.deepEqual(plain(rows[0].render(WIDTH)), ["", "Ran 3 tools"]);
  assert.deepEqual(pi.labels, [""], "low hides the thinking label");

  for (const event of ["session_tree", "session_compact"]) {
    pi.invalidations.clear();
    pi.emit(event);
    assert.deepEqual([...pi.invalidations], [], `${event}: pi discarded the old rows`);
    // pi then draws the rows anew; here only a.
    const a = pi.row("a", ok);
    assert.deepEqual(plain(a.render(WIDTH)), ["", "Ran 3 tools"], `${event}: replayed`);
    pi.invalidations.clear();
    await pi.run("low");
    assert.deepEqual([...pi.invalidations], [["a", 1]], `${event}: only rows drawn after it are redrawn`);
  }
});

test("/tool-verbose switches the mode, saves it, sets the thinking label and redraws every row", async () => {
  const pi = load();
  const a = pi.row("a", ok);
  pi.row("b", ok);
  pi.start(closedRun());
  pi.invalidations.clear();

  await pi.run("low");
  assert.equal(readFileSync(pi.configFile, "utf8"), `{\n  "mode": "low"\n}\n`);
  assert.deepEqual(pi.labels, [undefined, ""]);
  assert.deepEqual([...pi.invalidations].sort(([a], [b]) => a.localeCompare(b)), [["a", 1], ["b", 1]]);
  assert.deepEqual(plain(a.render(WIDTH)), ["", "Ran 3 tools"]);

  await pi.run(" normal ");
  assert.equal(readFileSync(pi.configFile, "utf8"), `{\n  "mode": "normal"\n}\n`);
  assert.deepEqual(pi.labels, [undefined, "", undefined]);
  assert.deepEqual(a.render(WIDTH), normalRow("a", { result: ok }));

  await pi.run("");
  assert.deepEqual(pi.notes.at(-1), ["Tool rows: normal", "info"]);
  assert.deepEqual(pi.complete("l"), [{ value: "low", label: "low" }]);
  assert.deepEqual(pi.complete("").map((item) => item.value), ["normal", "low"]);
});

test("/tool-verbose with a bad argument changes nothing", async () => {
  const pi = load();
  const a = pi.row("a", ok);
  pi.start(closedRun());
  pi.invalidations.clear();
  await pi.run("quiet");
  assert.deepEqual(pi.notes, [["Usage: /tool-verbose <low|normal>", "error"]]);
  assert.equal(existsSync(pi.configFile), false);
  assert.deepEqual(pi.labels, [undefined]);
  assert.deepEqual([...pi.invalidations], []);
  assert.deepEqual(a.render(WIDTH), normalRow("a", { result: ok }));
});

test("/tool-verbose that cannot save changes nothing", async () => {
  const pi = load();
  mkdirSync(pi.configFile);
  await assert.rejects(pi.run("low"));
  await pi.run("");
  assert.deepEqual(pi.notes, [["Tool rows: normal", "info"]]);
});

test("config: a bad file stops loading with an error naming the file", () => {
  assert.throws(() => load("{mode: low"), (error: Error) => error.message.includes("tools-verbose-low.json: invalid JSON"));
  assert.throws(() => load(`{"mode":"quiet"}`), /tools-verbose-low\.json: "mode" must be one of normal, low\./);
  assert.throws(() => load(`[]`), /tools-verbose-low\.json: "mode" must be/);
});
