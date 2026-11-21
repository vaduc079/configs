import assert from "node:assert/strict";
import { setTimeout as tick } from "node:timers/promises";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerInbox } from "./inbox.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Options = { triggerTurn?: boolean; deliverAs?: string };
type State = "idle" | "running" | "aborting" | "busy";

function setup() {
  const handlers = new Map<string, Handler>();
  const sent: [string, Options][] = [];
  let failNext = false;
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    sendMessage: (message: { content: string }, options: Options) => {
      if (failNext) {
        failNext = false;
        throw new Error("disk full");
      }
      sent.push([message.content, options]);
    },
  } as unknown as ExtensionAPI;
  const inbox = registerInbox(pi, "Result");
  let state: State = "idle";
  const notices: string[] = [];
  const ctx = {
    isIdle: () => state === "idle",
    get signal() {
      if (state === "running") return new AbortController().signal;
      if (state === "aborting") return AbortSignal.abort();
      return undefined;
    },
    ui: { notify: (text: string) => notices.push(text) },
  };
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
  const message = (name: string) => ({ customType: "result", display: true, content: name });
  const deliver = (name: string, onPosted?: () => void) => inbox.deliver(message(name), onPosted);
  const reachModel = (name: string) => emit("message_end", { message: { role: "custom", ...message(name) } });
  void emit("session_start");
  return {
    emit,
    sent,
    deliver,
    reachModel,
    notices,
    setState: (value: State) => (state = value),
    failNextSend: () => (failNext = true),
  };
}

test("a post for an idle agent goes out at once and may start a turn", () => {
  const { sent, deliver } = setup();
  let posted = false;
  deliver("a", () => (posted = true));
  assert.deepEqual(sent, [["a", { triggerTurn: true }]]);
  assert.ok(posted);
});

test("a post while the agent runs is steered in at once, and counts as posted once it reaches the model", async () => {
  const { sent, deliver, reachModel, setState } = setup();
  setState("running");
  let posted = false;
  deliver("a", () => (posted = true));
  assert.deepEqual(sent, [["a", { deliverAs: "steer" }]]);
  assert.ok(!posted, "only queued so far");
  await reachModel("a");
  assert.ok(posted);
});

test("a steered post that reached the model is not posted again after an abort", async () => {
  const { emit, sent, deliver, reachModel, setState } = setup();
  setState("running");
  deliver("a");
  await reachModel("a");
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await tick(0);
  assert.deepEqual(sent, [["a", { deliverAs: "steer" }]]);
});

test("after Esc, steered posts that never reached the model are posted again without starting a turn", async () => {
  const { emit, sent, deliver, reachModel, setState } = setup();
  setState("running");
  let posted = false;
  deliver("a");
  deliver("b", () => (posted = true));
  await reachModel("a");
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await tick(0);
  assert.deepEqual(sent.slice(2), [["b", { triggerTurn: false }]]);
  assert.ok(posted);
});

test("two steered posts with the same text are tracked separately", async () => {
  const { emit, sent, deliver, reachModel, setState } = setup();
  setState("running");
  deliver("same");
  deliver("same");
  await reachModel("same");
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await tick(0);
  assert.deepEqual(sent.slice(2), [["same", { triggerTurn: false }]]);
});

test("a /compact that aborts the run keeps pi's queue, so steered posts are not posted again", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("running");
  deliver("a");
  await emit("agent_settled", { aborted: true });
  setState("busy");
  await tick(0);
  setState("idle");
  await emit("session_compact");
  await tick(0);
  assert.deepEqual(sent, [["a", { deliverAs: "steer" }]]);
});

test("a /compact that fails at once still keeps pi's queue, so steered posts are not posted again", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("running");
  deliver("a");
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await emit("session_compact_failed");
  await tick(0);
  assert.deepEqual(sent, [["a", { deliverAs: "steer" }]]);
});

test("posts pi kept through a /compact arrive in the next run and are not posted again", async () => {
  const { emit, sent, deliver, reachModel, setState } = setup();
  setState("running");
  let posted = 0;
  deliver("a", () => posted++);
  deliver("b", () => posted++);
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await emit("session_compact_failed");
  await tick(0);

  await reachModel("a");
  await reachModel("b");
  await emit("agent_settled", { aborted: false });
  assert.equal(sent.length, 2);
  assert.equal(posted, 2);
});

test("a post lost to Esc and then /compact is posted once the next run ends", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("running");
  let posted = false;
  deliver("a", () => (posted = true));
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await emit("session_compact_failed");
  await tick(0);
  assert.equal(sent.length, 1, "not posted again while it may still be queued");

  await emit("agent_settled", { aborted: false });
  assert.deepEqual(sent.slice(1), [["a", { triggerTurn: true }]]);
  assert.ok(posted);
});

test("a steered post the user dequeued is posted once the run ends", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("running");
  let posted = false;
  deliver("a", () => (posted = true));
  setState("idle");
  await emit("agent_settled", { aborted: false });
  assert.deepEqual(sent, [
    ["a", { deliverAs: "steer" }],
    ["a", { triggerTurn: true }],
  ]);
  assert.ok(posted);
});

test("a post while an aborted run unwinds is held, not steered into the queue Esc emptied", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("aborting");
  deliver("a");
  assert.deepEqual(sent, []);
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await tick(0);
  assert.deepEqual(sent, [["a", { triggerTurn: false }]]);
});

test("posts held while a run is starting are steered in when it starts", async () => {
  const { emit, sent, deliver, reachModel, setState } = setup();
  setState("busy");
  let posted = false;
  deliver("a", () => (posted = true));
  deliver("b");
  assert.deepEqual(sent, []);

  await emit("agent_start");
  assert.deepEqual(sent, [
    ["a", { deliverAs: "steer" }],
    ["b", { deliverAs: "steer" }],
  ]);
  await reachModel("a");
  assert.ok(posted);
});

test("posts while the agent is busy outside a run wait for it to settle, then the last one starts one turn", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("busy");
  let posted = false;
  deliver("a", () => (posted = true));
  deliver("b");
  assert.deepEqual(sent, []);
  assert.ok(!posted, "not posted while held");

  setState("idle");
  await emit("agent_settled", { aborted: false });
  await emit("agent_settled", { aborted: false });
  assert.deepEqual(sent, [
    ["a", { triggerTurn: false }],
    ["b", { triggerTurn: true }],
  ]);
  assert.ok(posted);
});

test("after the user aborts, held posts go out without starting a turn", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("busy");
  deliver("a");
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await tick(0);
  assert.deepEqual(sent, [["a", { triggerTurn: false }]]);
});

test("after a compaction or /tree, held posts go out on the next tick once the agent is idle", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("busy");
  deliver("a");
  await emit("session_compact");
  await tick(0);
  assert.deepEqual(sent, []);

  setState("idle");
  await emit("session_tree");
  assert.deepEqual(sent, [], "not before the next tick");
  await tick(0);
  assert.deepEqual(sent, [["a", { triggerTurn: true }]]);
});

test("if one held post fails, the rest stay held for the next flush", async () => {
  const { emit, sent, deliver, setState, failNextSend } = setup();
  setState("busy");
  deliver("a");
  deliver("b");
  setState("idle");

  failNextSend();
  await assert.rejects(async () => emit("agent_settled", { aborted: false }), /disk full/);
  assert.deepEqual(sent, []);
  await emit("agent_settled", { aborted: false });
  assert.deepEqual(sent, [["b", { triggerTurn: true }]]);
});

test("a failed post on a later tick is shown to the user, not thrown", async () => {
  const { emit, notices, deliver, setState, failNextSend } = setup();
  setState("busy");
  deliver("a");
  setState("idle");
  failNextSend();
  await emit("session_compact");
  await tick(0);
  assert.deepEqual(notices, ["Result not posted: disk full"]);
});

test("held and steered posts are dropped when the session ends", async () => {
  const { emit, sent, deliver, setState } = setup();
  setState("running");
  deliver("a");
  setState("busy");
  deliver("b");
  await emit("session_shutdown");
  await emit("session_start");
  setState("idle");
  await emit("agent_settled", { aborted: true });
  await tick(0);
  assert.deepEqual(sent, [["a", { deliverAs: "steer" }]]);
});
