import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { type DialogUi, DialogForwarder } from "./dialogs.ts";
import type { UiRequest } from "./rpc.ts";

const live = new AbortController().signal;

/** A UI whose confirm dialogs stay open until the test answers them or, like pi, their signal aborts. */
function fakeUi() {
  const shown: Array<{ title: string; timeout?: number; answer(value: boolean): void }> = [];
  const notified: string[] = [];
  const ui = {
    confirm: (title: string, _message: string, options?: { timeout?: number; signal?: AbortSignal }) =>
      new Promise<boolean>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(false), { once: true });
        shown.push({ title, timeout: options?.timeout, answer: resolve });
      }),
    notify: (message: string) => notified.push(message),
  } as unknown as DialogUi;
  return { ui, shown, notified };
}

const confirm = (id: string, timeout?: number): UiRequest => ({ id, method: "confirm", title: "Allow git push?", message: "", timeout });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("dialogs from several children are shown one at a time, labelled with the child", async () => {
  const { ui, shown } = fakeUi();
  const dialogs = new DialogForwarder(ui, true);
  const first = dialogs.forward("find bug", confirm("1"), live);
  const second = dialogs.forward("find bug", confirm("2"), live);
  await flush();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, "[subagent \"find bug\"] Allow git push?");

  shown[0].answer(true);
  assert.deepEqual(await first, { confirmed: true });
  await flush();
  assert.equal(shown.length, 2);
  shown[1].answer(false);
  assert.deepEqual(await second, { confirmed: false });
});

test("a queued dialog whose asking process stopped meanwhile is not shown", async () => {
  const { ui, shown } = fakeUi();
  const dialogs = new DialogForwarder(ui, true);
  const asking = new AbortController();
  void dialogs.forward("find bug", confirm("1"), live);
  const queued = dialogs.forward("find bug", confirm("2"), asking.signal);
  await flush();
  asking.abort();
  shown[0].answer(true);

  assert.deepEqual(await queued, { cancelled: true });
  assert.equal(shown.length, 1);
});

test("an open dialog closes when its asking process stops, and the next one is shown", async () => {
  const { ui, shown } = fakeUi();
  const dialogs = new DialogForwarder(ui, true);
  const asking = new AbortController();
  void dialogs.forward("child A", confirm("1"), asking.signal);
  void dialogs.forward("child B", confirm("2"), live);
  await flush();
  asking.abort();
  await flush();

  assert.equal(shown.length, 2);
  assert.equal(shown[1].title, "[subagent \"child B\"] Allow git push?");
});

test("a queued dialog gets only the time its child has left, and is dropped once that is gone", async () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  const { ui, shown } = fakeUi();
  const dialogs = new DialogForwarder(ui, true);
  void dialogs.forward("find bug", confirm("1"), live);
  const partly = dialogs.forward("find bug", confirm("2", 30_000), live);
  const expired = dialogs.forward("find bug", confirm("3", 5_000), live);
  await flush();

  mock.timers.tick(10_000);
  shown[0].answer(true);
  await flush();
  assert.equal(shown[1].timeout, 20_000);
  shown[1].answer(true);
  await partly;

  assert.deepEqual(await expired, { cancelled: true });
  assert.equal(shown.length, 2);
  mock.timers.reset();
});

test("without a UI, dialogs are cancelled and notifications still pass through", async () => {
  const { ui, shown, notified } = fakeUi();
  const dialogs = new DialogForwarder(ui, false);

  assert.deepEqual(await dialogs.forward("find bug", confirm("1"), live), { cancelled: true });
  await dialogs.forward("find bug", { id: "2", method: "notify", message: "done" }, live);
  assert.equal(shown.length, 0);
  assert.deepEqual(notified, ["[subagent \"find bug\"] done"]);
});
