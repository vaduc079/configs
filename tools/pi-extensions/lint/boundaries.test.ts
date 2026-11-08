import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { importProblem } from "./boundaries.ts";

const root = path.resolve(import.meta.dirname, "..");
const file = (rel: string) => path.join(root, rel);

test("an extension imports its own files, src/, node: built-ins, and pi's host packages", () => {
  const from = file("extensions/subagents/index.ts");
  ["./ui.ts", "./prompts/subagent.ts", "../../src/inbox.ts", "node:fs", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui/dist/x.js", "typebox"].forEach(
    (source) => assert.equal(importProblem(from, source), undefined, source),
  );
});

test("an extension never imports another extension", () => {
  assert.match(importProblem(file("extensions/subagents/index.ts"), "../permissions/rules.ts") ?? "", /must not import extensions\/permissions/);
  assert.match(importProblem(file("extensions/subagents/test/x.test.ts"), "../../permissions/rules.ts") ?? "", /must not import/);
});

test("src/ never imports an extension", () => {
  assert.match(importProblem(file("src/inbox.ts"), "../extensions/subagents/ui.ts") ?? "", /src\/ must not import from extensions/);
});

test("extensions and src/ do not import tooling, and nothing leaves the package", () => {
  assert.match(importProblem(file("src/inbox.ts"), "../lint/boundaries.ts") ?? "", /import only their own folder/);
  assert.match(importProblem(file("extensions/subagents/index.ts"), "../../../permission-evaluator/x.ts") ?? "", /inside the pi-extensions package/);
  assert.equal(importProblem(file("scripts/link-pi.ts"), "../lint/boundaries.ts"), undefined);
});

test("relative imports name the file extension", () => {
  assert.match(importProblem(file("src/inbox.ts"), "./output") ?? "", /file extension/);
});

test("packages: node: prefix for built-ins, devDependencies only in tooling, unknown packages rejected", () => {
  assert.match(importProblem(file("src/inbox.ts"), "fs") ?? "", /node:fs/);
  assert.match(importProblem(file("src/inbox.ts"), "typescript") ?? "", /not available to extensions/);
  assert.equal(importProblem(file("lint/structure.ts"), "typescript"), undefined);
  assert.match(importProblem(file("extensions/subagents/index.ts"), "left-pad") ?? "", /not available/);
});
