import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { structureProblems } from "./structure.ts";

/** Builds a package tree from `{ "rel/path": "contents" }` and returns its root. */
function tree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-extensions-structure-"));
  Object.entries(files).forEach(([rel, contents]) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), contents);
  });
  return root;
}

const shared = 'import { cap } from "../../src/output.ts";\n';

test("a clean layout has no problems", () => {
  const root = tree({
    "package.json": "{}",
    "extensions/a/index.ts": shared,
    "extensions/a/index.test.ts": "",
    "extensions/b/index.ts": 'import "./ui.ts";\n',
    "extensions/b/ui.ts": shared,
    "src/output.ts": 'import "./text.ts";\n',
    "src/output.test.ts": "",
    "src/text.ts": "",
  });
  assert.deepEqual(structureProblems(root), []);
});

test("an extension needs index.ts, and extensions/ holds only folders", () => {
  const root = tree({ "extensions/a/main.ts": "", "extensions/stray.ts": "" });
  assert.deepEqual(structureProblems(root), [
    "extensions/stray.ts: extensions/ holds one folder per extension",
    "extensions/a: missing index.ts, the entry pi loads",
  ]);
});

test("a src/ module needs an extension user; tests do not count", () => {
  const root = tree({
    "extensions/a/index.ts": "",
    "extensions/a/index.test.ts": shared,
    "src/output.ts": "",
    "src/text.ts": "",
  });
  assert.deepEqual(structureProblems(root), [
    "src/output.ts: no extension uses it; delete it or move it into the extension that needs it",
    "src/text.ts: no extension uses it; delete it or move it into the extension that needs it",
  ]);
});

test("one extension user is enough", () => {
  assert.deepEqual(structureProblems(tree({ "extensions/a/index.ts": shared, "src/output.ts": "" })), []);
});

test("lint directives are checked where oxlint cannot: a block disable of disable-reason, a protected next-line disable", () => {
  const root = tree({
    "extensions/a/index.ts": [
      "/* oxlint-disable local/disable-reason -- r */",
      "// oxlint-disable-next-line typescript/no-explicit-any -- r",
      "export const a = (x: unknown) => x as any;",
      "// oxlint-disable-next-line no-var -- fine",
      "export var b = 1; // oxlint-disable-line no-var -- fine",
      "// prose naming `eslint-disable`; is not a directive",
    ].join("\n"),
  });
  assert.deepEqual(structureProblems(root), [
    "extensions/a/index.ts:1: disable-reason cannot be disabled: fix the code (AGENTS.md).",
    "extensions/a/index.ts:2: no-explicit-any cannot be disabled: fix the code (AGENTS.md).",
  ]);
});

test("directives are found wherever oxlint honours them", () => {
  const bad = "oxlint-disable local/disable-reason -- r";
  const root = tree({
    "extensions/a/index.ts": [
      "/*",
      ` ${bad}`,
      " */",
      `export const a = 1;/* ${bad} */`,
      `/* x */ /* ${bad} */`,
      `export const b = "//"; /* ${bad} */`,
      `export const c = "// ${bad}";`,
    ].join("\n"),
  });
  const message = "disable-reason cannot be disabled: fix the code (AGENTS.md).";
  assert.deepEqual(
    structureProblems(root),
    [2, 4, 5, 6, 7].map((line) => `extensions/a/index.ts:${line}: ${message}`),
  );
});

test("every file oxlint lints is scanned, not only .ts", () => {
  const bad = "// oxlint-disable-line local/boundaries -- r";
  const root = tree({ "extensions/a/index.ts": "", "extensions/a/x.js": bad, "extensions/a/y.mts": bad });
  const message = "boundaries cannot be disabled: fix the code (AGENTS.md).";
  assert.deepEqual(structureProblems(root), [`extensions/a/x.js:1: ${message}`, `extensions/a/y.mts:1: ${message}`]);
});

test("only the root lint/*.test.ts skips the scan, for its directive fixtures", () => {
  const fixture = 'export const f = "// oxlint-disable local/disable-reason -- r";';
  const root = tree({ "extensions/a/index.ts": "", "lint/x.test.ts": fixture, "extensions/a/lint/x.test.ts": fixture });
  assert.deepEqual(structureProblems(root), [
    "extensions/a/lint/x.test.ts:1: disable-reason cannot be disabled: fix the code (AGENTS.md).",
  ]);
});

test("test/ folders and unknown root entries are reported", () => {
  const root = tree({ "extensions/a/index.ts": "", "extensions/a/test/x.test.ts": "", "notes.txt": "" });
  assert.deepEqual(structureProblems(root), [
    "notes.txt: not part of the package layout (AGENTS.md \"Structure\")",
    "extensions/a/test: put tests next to the module they test (x.test.ts beside x.ts)",
  ]);
});
