import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import setup from "./index.ts";


type Result = { block?: boolean; reason?: string } | undefined;
type Handler = (event: unknown, ctx: unknown) => unknown;

interface Ui {
  /** The option the user picks in the dialog; undefined dismisses it. prompt.test.ts covers the dialog itself. */
  choose: (title: string) => Promise<string | undefined>;
  input: (title: string, placeholder?: string) => Promise<string | undefined>;
  notify: (message: string, type?: string) => void;
}

function makeCtx(over: Partial<Ui> = {}, hasUI = true) {
  const notices: string[] = [];
  const { choose, ...ui }: Ui = {
    choose: async () => "Allow",
    input: async () => undefined,
    notify: (m) => notices.push(m),
    ...over,
  };
  const custom = (_factory: unknown, options: { blocked: { message: string } }) => choose(options.blocked.message);
  return { ctx: { cwd: os.tmpdir(), hasUI, ui: { ...ui, custom, getEditorText: () => "" } }, notices };
}

function load(file: string) {
  process.env.PI_PERMISSIONS_FILE = file;
  const handlers: Record<string, Handler[]> = {};
  setup({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as never);
  const call = async (toolName: string, input: unknown, ctx: unknown): Promise<Result> =>
    (await handlers.tool_call[0]({ toolName, input, toolCallId: "t" }, ctx)) as Result;
  const start = async (ctx: unknown) => {
    for (const fn of handlers.session_start ?? []) await fn({ reason: "startup" }, ctx);
  };
  return { call, start };
}

const dir = mkdtempSync(path.join(os.tmpdir(), "pi-perm-"));
let n = 0;
function rulesFile(rules: unknown[]): string {
  const f = path.join(dir, `rules-${n++}.json`);
  writeFileSync(f, JSON.stringify({ permissions: rules }));
  return f;
}

// Tests run by a subagent inherit this; the gate must see a normal session unless a test sets it.
delete process.env.PI_SUBAGENT_CHILD;

const saved = process.env.PI_PERMISSIONS_FILE;
afterEach(() => {
  if (saved === undefined) delete process.env.PI_PERMISSIONS_FILE;
  else process.env.PI_PERMISSIONS_FILE = saved;
});

describe("gate", () => {
  const rules = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "deny", reason: "secret file" },
    { action: "shell", resource: "deploy *", effect: "ask" },
    { action: "mcp__x__send", resource: "*", effect: "ask" },
  ];
  let file: string;
  beforeEach(() => {
    file = rulesFile(rules);
  });

  it("deny blocks with the rule in the reason", async () => {
    const { call } = load(file);
    const { ctx } = makeCtx();
    const r = await call("read", { path: "a/.env" }, ctx);
    assert.equal(r?.block, true);
    assert.match(r?.reason ?? "", /^Blocked by permission rule: read .*\.env: secret file$/);
  });

  it("ask with no UI blocks with the no-one-present reason", async () => {
    const { call } = load(file);
    const { ctx } = makeCtx({}, false);
    const r = await call("bash", { command: "deploy prod" }, ctx);
    assert.equal(r?.block, true);
    assert.equal(
      r?.reason,
      "Permission rule shell deploy prod needs approval and no one is present to give it",
    );
  });

  it("ask in a subagent child blocks without a dialog; allow and deny are unchanged", async () => {
    const { call } = load(file);
    const { ctx } = makeCtx({ choose: async () => assert.fail("no dialog in a subagent") });
    process.env.PI_SUBAGENT_CHILD = "1";
    try {
      const r = await call("bash", { command: "deploy prod" }, ctx);
      assert.deepEqual(r, {
        block: true,
        reason: "Permission rule shell deploy prod needs user approval, which a subagent cannot ask for",
      });
      assert.equal(await call("read", { path: "a.txt" }, ctx), undefined);
      const denied = await call("read", { path: "a/.env" }, ctx);
      assert.match(denied?.reason ?? "", /^Blocked by permission rule: read .*\.env: secret file$/);
    } finally {
      delete process.env.PI_SUBAGENT_CHILD;
    }
  });

  it("ask with UI: Allow passes", async () => {
    const { call } = load(file);
    let title = "";
    const { ctx } = makeCtx({
      choose: async (t) => {
        title = t;
        return "Allow";
      },
    });
    assert.equal(await call("bash", { command: "deploy prod" }, ctx), undefined);
    assert.match(title, /Rule: ask · shell deploy \*/);
  });

  it("ask with UI: Deny blocks", async () => {
    const { call } = load(file);
    const { ctx } = makeCtx({ choose: async () => "Deny" });
    const r = await call("mcp__x__send", { text: "hi" }, ctx);
    assert.deepEqual(r, { block: true, reason: "Denied by the user" });
  });

  it("ask with UI: dismissed dialog denies", async () => {
    const { call } = load(file);
    const { ctx } = makeCtx({ choose: async () => undefined });
    const r = await call("mcp__x__send", {}, ctx);
    assert.deepEqual(r, { block: true, reason: "Denied by the user" });
  });

  it("ask with UI: Deny with reason passes the text; empty input is plain Deny", async () => {
    const { call } = load(file);
    const a = makeCtx({ choose: async () => "Deny with reason", input: async () => "too risky" });
    assert.deepEqual(await call("mcp__x__send", {}, a.ctx), {
      block: true,
      reason: "Denied by the user: too risky",
    });
    const b = makeCtx({ choose: async () => "Deny with reason", input: async () => "  " });
    assert.deepEqual(await call("mcp__x__send", {}, b.ctx), { block: true, reason: "Denied by the user" });
  });

  it("concurrent asks open dialogs one after the other", async () => {
    const { call } = load(file);
    const log: string[] = [];
    const releases: Array<() => void> = [];
    const { ctx } = makeCtx({
      choose: (t) => {
        log.push("start");
        return new Promise((resolve) =>
          releases.push(() => {
            log.push("end");
            resolve("Allow");
          }),
        );
      },
    });
    const p1 = call("mcp__x__send", { n: 1 }, ctx);
    const p2 = call("mcp__x__send", { n: 2 }, ctx);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(log, ["start"]);
    releases[0]();
    await p1;
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(log, ["start", "end", "start"]);
    releases[1]();
    assert.equal(await p2, undefined);
  });

  it("allow passes with no dialog", async () => {
    const { call } = load(file);
    let asked = false;
    const { ctx } = makeCtx({ choose: async () => ((asked = true), "Deny") });
    assert.equal(await call("bash", { command: "git status" }, ctx), undefined);
    assert.equal(asked, false);
  });

  it("codemode input yields no dialog", async () => {
    const { call } = load(file);
    let asked = false;
    const { ctx } = makeCtx({ choose: async () => ((asked = true), "Deny") });
    assert.equal(await call("codemode", { code: "deploy prod; cat .env" }, ctx), undefined);
    assert.equal(asked, false);
  });
});

describe("invalid rules file", () => {
  it("blocks every call and notifies once per session", async () => {
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    const { call, start } = load(bad);
    const { ctx, notices } = makeCtx();
    const r1 = await call("read", { path: "a.txt" }, ctx);
    const r2 = await call("bash", { command: "git status" }, ctx);
    for (const r of [r1, r2]) {
      assert.equal(r?.block, true);
      assert.match(r?.reason ?? "", new RegExp(`^Permission rules failed to load \\(${bad}\\): permissions: invalid JSON`));
    }
    assert.equal(notices.length, 1);
    await start(ctx);
    await call("read", { path: "a.txt" }, ctx);
    assert.equal(notices.length, 2, "once more after session_start");
  });

  it("missing file blocks", async () => {
    const { call } = load(path.join(dir, "missing.json"));
    const { ctx } = makeCtx({}, false);
    const r = await call("read", { path: "a.txt" }, ctx);
    assert.equal(r?.block, true);
    assert.match(r?.reason ?? "", /failed to load/);
  });

  it("session_start reloads a fixed file", async () => {
    const f = path.join(dir, "fixme.json");
    writeFileSync(f, "oops");
    const { call, start } = load(f);
    const { ctx } = makeCtx();
    assert.equal((await call("read", { path: "a" }, ctx))?.block, true);
    writeFileSync(f, JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "allow" }] }));
    await start(ctx);
    assert.equal(await call("read", { path: "a" }, ctx), undefined);
  });
});

describe("deny reason for path words in shell commands", () => {
  it("says the path was named in a shell command; the file tool does not", async () => {
    const { call } = load(
      rulesFile([
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: ".env", effect: "deny", reason: "secret file" },
        { action: "read", resource: "nr", effect: "deny" },
      ]),
    );
    const { ctx } = makeCtx();
    assert.equal(
      (await call("bash", { command: "cat .env" }, ctx))?.reason,
      "Blocked by permission rule: read .env (path named in a shell command): secret file",
    );
    assert.equal(
      (await call("bash", { command: "cat nr" }, ctx))?.reason,
      "Blocked by permission rule: read nr (path named in a shell command)",
    );
    assert.equal((await call("read", { path: ".env" }, ctx))?.reason, "Blocked by permission rule: read .env: secret file");
  });
});
