import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCounts } from "./resources.ts";

test("counts are pluralised except for one", () => {
  assert.equal(formatCounts({ contexts: 2, skills: 1, extensions: 0 }), "2 contexts · 1 skill · 0 extensions");
});
