import assert from "node:assert/strict";
import { test } from "node:test";
import { floatOpener } from "./float.ts";

const command = { argv: ["node", "pi.js", "--session", "s1"], cwd: "/work", title: "subagent: find bug" };

test("no float opener outside a supported terminal", () => {
  assert.equal(floatOpener({}), undefined);
  assert.equal(floatOpener({ REX_SESSION: "session:1" }), undefined);
});

test("in Rex, a centred floating layer over pi's window runs the command in an interactive shell", async () => {
  const calls: string[][] = [];
  const open = floatOpener({ REX_SESSION: "session:1", REX_BLOCK: "block:1" }, async (file, args) => {
    calls.push([file, ...args]);
    return args[0] === "block" ? JSON.stringify({ block: { window_id: "window:1" } }) : "{}";
  });
  await open!(command, { width: 0.8, height: 0.6 });
  assert.deepEqual(calls[0], ["rex", "block", "inspect", "-s", "session:1", "block:1", "--json"]);
  assert.deepEqual(calls[1].slice(0, 5), ["rex", "api", "call", "-s", "session:1"]);
  assert.equal(calls[1][5], "session.new_layer");
  const layer = JSON.parse(calls[1][6]) as { bounds: number[] };
  assert.deepEqual(layer, {
    window_id: "window:1",
    bounds: layer.bounds,
    focus: true,
    layout: {
      block: {
        flavor: "com.superlogical.terminal.shell",
        label: "subagent: find bug",
        options: { command: command.argv, cwd: "/work", interactive: true },
      },
    },
  });
  assert.deepEqual(
    layer.bounds.map((n) => Math.round(n * 100) / 100),
    [0.1, 0.2, 0.8, 0.6],
  );
});

test("a Rex block without a window fails with a message", async () => {
  const open = floatOpener({ REX_SESSION: "session:1", REX_BLOCK: "block:1" }, async () => "{}");
  await assert.rejects(open!(command, { width: 0.8, height: 0.8 }), /Rex did not report the window of block:1/);
});
