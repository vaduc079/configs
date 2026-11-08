import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, test } from "node:test";
import { findContextFiles, isBelow, resolveReadPath } from "../discover.ts";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nested-discover-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A fresh project dir (the cwd/root) with the given files; paths relative to it. A string value is the file content, `{ link }` a symlink. */
function project(files: Record<string, string | { link: string }>): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, value] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (typeof value === "string") fs.writeFileSync(full, value);
    else fs.symlinkSync(value.link, full);
  }
  return root;
}
const rel = (root: string, files: string[]) => files.map((f) => path.relative(root, f));

describe("findContextFiles: first name match per folder", () => {
  test("AGENTS.override.md beats AGENTS.md and CLAUDE.md", () => {
    const root = project({ "sub/AGENTS.override.md": "o", "sub/AGENTS.md": "a", "sub/CLAUDE.md": "c", "sub/x.txt": "x" });
    assert.deepEqual(rel(root, findContextFiles(path.join(root, "sub/x.txt"), root)), ["sub/AGENTS.override.md"]);
  });
  test("AGENTS.md beats CLAUDE.md", () => {
    const root = project({ "sub/AGENTS.md": "a", "sub/CLAUDE.md": "c", "sub/x.txt": "x" });
    assert.deepEqual(rel(root, findContextFiles(path.join(root, "sub/x.txt"), root)), ["sub/AGENTS.md"]);
  });
  test("CLAUDE.md alone is found", () => {
    const root = project({ "sub/CLAUDE.md": "c", "sub/x.txt": "x" });
    assert.deepEqual(rel(root, findContextFiles(path.join(root, "sub/x.txt"), root)), ["sub/CLAUDE.md"]);
  });
  test("a directory with a context file name is ignored", () => {
    const root = project({ "sub/AGENTS.md/inner.txt": "i", "sub/CLAUDE.md": "c", "sub/x.txt": "x" });
    assert.deepEqual(rel(root, findContextFiles(path.join(root, "sub/x.txt"), root)), ["sub/CLAUDE.md"]);
  });
  test("a folder without a context file contributes nothing", () => {
    const root = project({ "sub/x.txt": "x" });
    assert.deepEqual(findContextFiles(path.join(root, "sub/x.txt"), root), []);
  });
});

describe("findContextFiles: symlinks", () => {
  test("CLAUDE.md -> AGENTS.md: one file, AGENTS.md", () => {
    const root = project({ "sub/AGENTS.md": "a", "sub/CLAUDE.md": { link: "AGENTS.md" }, "sub/x.txt": "x" });
    assert.deepEqual(rel(root, findContextFiles(path.join(root, "sub/x.txt"), root)), ["sub/AGENTS.md"]);
  });
  test("a symlinked context file is returned as its realpath", () => {
    const root = project({ "real/rules.md": "r", "sub/AGENTS.md": { link: "../real/rules.md" }, "sub/x.txt": "x" });
    assert.deepEqual(findContextFiles(path.join(root, "sub/x.txt"), root), [path.join(root, "real/rules.md")]);
  });
});

describe("findContextFiles: order and exclusions", () => {
  test("outermost first", () => {
    const root = project({ "a/AGENTS.md": "1", "a/b/CLAUDE.md": "2", "a/b/c/AGENTS.md": "3", "a/b/c/x.txt": "x" });
    assert.deepEqual(rel(root, findContextFiles(path.join(root, "a/b/c/x.txt"), root)), ["a/AGENTS.md", "a/b/CLAUDE.md", "a/b/c/AGENTS.md"]);
  });
  test("the read file itself is excluded, parents are not", () => {
    const root = project({ "a/AGENTS.md": "1", "a/b/AGENTS.md": "2" });
    assert.deepEqual(rel(root, findContextFiles(path.join(root, "a/b/AGENTS.md"), root)), ["a/AGENTS.md"]);
  });
  test("folders at or above the root are never returned", () => {
    const root = project({ "AGENTS.md": "root", "sub/x.txt": "x" });
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), "above");
    assert.deepEqual(findContextFiles(path.join(root, "sub/x.txt"), root), []);
    assert.deepEqual(findContextFiles(path.join(root, "x.txt"), root), []);
  });
  test("a file outside the root yields nothing", () => {
    const root = project({ "sub/AGENTS.md": "a" });
    const other = project({ "AGENTS.md": "o", "y.txt": "y" });
    assert.deepEqual(findContextFiles(path.join(other, "y.txt"), root), []);
  });
});

describe("resolveReadPath", () => {
  test("relative path", () => {
    const root = project({ "sub/x.txt": "x" });
    assert.equal(resolveReadPath("sub/x.txt", root), path.join(root, "sub/x.txt"));
  });
  test("absolute path", () => {
    const root = project({ "sub/x.txt": "x" });
    assert.equal(resolveReadPath(path.join(root, "sub/x.txt"), "/"), path.join(root, "sub/x.txt"));
  });
  test("@ prefix is stripped", () => {
    const root = project({ "sub/x.txt": "x" });
    assert.equal(resolveReadPath("@sub/x.txt", root), path.join(root, "sub/x.txt"));
  });
  test("~ and ~/ expand to the home dir", () => {
    const home = project({ "docs/x.txt": "x" });
    assert.equal(resolveReadPath("~/docs/x.txt", "/", home), path.join(home, "docs/x.txt"));
    assert.equal(resolveReadPath("~", "/", home), home);
  });
  test("@~/ works too", () => {
    const home = project({ "docs/x.txt": "x" });
    assert.equal(resolveReadPath("@~/docs/x.txt", "/", home), path.join(home, "docs/x.txt"));
  });
  test("file:// URLs", () => {
    const root = project({ "sub/x.txt": "x" });
    assert.equal(resolveReadPath(`file://${path.join(root, "sub/x.txt")}`, "/"), path.join(root, "sub/x.txt"));
  });
  test("unicode spaces become plain spaces", () => {
    const root = project({ "my dir/x.txt": "x" });
    assert.equal(resolveReadPath("my\u00A0dir/x.txt", root), path.join(root, "my dir/x.txt"));
  });
  test("a missing file is undefined", () => {
    const root = project({});
    assert.equal(resolveReadPath("nope.txt", root), undefined);
  });
  test("a symlinked read path resolves to its target outside the root", () => {
    const outside = project({ "AGENTS.md": "o", "y.txt": "y" });
    const root = project({ "sub/link.txt": { link: path.join(outside, "y.txt") } });
    const file = resolveReadPath("sub/link.txt", root)!;
    assert.equal(file, path.join(outside, "y.txt"));
    assert.equal(isBelow(file, root), false);
  });
  test("a symlinked folder inside the root resolves into the root", () => {
    const root = project({ "real/AGENTS.md": "r", "real/x.txt": "x", "alias": { link: "real" } });
    const file = resolveReadPath("alias/x.txt", root)!;
    assert.equal(file, path.join(root, "real/x.txt"));
    assert.deepEqual(rel(root, findContextFiles(file, root)), ["real/AGENTS.md"]);
  });
});

describe("isBelow", () => {
  test("strictly inside only", () => {
    assert.equal(isBelow("/a/b/c", "/a/b"), true);
    assert.equal(isBelow("/a/b", "/a/b"), false);
    assert.equal(isBelow("/a", "/a/b"), false);
    assert.equal(isBelow("/a/bc", "/a/b"), false);
    assert.equal(isBelow("/x/y", "/a/b"), false);
  });
});
