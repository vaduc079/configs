import assert from "node:assert/strict";
import { test } from "node:test";
import { besides } from "./index.ts";

test("info sits right of the art, centred, after the art's widest line", () => {
  assert.deepEqual(besides(["aaaa", "b", "cc", "d", "e"], ["x", "y"], 80), ["aaaa", "b      x", "cc     y", "d", "e"]);
});

test("colour codes do not count toward the art width", () => {
  assert.deepEqual(besides(["\x1b[31mab\x1b[0m"], ["x"], 80), ["\x1b[31mab\x1b[0m   x"]);
});

test("without art the info starts at the left edge", () => {
  assert.deepEqual(besides([], ["x", "y"], 80), ["x", "y"]);
});

test("info taller than the art adds rows", () => {
  assert.deepEqual(besides(["a"], ["x", "y"], 80), ["a   x", "    y"]);
});

test("the art is dropped when art and info do not fit the width", () => {
  assert.deepEqual(besides(["aaaa"], ["xyz"], 9), ["xyz"]);
  assert.deepEqual(besides(["aaaa"], ["xyz"], 10), ["aaaa   xyz"]);
});
