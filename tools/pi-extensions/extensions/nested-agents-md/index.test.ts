import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nested-index-")));
// Keep loadProjectContextFiles away from the real agent dir.
const agentDir = path.join(tmp, "agent");
fs.mkdirSync(agentDir);
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { default: extension, TYPE } = await import("./index.ts");

type Handler = (event: unknown, ctx: unknown) => unknown;
type Renderer = (message: unknown, options: { expanded: boolean; outputPad: number }, theme: unknown) => { render(width: number): string[] };
interface Sent {
  customType: string;
  content: string;
  display: boolean;
  details: { paths: string[] };
  opts?: unknown;
  /** In the fake projection: an entry whose message was removed (e.g. `context_edit`). */
  dropped?: boolean;
}

/** Loads the extension against a fake pi. `visible` stands for the session projection. */
function setup(root: string) {
  const handlers = new Map<string, Handler>();
  const sent: Sent[] = [];
  const visible: Sent[] = [];
  let renderer: Renderer | undefined;
  const pi = {
    on: (name: string, h: Handler) => void handlers.set(name, h),
    sendMessage: (msg: Sent, opts: unknown) => void sent.push({ ...msg, opts }),
    registerMessageRenderer: (_t: string, r: Renderer) => void (renderer = r),
  };
  extension(pi as unknown as ExtensionAPI);
  const ctx = {
    cwd: root,
    sessionManager: {
      buildSessionProjection: () => ({
        entries: visible.map((m) => ({ sourceEntry: { type: "custom_message", customType: m.customType, details: m.details }, messages: m.dropped ? [] : [m] })),
      }),
    },
  };
  const fire = (name: string, event: unknown) => handlers.get(name)!(event, ctx);
  fire("session_start", { reason: "startup" });
  return {
    sent,
    visible,
    renderer: () => renderer!,
    startRun: (contextFiles: string[]) => fire("before_agent_start", { systemPromptOptions: { contextFiles: contextFiles.map((p) => ({ path: p, content: "" })) } }),
    read: (p: string, extra: object = {}) => fire("tool_result", { toolName: "read", toolCallId: "t", input: { path: p }, isError: false, ...extra }),
    /** What pi does at the end of a step: turn_end handlers run, then the queued message is appended. */
    deliver: async (msg: Sent) => {
      await fire("turn_end", { type: "turn_end" });
      visible.push(msg);
    },
  };
}

let n = 0;
function project(files: Record<string, string>): string {
  const root = path.join(tmp, `p${n++}`);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}
const names = (root: string, m: Sent) => m.details.paths.map((p) => path.relative(root, p));

describe("injection", () => {
  test("a read under sub/ sends one message with the wrapped file, triggerTurn false", async () => {
    const root = project({ "sub/AGENTS.md": "SUB RULES", "sub/a.txt": "a", "AGENTS.md": "ROOT" });
    const t = setup(root);
    await t.startRun([path.join(root, "AGENTS.md")]);
    await t.read("sub/a.txt");
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].customType, TYPE);
    assert.equal(t.sent[0].display, true);
    assert.deepEqual(t.sent[0].details.paths, [path.join(root, "sub/AGENTS.md")]);
    assert.equal(t.sent[0].content, `<project_instructions path="${path.join(root, "sub/AGENTS.md")}">\nSUB RULES\n</project_instructions>`);
    assert.deepEqual(t.sent[0].opts, { triggerTurn: false });
  });

  test("several folders: one message, outermost first", async () => {
    const root = project({ "a/AGENTS.md": "A", "a/b/CLAUDE.md": "B", "a/b/x.txt": "x" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("a/b/x.txt");
    assert.equal(t.sent.length, 1);
    assert.deepEqual(names(root, t.sent[0]), ["a/AGENTS.md", "a/b/CLAUDE.md"]);
    assert.ok(t.sent[0].content.indexOf("\nA\n") < t.sent[0].content.indexOf("\nB\n"));
  });

  test("nothing for errors, other tools, reads outside the cwd, missing files", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const outside = project({ "AGENTS.md": "O", "y.txt": "y" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt", { isError: true });
    await t.read("sub/a.txt", { toolName: "bash" });
    await t.read(path.join(outside, "y.txt"));
    await t.read("sub/missing.txt");
    await t.read(undefined as unknown as string, { input: {} });
    assert.equal(t.sent.length, 0);
  });

  test("a codemode read (parentToolCallId) injects like a direct read", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt", { parentToolCallId: "script-1" });
    assert.equal(t.sent.length, 1);
  });

  test("reading sub/AGENTS.md itself sends only the parent folders' files, and is not recorded as seen", async () => {
    const root = project({ "a/AGENTS.md": "A", "a/b/AGENTS.md": "B", "a/b/x.txt": "x" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("a/b/AGENTS.md");
    assert.equal(t.sent.length, 1);
    assert.deepEqual(names(root, t.sent[0]), ["a/AGENTS.md"]);
    await t.deliver(t.sent[0]);
    await t.read("a/b/x.txt");
    assert.equal(t.sent.length, 2);
    assert.deepEqual(names(root, t.sent[1]), ["a/b/AGENTS.md"]);
  });
});

describe("pending set", () => {
  test("two reads before the message is appended send it once", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a", "sub/b.txt": "b" });
    const t = setup(root);
    await t.startRun([]);
    await Promise.all([t.read("sub/a.txt"), t.read("sub/b.txt")]);
    assert.equal(t.sent.length, 1);
  });

  test("turn_end clears pending: a file that drops out of the projection (compaction, /tree) is sent again", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a", "sub/b.txt": "b" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt");
    await t.deliver(t.sent[0]);
    t.visible.length = 0; // e.g. compacted away
    await t.read("sub/b.txt");
    assert.equal(t.sent.length, 2);
  });

  test("a new run clears pending (e.g. after an abort that never reached turn_end)", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a", "sub/b.txt": "b" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt");
    await t.startRun([]);
    await t.read("sub/b.txt");
    assert.equal(t.sent.length, 2);
  });
});

describe("inPrompt skip", () => {
  test("a context file in the system prompt (even via a symlink path) is not injected", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a", "sub/deep/AGENTS.md": "D", "sub/deep/b.txt": "b" });
    fs.symlinkSync(root, path.join(tmp, `link${n}`));
    const viaLink = path.join(tmp, `link${n}`, "sub/AGENTS.md");
    const t = setup(root);
    await t.startRun([viaLink]);
    await t.read("sub/deep/b.txt");
    assert.equal(t.sent.length, 1);
    assert.deepEqual(names(root, t.sent[0]), ["sub/deep/AGENTS.md"]);
  });

  test("the set is replaced on every run, not merged", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const t = setup(root);
    await t.startRun([path.join(root, "sub/AGENTS.md")]);
    await t.read("sub/a.txt");
    assert.equal(t.sent.length, 0);
    await t.startRun([]);
    await t.read("sub/a.txt");
    assert.equal(t.sent.length, 1);
  });
});

describe("projection check", () => {
  test("a file visible in the projection is not sent again", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt");
    await t.deliver(t.sent[0]);
    await t.read("sub/a.txt");
    assert.equal(t.sent.length, 1);
  });

  test("an entry of another custom type, or with no messages, does not count", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const paths = [path.join(root, "sub/AGENTS.md")];
    for (const entry of [{ customType: "other" }, { customType: TYPE, dropped: true }]) {
      const t = setup(root);
      await t.startRun([]);
      t.visible.push({ content: "", display: true, details: { paths }, ...entry });
      await t.read("sub/a.txt");
      assert.equal(t.sent.length, 1, JSON.stringify(entry));
    }
  });
});

describe("context files off (-nc)", () => {
  test("empty contextFiles while files exist on disk: stays off", async () => {
    const root = project({ "AGENTS.md": "ROOT", "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt");
    assert.equal(t.sent.length, 0);
  });

  test("empty contextFiles and none on disk (project has no root file): still injects", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt");
    assert.equal(t.sent.length, 1);
  });

  test("off is recomputed per run", async () => {
    const root = project({ "AGENTS.md": "ROOT", "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt");
    assert.equal(t.sent.length, 0);
    await t.startRun([path.join(root, "AGENTS.md")]);
    await t.read("sub/a.txt");
    assert.equal(t.sent.length, 1);
  });
});

describe("robustness and renderer", () => {
  test("a throwing session manager never fails the read", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const handlers = new Map<string, Handler>();
    extension({ on: (n: string, h: Handler) => handlers.set(n, h), sendMessage() {}, registerMessageRenderer() {} } as unknown as ExtensionAPI);
    const ctx = { cwd: root, sessionManager: { buildSessionProjection: () => { throw new Error("boom"); } } };
    assert.equal(await handlers.get("tool_result")!({ toolName: "read", input: { path: "sub/a.txt" }, isError: false }, ctx), undefined);
  });

  test("renderer: collapsed row shows the cwd-relative path, expanded adds the content", async () => {
    const root = project({ "sub/AGENTS.md": "S", "sub/a.txt": "a" });
    const t = setup(root);
    await t.startRun([]);
    await t.read("sub/a.txt");
    const msg = { ...t.sent[0], role: "custom", timestamp: 0 };
    const theme = { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s };
    const collapsed = t.renderer()(msg, { expanded: false, outputPad: 1 }, theme).render(100).join("\n");
    assert.match(collapsed, /Loaded sub\/AGENTS\.md/);
    assert.doesNotMatch(collapsed, /SUB|project_instructions/);
    const expanded = t.renderer()(msg, { expanded: true, outputPad: 1 }, theme).render(100).join("\n");
    assert.match(expanded, /Loaded sub\/AGENTS\.md/);
    assert.match(expanded, /\bS\b/);
  });
});
