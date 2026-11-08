import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ResultDelivery } from "../result.ts";
import type { RunResult, Subagent } from "../subagent.ts";

const child = (description: string) => ({ id: description, agent: { name: "general" }, description }) as Subagent;
const done = (text: string): RunResult => ({ state: "completed", text, usage: { turns: 1, input: 1, output: 1, cost: 0 }, durationMs: 1_000 });

type Posted = { description: string; durationMs: number; triggerTurn: boolean | undefined };

function setup() {
  const posted: Posted[] = [];
  const pi = {
    sendMessage: (message: { details: { description: string; durationMs: number } }, options: { triggerTurn?: boolean }) =>
      posted.push({ description: message.details.description, durationMs: message.details.durationMs, triggerTurn: options.triggerTurn }),
  } as unknown as ExtensionAPI;
  let idle = true;
  const delivery = new ResultDelivery(pi, "/tmp/sessions", () => idle);
  const delivered: string[] = [];
  const deliver = (description: string) => delivery.deliver(child(description), done(description), () => delivered.push(description));
  const turns = () => posted.map(({ description, triggerTurn }) => [description, triggerTurn]);
  return { delivery, posted, delivered, deliver, turns, setIdle: (value: boolean) => (idle = value) };
}

test("a result for an idle parent is posted at once, with its duration, and starts a turn", () => {
  const { posted, delivered, deliver } = setup();
  deliver("a");
  assert.deepEqual(posted, [{ description: "a", durationMs: 1_000, triggerTurn: true }]);
  assert.deepEqual(delivered, ["a"]);
});

test("results for a busy parent wait for it to settle, then the last one starts one turn", () => {
  const { delivery, delivered, deliver, turns, setIdle } = setup();
  setIdle(false);
  deliver("a");
  deliver("b");
  assert.deepEqual(turns(), []);
  assert.deepEqual(delivered, []);

  setIdle(true);
  delivery.flush(true);
  delivery.flush(true);
  assert.deepEqual(turns(), [
    ["a", false],
    ["b", true],
  ]);
  assert.deepEqual(delivered, ["a", "b"]);
});

test("after the user aborts the parent, held results are posted without starting a turn", () => {
  const { delivery, deliver, turns, setIdle } = setup();
  setIdle(false);
  deliver("a");
  setIdle(true);
  delivery.flush(false);
  assert.deepEqual(turns(), [["a", false]]);
});

test("after a compaction, held results are posted only once the parent is idle", () => {
  const { delivery, deliver, turns, setIdle } = setup();
  setIdle(false);
  deliver("a");
  delivery.flushIfIdle();
  assert.deepEqual(turns(), []);

  setIdle(true);
  delivery.flushIfIdle();
  assert.deepEqual(turns(), [["a", true]]);
});

test("if posting one held result fails, the rest stay held for the next flush", () => {
  const { delivery, delivered, setIdle } = setup();
  setIdle(false);
  delivery.deliver(child("a"), done("a"), () => {
    throw new Error("disk full");
  });
  delivery.deliver(child("b"), done("b"), () => delivered.push("b"));
  setIdle(true);

  assert.throws(() => delivery.flush(true), /disk full/);
  assert.deepEqual(delivered, []);
  delivery.flush(true);
  assert.deepEqual(delivered, ["b"]);
});
