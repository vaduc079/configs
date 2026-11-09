// Runs real shell commands through the tool, with pi's API faked. Needs pi's packages: `npm run link-pi`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";
import type { ResultDetails } from "./result.ts";

type Result = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };
type Tool = { execute: (id: string, params: object, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<Result> };
type Sent = { message: { content: string; details: ResultDetails }; options: { triggerTurn: boolean } };

// The tests may run inside a subagent child, which sets this; only the last test wants it.
delete process.env.PI_SUBAGENT_CHILD;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bash-background-test-"));
after(() => fs.rmSync(tmp, { recursive: true }));

function setup(settings = {}) {
  let tool: Tool | undefined;
  const handlers = new Map<string, ((event: unknown, ctx: unknown) => Promise<void>)[]>();
  const agent = { idle: true };
  const sent: Sent[] = [];
  const pi = {
    registerTool: (definition: Tool) => (tool = definition),
    registerMessageRenderer: () => {},
    on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    getSettings: () => settings,
    sendMessage: (message: Sent["message"], options: Sent["options"]) => sent.push({ message, options }),
  } as unknown as ExtensionAPI;
  extension(pi);
  const ctx = {
    cwd: tmp,
    isIdle: () => agent.idle,
    sessionManager: { getSessionId: () => "session-1", getSessionFile: () => undefined },
    ui: { setStatus: () => {}, theme: { bold: (text: string) => text, fg: (_color: string, text: string) => text } },
  };
  // Like pi: every handler of an event runs, in registration order (the inbox's first).
  const emit = async (name: string, event: object = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  void emit("session_start");
  const run = async (params: object) => {
    const result = await tool!.execute("call-1", params, undefined, undefined, ctx);
    return result.content.map((part) => part.text).join("");
  };
  return { tool, run, sent, agent, emit };
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 4_000): Promise<T> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(20)) {
    const value = check();
    if (value !== undefined) return value;
  }
  throw new Error("timed out waiting");
}

const logPathOf = (reply: string) => /Output log: (\S+)/.exec(reply)![1];
const killCommandOf = (reply: string) => /every process it started: (.+)/.exec(reply)![1];
const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const readLog = (logPath: string) => (fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "");

test("a background command returns at once, streams to its log, and posts one result when it exits", async () => {
  const { run, sent } = setup();
  const started = Date.now();
  const reply = await run({ command: "echo first; sleep 0.5; echo second", background: true });
  assert.ok(Date.now() - started < 400, "returned before the command finished");

  const logPath = logPathOf(reply);
  await waitFor(() => (readLog(logPath) === "first\n" ? true : undefined));
  assert.equal(sent.length, 0);

  const { message, options } = await waitFor(() => sent[0]);
  assert.equal(message.details.status, "exit 0");
  assert.equal(message.details.output, "first\nsecond\n");
  assert.match(message.content, /finished after [\d.]+m?s: exit 0/);
  assert.match(message.content, /first\nsecond/);
  assert.equal(options.triggerTurn, true);
  assert.equal(readLog(logPath), "first\nsecond\n");
  await sleep(100);
  assert.equal(sent.length, 1);
});

test("the kill command in the reply stops the command and its child processes", async () => {
  const { run, sent } = setup();
  const childPidPath = path.join(tmp, "child.pid");
  const reply = await run({ command: `sleep 30 & echo $! > ${childPidPath}; echo started; sleep 30; wait`, background: true });
  await waitFor(() => (readLog(logPathOf(reply)).includes("started") ? true : undefined));

  execFileSync("bash", ["-c", killCommandOf(reply)]);
  const { message } = await waitFor(() => sent[0]);
  assert.equal(message.details.status, "exit 143 (SIGTERM)");
  const childPid = Number(fs.readFileSync(childPidPath, "utf8"));
  await waitFor(() => (isRunning(childPid) ? undefined : true));
});

test("a command that ends with '&' reports the processes it left running, and the kill command stops them", async () => {
  const { run, sent } = setup();
  const childPidPath = path.join(tmp, "escaped.pid");
  const reply = await run({ command: `(sleep 30) & echo $! > ${childPidPath}`, background: true });
  const { message } = await waitFor(() => sent[0]);
  assert.match(message.details.status, /^the shell exited \(exit 0\) but processes it started are still running/);
  assert.ok(message.details.status.endsWith(`Stop them with: ${killCommandOf(reply)}`));
  const childPid = Number(fs.readFileSync(childPidPath, "utf8"));
  assert.ok(isRunning(childPid));

  execFileSync("bash", ["-c", killCommandOf(reply)]);
  await waitFor(() => (isRunning(childPid) ? undefined : true));
});

test("a background command with a timeout reports that it timed out", async () => {
  const { run, sent } = setup();
  await run({ command: "sleep 30", timeout: 0.2, background: true });
  const { message } = await waitFor(() => sent[0]);
  assert.equal(message.details.status, "timed out after 0.2s");
});

test("session shutdown kills running commands, and they post nothing", async () => {
  const { run, sent, emit } = setup();
  const shellPidPath = path.join(tmp, "shell.pid");
  await run({ command: `echo $$ > ${shellPidPath}; sleep 30`, background: true });
  const shellPid = await waitFor(() => Number(readLog(shellPidPath)) || undefined);
  await emit("session_shutdown");
  await waitFor(() => (isRunning(shellPid) ? undefined : true));
  await sleep(100);
  await emit("agent_settled", { aborted: false });
  assert.equal(sent.length, 0);
});

test("a result that arrives while the agent is busy is held, and delivered once when the agent settles", async () => {
  const { run, sent, agent, emit } = setup();
  agent.idle = false;
  const logPath = logPathOf(await run({ command: "echo done", background: true }));
  await waitFor(() => (readLog(logPath) === "done\n" ? true : undefined));
  await sleep(100);
  assert.equal(sent.length, 0);

  agent.idle = true;
  await emit("agent_settled", { aborted: false });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.triggerTurn, true);
});

test("after an aborted settle the held result is posted without starting a turn", async () => {
  const { run, sent, agent, emit } = setup();
  agent.idle = false;
  const logPath = logPathOf(await run({ command: "echo done", background: true }));
  await waitFor(() => (readLog(logPath) === "done\n" ? true : undefined));
  await sleep(100);

  await emit("agent_settled", { aborted: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.triggerTurn, false);
});

test("both modes run with the settings' command prefix and the session environment", async () => {
  const { run, sent } = setup({ shellCommandPrefix: "GREETING=hi" });
  const command = "echo $GREETING $PI_SESSION_ID";
  assert.equal(await run({ command }), "hi session-1\n");
  await run({ command, background: true });
  const { message } = await waitFor(() => sent[0]);
  assert.equal(message.details.output, "hi session-1\n");
});

test("a foreground command returns what pi's built-in bash returns", async () => {
  const { tool } = setup();
  const ctx = { cwd: tmp, sessionManager: { getSessionId: () => "session-1", getSessionFile: () => undefined } };
  const params = { command: "echo out; echo err >&2; exit 3" };
  const ours = await tool!.execute("call-1", params, undefined, undefined, ctx);
  const builtin = await createBashToolDefinition(tmp).execute("call-1", params, undefined, undefined, ctx as never);
  const withoutTime = (result: { structuredContent?: unknown }) => ({
    ...result,
    structuredContent: { ...(result.structuredContent as object), wall_time_seconds: 0 },
  });
  assert.deepEqual(withoutTime(ours), withoutTime(builtin));
});

test("a shell path that pi normalizes (~, file://) runs the same shell as the built-in", async () => {
  const bash = "/bin/bash";
  for (const shellPath of [`~/${path.relative(os.homedir(), bash)}`, `file://${bash}`]) {
    const { run, sent } = setup({ shellPath });
    const ctx = { cwd: tmp, sessionManager: { getSessionId: () => "session-1", getSessionFile: () => undefined } };
    const params = { command: "echo OK" };
    const builtin = await createBashToolDefinition(tmp, { shellPath: bash }).execute("call-1", params, undefined, undefined, ctx as never);
    assert.deepEqual(builtin.content, [{ type: "text", text: await run(params) }], shellPath);
    await run({ ...params, background: true });
    assert.equal((await waitFor(() => sent[0])).message.details.output, "OK\n", shellPath);
  }
});

test("a subagent child keeps pi's built-in bash", () => {
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    assert.equal(setup().tool, undefined);
  } finally {
    delete process.env.PI_SUBAGENT_CHILD;
  }
});
