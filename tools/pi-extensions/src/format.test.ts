import assert from "node:assert/strict";
import { test } from "node:test";
import { cutToWidth, formatDuration, formatElapsed } from "./format.ts";

test("text wider than the limit is cut with an ellipsis, without style codes; wide characters are not split", () => {
  assert.equal(cutToWidth("short", 10), "short");
  assert.equal(cutToWidth("0123456789", 10), "0123456789");
  assert.equal(cutToWidth("0123456789ab", 10), "012345678…");
  assert.equal(cutToWidth("ab日本語", 5), "ab日…");
  assert.equal(cutToWidth("abc日本", 5), "abc …", "a wide character crossing the cut is left out, and a space keeps … in the last column");
  assert.equal(cutToWidth("abc def", 5), "abc …", "a space at the cut stays, so cut lines end in the same column");
});

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
