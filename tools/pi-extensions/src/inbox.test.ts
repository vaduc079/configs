import assert from "node:assert/strict";
import { setTimeout as tick } from "node:timers/promises";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerInbox } from "./inbox.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

function setup() {
  const handlers = new Map<string, Handler>();
  const pi = { on: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as ExtensionAPI;
  const inbox = registerInbox(pi, "Result");
  let idle = true;
  const notices: string[] = [];
  const ctx = { isIdle: () => idle, ui: { notify: (text: string) => notices.push(text) } };
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
  const turns: [string, boolean][] = [];
  const deliver = (name: string) => inbox.deliver((triggerTurn) => turns.push([name, triggerTurn]));
  void emit("session_start");
  return { inbox, emit, turns, deliver, notices, setIdle: (value: boolean) => (idle = value) };
}

test("a post for an idle agent goes out at once and may start a turn", () => {
  const { turns, deliver } = setup();
  deliver("a");
  assert.deepEqual(turns, [["a", true]]);
});

test("posts for a busy agent wait for it to settle, then the last one starts one turn", async () => {
  const { emit, turns, deliver, setIdle } = setup();
  setIdle(false);
  deliver("a");
  deliver("b");
  assert.deepEqual(turns, []);

  setIdle(true);
  await emit("agent_settled", { aborted: false });
  await emit("agent_settled", { aborted: false });
  assert.deepEqual(turns, [
    ["a", false],
    ["b", true],
  ]);
});

test("after the user aborts, held posts go out without starting a turn", async () => {
  const { emit, turns, deliver, setIdle } = setup();
  setIdle(false);
  deliver("a");
  setIdle(true);
  await emit("agent_settled", { aborted: true });
  assert.deepEqual(turns, [["a", false]]);
});

test("after a compaction or /tree, held posts go out on the next tick once the agent is idle", async () => {
  const { emit, turns, deliver, setIdle } = setup();
  setIdle(false);
  deliver("a");
  await emit("session_compact");
  await tick(0);
  assert.deepEqual(turns, []);

  setIdle(true);
  await emit("session_tree");
  assert.deepEqual(turns, [], "not before the next tick");
  await tick(0);
  assert.deepEqual(turns, [["a", true]]);
});

test("if one held post fails, the rest stay held for the next flush", async () => {
  const { inbox, emit, turns, deliver, setIdle } = setup();
  setIdle(false);
  inbox.deliver(() => {
    throw new Error("disk full");
  });
  deliver("b");
  setIdle(true);

  await assert.rejects(async () => emit("agent_settled", { aborted: false }), /disk full/);
  assert.deepEqual(turns, []);
  await emit("agent_settled", { aborted: false });
  assert.deepEqual(turns, [["b", true]]);
});

test("a failed post after a compaction is shown to the user, not thrown", async () => {
  const { inbox, emit, notices, setIdle } = setup();
  setIdle(false);
  inbox.deliver(() => {
    throw new Error("disk full");
  });
  setIdle(true);
  await emit("session_compact");
  await tick(0);
  assert.deepEqual(notices, ["Result not posted: disk full"]);
});

test("held posts are dropped when the session ends", async () => {
  const { emit, turns, deliver, setIdle } = setup();
  setIdle(false);
  deliver("a");
  await emit("session_shutdown");
  await emit("session_start");
  await emit("agent_settled", { aborted: false });
  assert.deepEqual(turns, []);
});
