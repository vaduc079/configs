import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, formatElapsed } from "./format.ts";

test("one decimal under a minute, minutes and whole seconds from a minute", () => {
  assert.equal(formatDuration(0), "0.0s");
  assert.equal(formatDuration(1234), "1.2s");
  assert.equal(formatDuration(59_940), "59.9s");
  assert.equal(formatDuration(60_000), "1m 0s");
  assert.equal(formatDuration(62_900), "1m 2s");
});

test("elapsed time in whole seconds, minutes from a minute", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(5_900), "5s");
  assert.equal(formatElapsed(62_900), "1m 2s");
});
