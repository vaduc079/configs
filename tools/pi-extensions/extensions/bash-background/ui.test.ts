// Needs pi's packages at runtime: run `npm run link-pi` once (links pi's node_modules here).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, mock, test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type BackgroundJob, BackgroundList, readTail } from "./ui.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bash-background-ui-test-"));
after(() => fs.rmSync(tmp, { recursive: true }));
afterEach(() => mock.timers.reset());

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const keys: Record<string, string> = { "tui.select.cancel": "esc", "tui.select.up": "up", "tui.select.down": "down", "tui.select.confirm": "enter" };

function job(id: string, command: string, startedAt: number, log = ""): BackgroundJob {
  const logPath = path.join(tmp, `${id}.log`);
  fs.writeFileSync(logPath, log);
  return { id, command, cwd: "/work", logPath, startedAt };
}

function setup(running: BackgroundJob[], copyError?: Error, maxHeight = 100) {
  const stopped: string[] = [];
  const copied: string[] = [];
  let closed = false;
  const list = new BackgroundList({
    running: () => running,
    stop: (id) => stopped.push(id),
    maxHeight: () => maxHeight,
    copy: async (text) => {
      if (copyError) throw copyError;
      copied.push(text);
    },
    theme: theme as unknown as Theme,
    keybindings: { matches: (data, binding) => keys[binding] === data },
    requestRender: () => {},
    done: () => (closed = true),
  });
  const lines = (width = 200) => list.render(width).map((line) => line.trimEnd()).filter((line) => line.trim() && !line.startsWith("─"));
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { list, lines, stopped, copied, closed: () => closed, settle };
}

test("the list shows running commands newest first: id, running time, then the command cut to one line", (t) => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 200_000 });
  const long = `cd /tmp && ${"x".repeat(100)}`;
  const { list, lines } = setup([job("aaaa1111", long, 200_000 - 134_000), job("bbbb2222", "npm\n  test", 188_000)]);
  t.after(() => list.dispose());
  assert.deepEqual(lines(), [
    " Background commands",
    " → bbbb2222 12s · npm test",
    // 95 columns after the arrow: 80 of command after a 2-character time, so 77 after `2m 14s`.
    `   aaaa1111 2m 14s · cd /tmp && ${"x".repeat(65)}…`,
    " ↑↓ navigate  enter details  x stop  esc close",
  ]);
  mock.timers.tick(1_000);
  assert.ok(lines()[1].startsWith(" → bbbb2222 13s ·"), "the time ticks");
});

test("cut rows end in the same column whatever the width of their time", (t) => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 200_000 });
  const { list } = setup([job("aaaa1111", "a ".repeat(60), 200_000 - 134_000), job("bbbb2222", "b".repeat(120), 200_000 - 9_000)]);
  t.after(() => list.dispose());
  const rows = list.render(200).filter((line) => line.includes("…")).map((line) => line.trimEnd());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, rows[1].length);
});

test("in a narrow terminal the command is cut further, so each row stays one line", (t) => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 200_000 });
  const { list } = setup([job("aaaa1111", "x".repeat(100), 200_000 - 27_000)]);
  t.after(() => list.dispose());
  const row = list.render(80).find((line) => line.includes("aaaa1111"))!;
  assert.equal(row.trimEnd(), ` → aaaa1111 27s · ${"x".repeat(60)}…`, "fills the row, keeping 1 column of padding");
});

test("in a short terminal the details show fewer log lines, so the key hints stay on screen", (t) => {
  const log = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
  const short = setup([job("aaaa1111", "make", 1_000, log)], undefined, 20);
  const tiny = setup([job("bbbb2222", "make", 1_000, log)], undefined, 5);
  t.after(() => [short, tiny].forEach(({ list }) => list.dispose()));
  short.list.handleInput("enter");
  tiny.list.handleInput("enter");
  const screen = short.list.render(100);
  assert.equal(screen.length, 20);
  assert.ok(short.lines().includes("   line 20"));
  assert.ok(!short.lines().includes("   line 14"));
  assert.ok(short.lines().at(-1)!.startsWith(" x stop"));
  assert.equal(tiny.lines().filter((line) => line.startsWith("   line")).length, 3, "at least 3 lines");
});

test("x stops the highlighted command, even if the rows reorder before it is pressed", (t) => {
  const running = [job("aaaa1111", "sleep 1", 1_000)];
  const { list, lines, stopped } = setup(running);
  t.after(() => list.dispose());
  assert.ok(lines()[1].startsWith(" → aaaa1111"));
  running.push(job("bbbb2222", "sleep 2", 2_000));
  list.handleInput("x");
  list.handleInput("down");
  list.handleInput("up");
  list.handleInput("x");
  assert.deepEqual(stopped, ["aaaa1111", "bbbb2222"]);
  assert.ok(lines().includes(" Stopped bbbb2222."));
});

test("enter opens the details: full command, cwd, log path, and the last lines of the log, re-read every second", (t) => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 100_000 });
  const command = `echo one && ${"x".repeat(120)}`;
  const running = [job("aaaa1111", command, 95_000, "line 1\nline 2\n")];
  const { list, lines } = setup(running);
  t.after(() => list.dispose());
  list.handleInput("enter");
  const screen = lines(80);
  assert.equal(screen[0], " Background command aaaa1111 · running 5s");
  const commandLines = screen.slice(screen.findIndex((line) => line.startsWith(" $ ")), screen.findIndex((line) => line.startsWith(" cwd")));
  assert.ok(commandLines.length > 1);
  assert.equal(commandLines.join("").replaceAll(/\s/g, ""), `$echoone&&${"x".repeat(120)}`, "the command wraps, not cut");
  assert.ok(screen.includes(" cwd  /work"));
  assert.ok(lines(200).includes(` log  ${running[0].logPath}`));
  assert.deepEqual(screen.slice(-4), [" Last output", "   line 1", "   line 2", " x stop  c copy log path  esc back"]);

  fs.appendFileSync(running[0].logPath, "line 3\n");
  mock.timers.tick(1_000);
  assert.ok(lines(80).includes("   line 3"));
});

test("the details stay open after the command exits, show how it ended, and no longer offer x", (t) => {
  const running = [job("aaaa1111", "make", 1_000)];
  const { list, lines, stopped } = setup(running);
  t.after(() => list.dispose());
  list.handleInput("enter");
  assert.ok(lines().includes("   (no output yet)"));

  const finished = running.pop()!;
  finished.end = { status: "exit 2", durationMs: 4_200 };
  list.handleInput("x");
  assert.deepEqual(stopped, []);
  assert.equal(lines()[0], " Background command aaaa1111 · exit 2 · 4.2s");

  list.handleInput("esc");
  assert.ok(lines().includes(" No background commands running."));
});

test("when the highlighted command ends, x stops nothing until an arrow key picks a row", (t) => {
  const running = [job("aaaa1111", "sleep 1", 1_000), job("bbbb2222", "sleep 2", 2_000)];
  const { list, lines, stopped } = setup(running);
  t.after(() => list.dispose());
  lines();
  list.handleInput("down");
  assert.ok(lines()[2].startsWith(" → aaaa1111"));

  running.shift();
  assert.ok(!lines().some((line) => line.includes("→")), "no row highlighted");
  list.handleInput("x");
  list.handleInput("enter");
  assert.deepEqual(stopped, []);
  assert.equal(lines()[0], " Background commands", "enter opened nothing");

  list.handleInput("down");
  assert.ok(lines()[1].startsWith(" → bbbb2222"));
  list.handleInput("x");
  assert.deepEqual(stopped, ["bbbb2222"]);
});

test("c in the details copies the log path; a failed copy shows its error", async (t) => {
  const ok = setup([job("aaaa1111", "make", 1_000)]);
  const failing = setup([job("bbbb2222", "make", 1_000)], new Error("no clipboard"));
  t.after(() => [ok, failing].forEach(({ list }) => list.dispose()));
  for (const { list } of [ok, failing]) {
    list.handleInput("enter");
    list.handleInput("c");
  }
  await ok.settle();
  assert.deepEqual(ok.copied, [path.join(tmp, "aaaa1111.log")]);
  assert.ok(ok.lines().includes(` Copied: ${path.join(tmp, "aaaa1111.log")}`));
  assert.ok(failing.lines().includes(" Copy failed: no clipboard"));
});

test("esc in the details goes back to the list; esc in the list closes it", (t) => {
  const { list, lines, closed } = setup([job("aaaa1111", "make", 1_000)]);
  t.after(() => list.dispose());
  list.handleInput("enter");
  list.handleInput("esc");
  assert.equal(closed(), false);
  assert.equal(lines()[0], " Background commands");
  list.handleInput("esc");
  assert.equal(closed(), true);
});

test("the tail keeps the last 15 lines as a terminal shows them: no styles, a \\r progress line at its last state", () => {
  const logPath = path.join(tmp, "tail.log");
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  fs.writeFileSync(logPath, `${lines.join("\n")}\n\x1b[32mgreen\x1b[0m\tdone\n10%\r50%\r100%\n`);
  assert.deepEqual(readTail(logPath).split("\n"), [...lines.slice(-13), "green  done", "100%"]);
  assert.equal(readTail(path.join(tmp, "missing.log")), "(log file is gone)");
});
