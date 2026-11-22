import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { createEventBus, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { type RunningItem, RunningList } from "./running-list.ts";
import { STATUS_LINE_CLICK } from "./status.ts";

afterEach(() => mock.timers.reset());

function setup(items: RunningItem[]) {
  const statuses = new Map<string, string | undefined>();
  const ui = {
    setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
    theme: { bold: (text: string) => `*${text}*`, fg: (_color: string, text: string) => text },
  } as unknown as ExtensionUIContext;
  return { statuses, list: new RunningList(ui, "jobs", () => items) };
}

test("running items show as a tree under a lines: status: name, elapsed time, then label", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 100_000 });
  const { statuses, list } = setup([
    { id: "x", name: "bash", label: "make build", startedAt: 95_000 },
    { id: "x", name: "general", label: "find bug · Opus 5.5 high", startedAt: 100_000 - 62_000 },
  ]);
  list.render();
  assert.equal(statuses.get("lines:jobs"), '*├──* bash 5s · make build\n*└──* general 1m 2s · find bug · Opus 5.5 high');
  list.dispose();
});

test("a long label is collapsed to one line and cut with an ellipsis", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 100_000 });
  const { statuses, list } = setup([{ id: "x", name: "bash", label: `cd  /tmp &&\t${"x".repeat(100)}`, startedAt: 95_000 }]);
  list.render();
  // 91 columns after the branch: 80 of command after `bash 23s · `, so 81 after `bash 5s · `.
  assert.equal(statuses.get("lines:jobs"), `*└──* bash 5s · cd /tmp && ${"x".repeat(69)}…`);
  list.dispose();
});

test("cut lines end in the same column whatever the width of their name and time", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 100_000 });
  const { statuses, list } = setup([
    { id: "x", name: "bash", label: "a ".repeat(60), startedAt: 95_000 },
    { id: "x", name: "general", label: "b".repeat(120), startedAt: 100_000 - 62_000 },
  ]);
  list.render();
  const [first, second] = statuses.get("lines:jobs")!.split("\n");
  assert.ok(first.endsWith("…") && second.endsWith("…"));
  assert.equal(first.length, second.length);
  list.dispose();
});

test("the list redraws every second while items run, and clears when none do", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  const items = [{ id: "x", name: "bash", label: "build", startedAt: 0 }];
  const { statuses, list } = setup(items);
  list.render();
  mock.timers.tick(3_000);
  assert.equal(statuses.get("lines:jobs"), "*└──* bash 3s · build");

  items.pop();
  mock.timers.tick(1_000);
  assert.equal(statuses.get("lines:jobs"), undefined);
  statuses.clear();
  mock.timers.tick(5_000);
  assert.equal(statuses.size, 0, "the timer stopped");
});

test("after dispose, render does nothing", () => {
  const { statuses, list } = setup([{ id: "x", name: "bash", label: "build", startedAt: Date.now() }]);
  list.dispose();
  list.render();
  assert.equal(statuses.size, 0);
});

test("a click on a line calls onClick with the id of the item drawn there, and only for this list's lines", (t) => {
  mock.timers.enable({ apis: ["setInterval"] });
  const events = createEventBus();
  const click = (key: string, line: number) => events.emit(STATUS_LINE_CLICK, { key, line });
  const items = [
    { id: "a", name: "bash", label: "one", startedAt: Date.now() },
    { id: "b", name: "bash", label: "two", startedAt: Date.now() },
  ];
  const clicked: string[] = [];
  const ui = { setStatus: () => {}, theme: { bold: (text: string) => text, fg: (_color: string, text: string) => text } } as unknown as ExtensionUIContext;
  // A new array per call, as an extension's items() builds one.
  const list = new RunningList(ui, "jobs", () => [...items], { events, onClick: (id) => clicked.push(id) });
  t.after(() => list.dispose());
  list.render();

  items.shift();
  click("lines:jobs", 1);
  click("lines:other", 0);
  click("lines:jobs", 5);
  assert.deepEqual(clicked, ["b"], "the line as drawn, not as the items are now");

  list.dispose();
  click("lines:jobs", 0);
  assert.deepEqual(clicked, ["b"], "dispose unsubscribes");
});
