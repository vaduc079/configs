import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { type RunningItem, RunningList } from "./running-list.ts";

afterEach(() => mock.timers.reset());

function setup(items: RunningItem[]) {
  const statuses = new Map<string, string | undefined>();
  const ui = {
    setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
    theme: { bold: (text: string) => `*${text}*`, fg: (_color: string, text: string) => text },
  } as unknown as ExtensionUIContext;
  return { statuses, list: new RunningList(ui, "jobs", () => items) };
}

test("running items show as a tree under a lines: status, with elapsed time", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 100_000 });
  const { statuses, list } = setup([
    { label: "build", startedAt: 95_000 },
    { label: "tests", startedAt: 100_000 - 62_000 },
  ]);
  list.render();
  assert.equal(statuses.get("lines:jobs"), "*├──* build · 5s\n*└──* tests · 1m2s");
  list.dispose();
});

test("the list redraws every second while items run, and clears when none do", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  const items = [{ label: "build", startedAt: 0 }];
  const { statuses, list } = setup(items);
  list.render();
  mock.timers.tick(3_000);
  assert.equal(statuses.get("lines:jobs"), "*└──* build · 3s");

  items.pop();
  mock.timers.tick(1_000);
  assert.equal(statuses.get("lines:jobs"), undefined);
  statuses.clear();
  mock.timers.tick(5_000);
  assert.equal(statuses.size, 0, "the timer stopped");
});

test("after dispose, render does nothing", () => {
  const { statuses, list } = setup([{ label: "build", startedAt: Date.now() }]);
  list.dispose();
  list.render();
  assert.equal(statuses.size, 0);
});
