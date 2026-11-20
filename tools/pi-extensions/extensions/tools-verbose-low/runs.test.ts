import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { createRunTracker, type RunTracker } from "./runs.ts";

type Block = { type: "text"; text: string } | { type: "thinking"; thinking: string } | { type: "toolCall"; id: string };

const call = (id: string): Block => ({ type: "toolCall", id });
const text = (t: string): Block => ({ type: "text", text: t });
const thinking: Block = { type: "thinking", thinking: "hmm" };

const assistant = (...content: Block[]) => ({ role: "assistant", content }) as unknown as AgentMessage;
const result = (id: string, isError = false) =>
  ({ role: "toolResult", toolCallId: id, toolName: "bash", content: [], isError }) as unknown as AgentMessage;
const user = { role: "user", content: "hi" } as unknown as AgentMessage;
const bash = { role: "bashExecution", command: "ls" } as unknown as AgentMessage;
const custom = (display: boolean) => ({ role: "custom", customType: "x", content: "c", display }) as unknown as AgentMessage;
const compaction = { role: "compactionSummary", summary: "s" } as unknown as AgentMessage;
const branchSummary = { role: "branchSummary", summary: "s" } as unknown as AgentMessage;
const system = { role: "system", content: "" } as unknown as AgentMessage;

function live(tracker: RunTracker, message: AgentMessage) {
  tracker.messageStart(message);
  return tracker.messageEnd(message);
}

/** Runs holding `ids`, in order, as "a,b" with " !1" for one failed call and a trailing "*" while open. */
function shape(tracker: RunTracker, ids: string[]) {
  const runs = [...new Set(ids.map((id) => tracker.runOf(id)).filter((r) => r !== undefined))];
  return runs.map((r) => r.ids.join(",") + (r.failed ? ` !${r.failed}` : "") + (r.closed ? "" : "*"));
}

function entries(messages: AgentMessage[]): SessionEntry[] {
  return messages.map((message, i) => ({ type: "message", id: `e${i}`, parentId: null, timestamp: "", message }) as unknown as SessionEntry);
}

test("consecutive calls across messages form one open run", () => {
  const t = createRunTracker();
  live(t, assistant(call("a")));
  live(t, result("a"));
  live(t, assistant(call("b")));
  assert.deepEqual(shape(t, ["a", "b"]), ["a,b*"]);
  assert.equal(t.runOf("a"), t.runOf("b"));
});

test("parallel calls in one message join one run", () => {
  const t = createRunTracker();
  live(t, assistant(call("a"), call("b"), call("c")));
  assert.deepEqual(shape(t, ["a", "b", "c"]), ["a,b,c*"]);
});

test("visible text closes the run and the next call opens a new one", () => {
  const t = createRunTracker();
  live(t, assistant(call("a"), text("done"), call("b")));
  assert.deepEqual(shape(t, ["a", "b"]), ["a", "b*"]);
});

test("text in a later message closes the run", () => {
  const t = createRunTracker();
  live(t, assistant(call("a")));
  live(t, result("a"));
  live(t, assistant(text("done")));
  live(t, assistant(call("b")));
  assert.deepEqual(shape(t, ["a", "b"]), ["a", "b*"]);
});

test("empty and whitespace text does not close the run", () => {
  const t = createRunTracker();
  live(t, assistant(call("a"), text(""), text("  \n"), call("b")));
  assert.deepEqual(shape(t, ["a", "b"]), ["a,b*"]);
});

test("thinking does not close the run", () => {
  const t = createRunTracker();
  live(t, assistant(call("a"), thinking, call("b")));
  live(t, assistant(thinking, call("c")));
  assert.deepEqual(shape(t, ["a", "b", "c"]), ["a,b,c*"]);
});

for (const [name, message] of [
  ["user message", user],
  ["displayed custom message", custom(true)],
  ["bash execution", bash],
  ["compaction summary", compaction],
  ["branch summary", branchSummary],
] as const) {
  test(`${name} closes the run`, () => {
    const t = createRunTracker();
    live(t, assistant(call("a")));
    live(t, message);
    live(t, assistant(call("b")));
    assert.deepEqual(shape(t, ["a", "b"]), ["a", "b*"]);
  });
}

for (const [name, message] of [
  ["non-displayed custom message", custom(false)],
  ["system message", system],
  ["successful tool result", result("a")],
] as const) {
  test(`${name} does not close the run`, () => {
    const t = createRunTracker();
    live(t, assistant(call("a")));
    live(t, message);
    live(t, assistant(call("b")));
    assert.deepEqual(shape(t, ["a", "b"]), ["a,b*"]);
  });
}

test("closeOpen closes the open run and reports it", () => {
  const t = createRunTracker();
  live(t, assistant(call("a"), call("b")));
  const changed = t.closeOpen();
  assert.deepEqual(changed.map((r) => r.ids), [["a", "b"]]);
  assert.deepEqual(shape(t, ["a"]), ["a,b"]);
  assert.deepEqual(t.closeOpen(), []);
});

test("streaming: a call after a growing text block goes to a new run", () => {
  const t = createRunTracker();
  const stream = assistant(call("a"), text(""));
  t.messageStart(stream);
  t.messageUpdate(stream);
  assert.deepEqual(shape(t, ["a"]), ["a*"], "empty last text block is not final");

  const typing = assistant(call("a"), text("Now"));
  t.messageUpdate(typing);
  assert.deepEqual(shape(t, ["a"]), ["a"], "first visible text closes the run");

  t.messageUpdate(assistant(call("a"), text("Now I will"), call("b")));
  t.messageEnd(assistant(call("a"), text("Now I will"), call("b")));
  assert.deepEqual(shape(t, ["a", "b"]), ["a", "b*"]);
});

test("streaming: repeated updates do not duplicate ids", () => {
  const t = createRunTracker();
  const first = assistant(call("a"));
  t.messageStart(first);
  t.messageUpdate(first);
  t.messageUpdate(first);
  t.messageUpdate(assistant(call("a"), call("b")));
  t.messageUpdate(assistant(call("a"), call("b")));
  t.messageEnd(assistant(call("a"), call("b")));
  assert.deepEqual(shape(t, ["a", "b"]), ["a,b*"]);
});

test("streaming: an empty trailing text block is skipped on message end", () => {
  const t = createRunTracker();
  const msg = assistant(call("a"), text(""));
  t.messageStart(msg);
  t.messageUpdate(msg);
  t.messageEnd(msg);
  live(t, assistant(call("b")));
  assert.deepEqual(shape(t, ["a", "b"]), ["a,b*"]);
});

test("a failed call stays in its run, which counts it and stays open", () => {
  const t = createRunTracker();
  live(t, assistant(call("a"), call("b"), call("c")));
  live(t, result("a"));
  live(t, result("b", true));
  live(t, result("c", true));
  live(t, assistant(call("d")));
  assert.deepEqual(shape(t, ["a", "b", "c", "d"]), ["a,b,c,d !2*"]);
});

test("a failure in a closed run is counted and keeps it closed", () => {
  const t = createRunTracker();
  live(t, assistant(call("a"), call("b"), text("done")));
  live(t, result("b", true));
  assert.deepEqual(shape(t, ["a", "b"]), ["a,b !1"]);
});

test("changed runs: calls, failure, and close", () => {
  const t = createRunTracker();
  const [first] = live(t, assistant(call("a"), call("b")));
  assert.deepEqual(first.ids, ["a", "b"]);

  const added = live(t, assistant(call("c")));
  assert.deepEqual(added.map((r) => r.ids), [["a", "b", "c"]]);
  assert.equal(added[0], first);

  assert.deepEqual(live(t, result("b", true)), [first]);

  assert.deepEqual(live(t, user), [first]);

  assert.deepEqual(live(t, user), []);
  assert.deepEqual(live(t, result("zzz")), []);
});

for (const stopReason of ["aborted", "error"]) {
  test(`a response stopped with ${stopReason} fails its calls and ends the run, live and on replay`, () => {
    const stopped = { ...assistant(call("b"), call("c")), stopReason } as AgentMessage;
    const messages = [assistant(call("a")), result("a"), stopped, assistant(call("d"))];
    const t = createRunTracker();
    for (const message of messages) live(t, message);
    assert.deepEqual(shape(t, ["a", "b", "c", "d"]), ["a,b,c !2", "d*"]);

    const replayed = createRunTracker();
    replayed.replay(entries(messages));
    assert.deepEqual(shape(replayed, ["a", "b", "c", "d"]), ["a,b,c !2", "d"]);
  });
}

test("a response that failed with no content ends the run, so a retry starts a new one, live and on replay", () => {
  // pi draws an error line for it; after an auto-retry the next calls come below that line.
  const failed = { ...assistant(), stopReason: "error" } as AgentMessage;
  const messages = [assistant(call("a")), result("a"), failed, assistant(call("b"))];
  const t = createRunTracker();
  for (const message of messages) live(t, message);
  assert.deepEqual(shape(t, ["a", "b"]), ["a", "b*"]);

  const replayed = createRunTracker();
  replayed.replay(entries(messages));
  assert.deepEqual(shape(replayed, ["a", "b"]), ["a", "b"]);
});

const sequence: AgentMessage[] = [
  user,
  assistant(thinking, call("a"), call("b"), call("c")),
  result("a"),
  result("b", true),
  result("c"),
  assistant(call("d"), text("")),
  result("d"),
  assistant(text("Found it."), call("e")),
  result("e"),
  custom(false),
  assistant(call("f")),
  result("f"),
  bash,
  assistant(call("g")),
  result("g", true),
  assistant(call("h")),
  compaction,
  assistant(call("i")),
  branchSummary,
  assistant(call("j")),
  custom(true),
  assistant(call("k")),
  result("k"),
];
const ids = "abcdefghijk".split("");

test("replay of entries equals the live result", () => {
  const liveTracker = createRunTracker();
  for (const message of sequence) live(liveTracker, message);
  liveTracker.closeOpen();

  const replayed = createRunTracker();
  replayed.replay(entries(sequence));

  assert.deepEqual(shape(replayed, ids), shape(liveTracker, ids));
  // Spelled out so the shared result is not only compared with itself.
  assert.deepEqual(shape(replayed, ids), ["a,b,c,d !1", "e,f", "g,h !1", "i", "j", "k"]);
});

test("replay maps non-message entries like their live messages", () => {
  const base = { id: "x", parentId: null, timestamp: "2026-01-01T00:00:00.000Z" };
  const nothing = [
    { type: "model_change", provider: "p", modelId: "m" },
    { type: "thinking_level_change", thinkingLevel: "high" },
    { type: "label", targetId: "x", label: "l" },
    { type: "session_info", name: "n" },
    { type: "custom", customType: "ext", data: {} },
    { type: "custom_message", customType: "ext", content: "c", display: false },
  ];
  const closes = [
    { type: "compaction", summary: "s", firstKeptEntryId: "x", tokensBefore: 1 },
    { type: "branch_summary", fromId: "x", summary: "s" },
    { type: "custom_message", customType: "ext", content: "c", display: true },
  ];
  const [a, b] = entries([assistant(call("a")), assistant(call("b"))]);

  for (const entry of nothing) {
    const t = createRunTracker();
    t.replay([a, { ...base, ...entry } as unknown as SessionEntry, b]);
    assert.deepEqual(shape(t, ["a", "b"]), ["a,b"], entry.type);
  }
  for (const entry of closes) {
    const t = createRunTracker();
    t.replay([a, { ...base, ...entry } as unknown as SessionEntry, b]);
    assert.deepEqual(shape(t, ["a", "b"]), ["a", "b"], entry.type);
  }
});

test("replay resets previous state and closes the open run", () => {
  const t = createRunTracker();
  live(t, assistant(call("old")));
  t.replay(entries([assistant(call("a"), call("b"))]));
  assert.equal(t.runOf("old"), undefined);
  assert.deepEqual(shape(t, ["a", "b"]), ["a,b"]);
});
