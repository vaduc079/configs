// Runs real shell commands through the tool, with pi's API faked. Needs pi's packages: `npm run link-pi`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { createBashToolDefinition, createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STATUS_LINE_CLICK } from "../../src/status.ts";
import extension from "./index.ts";
import type { ResultDetails } from "./result.ts";

type Result = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };
type Tool = { name: string; execute: (id: string, params: object, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<Result> };
type Entry = { type: "custom"; customType: string; data: Record<string, unknown> };
type Sent = { message: { content: string; details: ResultDetails }; options: { triggerTurn?: boolean; deliverAs?: string } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bash-background-test-"));
after(() => fs.rmSync(tmp, { recursive: true }));

type Command = { handler: (args: string, ctx: unknown) => Promise<void> };
type Screen = { handleInput(data: string): void; render(width: number): string[]; dispose(): void };

async function setup(settings = {}, { sessionId = "session-1", branch = [] as Entry[], idle = true } = {}) {
  const tools = new Map<string, Tool>();
  const commands = new Map<string, Command>();
  const notices: string[] = [];
  let screen: Screen | undefined;
  const screens: Screen[] = [];
  const handlers = new Map<string, ((event: unknown, ctx: unknown) => Promise<void>)[]>();
  const agent = { idle, running: false };
  const sent: Sent[] = [];
  const events = createEventBus();
  const pi = {
    events,
    registerTool: (definition: Tool) => tools.set(definition.name, definition),
    appendEntry: (customType: string, data: Entry["data"]) => branch.push({ type: "custom", customType, data }),
    registerMessageRenderer: () => {},
    registerCommand: (name: string, command: Command) => commands.set(name, command),
    on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    getSettings: () => settings,
    sendMessage: (message: Sent["message"], options: Sent["options"]) => sent.push({ message, options }),
  } as unknown as ExtensionAPI;
  extension(pi);
  const ctx = {
    cwd: tmp,
    isIdle: () => agent.idle,
    get signal() {
      return agent.running ? new AbortController().signal : undefined;
    },
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => undefined, getBranch: () => branch },
    ui: {
      setStatus: () => {},
      theme,
      notify: (message: string) => notices.push(message),
      // Like pi, the screen stays open until it calls done; the test drives it with keys.
      custom: (factory: (tui: object, theme: object, keybindings: object, done: () => void) => Screen) =>
        new Promise<void>((resolve) => {
          screen = factory({ requestRender: () => {}, terminal: { rows: 40 } }, theme, { matches: (data: string, binding: string) => data === binding }, resolve);
          screens.push(screen);
        }),
    },
  };
  // Like pi: every handler of an event runs, in registration order (the inbox's first).
  const emit = async (name: string, event: object = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  // Like pi, the session has started before any tool runs.
  await emit("session_start");
  const tool = tools.get("bash");
  const run = async (params: object) => {
    const result = await tool!.execute("call-1", params, undefined, undefined, ctx);
    return result.content.map((part) => part.text).join("");
  };
  const stop = (id: string) => tools.get("background_stop")!.execute("call-2", { id }, undefined, undefined, ctx);
  // Not awaited: the command resolves only once its screen closes.
  const openBackground = async () => {
    void commands.get("background")!.handler("", ctx);
    return screen;
  };
  return { tool, run, stop, sent, agent, emit, events, openBackground, screens, notices, branch };
}

const theme = { bold: (text: string) => text, fg: (_color: string, text: string) => text };

async function waitFor<T>(check: () => T | undefined, timeoutMs = 4_000): Promise<T> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(20)) {
    const value = check();
    if (value !== undefined) return value;
  }
  throw new Error("timed out waiting");
}

const logPathOf = (reply: string) => /Output log: (\S+)/.exec(reply)![1];
const idOf = (reply: string) => /\(id (\w+)\)/.exec(reply)![1];
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
  const { run, sent } = await setup();
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

test("background_stop stops the command and its child processes, returns the result, and posts nothing", async () => {
  const { run, stop, sent } = await setup();
  const childPidPath = path.join(tmp, "child.pid");
  const reply = await run({ command: `sleep 30 & echo $! > ${childPidPath}; echo started; sleep 30; wait`, background: true });
  await waitFor(() => (readLog(logPathOf(reply)).includes("started") ? true : undefined));

  const started = Date.now();
  const result = await stop(idOf(reply));
  assert.ok(Date.now() - started < 2_000, "ended on SIGTERM, before the grace period");
  const text = result.content.map((part) => part.text).join("");
  assert.match(text, new RegExp(`^Background command ${idOf(reply)} finished after [\\d.]+m?s: stopped by the agent\n`));
  assert.match(text, /\nstarted\n/);
  const childPid = Number(fs.readFileSync(childPidPath, "utf8"));
  await waitFor(() => (isRunning(childPid) ? undefined : true));
  await sleep(100);
  assert.equal(sent.length, 0);
});

test("background_stop with an unknown id names the running commands", async () => {
  const { run, stop, sent } = await setup();
  await assert.rejects(stop("nope"), /No running background command with id nope\. No background commands are running\./);
  const id = idOf(await run({ command: "sleep 30", background: true }));
  await assert.rejects(stop("nope"), new RegExp(`Running: ${id}\\. A command that already exited has posted its result\\.`));
  await stop(id);
  assert.equal(sent.length, 0);
});

test("a command that ends with '&' reports the processes it left running, and the kill command stops them", async () => {
  const { run, sent } = await setup();
  const childPidPath = path.join(tmp, "escaped.pid");
  await run({ command: `(sleep 30) & echo $! > ${childPidPath}`, background: true });
  const { message } = await waitFor(() => sent[0]);
  assert.match(message.details.status, /^the shell exited \(exit 0\) but processes it started are still running/);
  const killCommand = /Stop them with: (.+)$/.exec(message.details.status)![1];
  const childPid = Number(fs.readFileSync(childPidPath, "utf8"));
  assert.ok(isRunning(childPid));

  execFileSync("bash", ["-c", killCommand]);
  await waitFor(() => (isRunning(childPid) ? undefined : true));
});

test("/background stops a running command and its child processes, and the result says the user stopped it", async (t) => {
  const { run, sent, openBackground } = await setup();
  const childPidPath = path.join(tmp, "stopped-child.pid");
  const reply = await run({ command: `sleep 30 & echo $! > ${childPidPath}; echo started; wait`, background: true });
  await waitFor(() => (readLog(logPathOf(reply)).includes("started") ? true : undefined));

  const screen = (await openBackground())!;
  t.after(() => screen.dispose());
  assert.ok(screen.render(120).some((line) => line.includes("sleep 30 & echo")));
  screen.handleInput("tui.select.confirm");
  screen.handleInput("x");
  const { message } = await waitFor(() => sent[0]);
  assert.equal(message.details.status, "stopped by the user");
  assert.match(message.content, /finished after [\d.]+m?s: stopped by the user/);
  const childPid = Number(fs.readFileSync(childPidPath, "utf8"));
  await waitFor(() => (isRunning(childPid) ? undefined : true));
  // The open details show how it ended, and x is no longer offered.
  const details = screen.render(120);
  assert.match(details.find((line) => line.includes("Background command"))!, /· stopped by the user · [\d.]+m?s/);
  assert.ok(details.some((line) => line.trim() === "x stop  c copy log path  esc back"));
  screen.handleInput("tui.select.cancel");
  assert.ok(screen.render(120).some((line) => line.includes("No background commands running.")));
});

test("a click on a command's footer line opens /background on its details; a click while open switches it", async (t) => {
  const { run, events, screens, emit } = await setup();
  t.after(() => emit("session_shutdown"));
  t.after(() => screens.forEach((screen) => screen.dispose()));
  const first = idOf(await run({ command: "sleep 30 # first", background: true }));
  const second = idOf(await run({ command: "sleep 30 # second", background: true }));
  const click = (line: number) => events.emit(STATUS_LINE_CLICK, { key: "lines:bash-background", line });
  const shows = (id: string) => screens.at(-1)!.render(120).some((line) => line.includes(`Background command ${id}`));

  click(1);
  assert.ok(shows(second));
  await sleep(0);
  click(0);
  assert.equal(screens.length, 1, "the open screen switched, rather than a second one opening");
  assert.ok(shows(first));

  screens[0].handleInput("tui.select.cancel");
  screens[0].handleInput("tui.select.cancel");
  await sleep(0);
  click(1);
  assert.equal(screens.length, 2, "once closed, a click opens a new screen");
  assert.ok(shows(second));
});

test("/background with nothing running says so instead of opening", async () => {
  const { openBackground, notices } = await setup();
  assert.equal(await openBackground(), undefined);
  assert.deepEqual(notices, ["No background commands running."]);
});

test("a background command with a timeout reports that it timed out", async () => {
  const { run, sent } = await setup();
  await run({ command: "sleep 30", timeout: 0.2, background: true });
  const { message } = await waitFor(() => sent[0]);
  assert.equal(message.details.status, "timed out after 0.2s");
});

test("session shutdown kills running commands, and they post nothing", async () => {
  const { run, sent, emit } = await setup();
  const shellPidPath = path.join(tmp, "shell.pid");
  await run({ command: `echo $$ > ${shellPidPath}; sleep 30`, background: true });
  const shellPid = await waitFor(() => Number(readLog(shellPidPath)) || undefined);
  await emit("session_shutdown");
  await waitFor(() => (isRunning(shellPid) ? undefined : true));
  await sleep(100);
  await emit("agent_settled", { aborted: false });
  assert.equal(sent.length, 0);
});

test("a result that arrives while the agent runs is steered into the run at once", async () => {
  const { run, sent, agent } = await setup();
  agent.idle = false;
  agent.running = true;
  await run({ command: "echo done", background: true });
  const { message, options } = await waitFor(() => sent[0]);
  assert.equal(message.details.output, "done\n");
  assert.deepEqual(options, { deliverAs: "steer" });
});

test("a result that arrives while the agent is busy but not running is held, and delivered once when the agent settles", async () => {
  const { run, sent, agent, emit } = await setup();
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
  const { run, sent, agent, emit } = await setup();
  agent.idle = false;
  const logPath = logPathOf(await run({ command: "echo done", background: true }));
  await waitFor(() => (readLog(logPath) === "done\n" ? true : undefined));
  await sleep(100);

  agent.idle = true;
  await emit("agent_settled", { aborted: true });
  await sleep(0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.triggerTurn, false);
});

test("both modes run with the settings' command prefix and the session environment", async () => {
  const { run, sent } = await setup({ shellCommandPrefix: "GREETING=hi" });
  const command = "echo $GREETING $PI_SESSION_ID";
  assert.equal(await run({ command }), "hi session-1\n");
  await run({ command, background: true });
  const { message } = await waitFor(() => sent[0]);
  assert.equal(message.details.output, "hi session-1\n");
});

test("a foreground command returns what pi's built-in bash returns", async () => {
  const { tool } = await setup();
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

test("a background command returns structured content, for codemode scripts, that matches its reply", async () => {
  const { tool, sent } = await setup();
  const ctx = { cwd: tmp, isIdle: () => true, sessionManager: { getSessionId: () => "session-1", getSessionFile: () => undefined } };
  const result = await tool!.execute("call-1", { command: "echo done", background: true }, undefined, undefined, ctx);
  const reply = result.content.map((part) => part.text).join("");
  const { background_id, log_path, note, ...rest } = result.structuredContent as Record<string, string>;
  assert.match(reply, new RegExp(`\\(id ${background_id}\\)`));
  assert.equal(log_path, logPathOf(reply));
  assert.ok(reply.endsWith(note));
  assert.deepEqual(rest, {}, "no kill_command");
  assert.ok(reply.includes(`call background_stop with id ${background_id}.`));
  assert.ok(!reply.includes("kill "));
  await waitFor(() => sent[0]);
});

test("a shell path that pi normalizes (~, file://) runs the same shell as the built-in", async () => {
  const bash = "/bin/bash";
  for (const shellPath of [`~/${path.relative(os.homedir(), bash)}`, `file://${bash}`]) {
    const { run, sent } = await setup({ shellPath });
    const ctx = { cwd: tmp, sessionManager: { getSessionId: () => "session-1", getSessionFile: () => undefined } };
    const params = { command: "echo OK" };
    const builtin = await createBashToolDefinition(tmp, { shellPath: bash }).execute("call-1", params, undefined, undefined, ctx as never);
    assert.deepEqual(builtin.content, [{ type: "text", text: await run(params) }], shellPath);
    await run({ ...params, background: true });
    assert.equal((await waitFor(() => sent[0])).message.details.output, "OK\n", shellPath);
  }
});

test("after a compaction with commands running, the agent is told what still runs, without a new turn", async () => {
  const { run, stop, sent, emit } = await setup();
  await emit("session_compact");
  await sleep(10);
  assert.equal(sent.length, 0, "nothing running, nothing posted");

  const reply = await run({ command: "sleep 30", background: true });
  await emit("session_compact");
  await waitFor(() => sent[0]);
  const { message, options } = sent[0];
  assert.match(message.content, new RegExp(`^Background commands still running:\n- ${idOf(reply)} \\(running \\d+s\\): sleep 30\n  log: ${logPathOf(reply)}\n`));
  assert.match(message.content, /call background_stop with its id\.$/);
  assert.notEqual(options.triggerTurn, true);
  await stop(idOf(reply));
});

test("a job saves a start entry, and an end entry once its result is posted", async () => {
  const { run, stop, sent, branch } = await setup();
  const reply = await run({ command: "echo done", background: true });
  const id = idOf(reply);
  await waitFor(() => sent[0]);
  assert.deepEqual(
    branch.map((entry) => entry.data),
    [
      { id, ownerSessionId: "session-1", state: "started", command: "echo done", logPath: logPathOf(reply) },
      { id, ownerSessionId: "session-1", state: "ended" },
    ],
  );
  assert.ok(branch.every((entry) => entry.customType === "bash-background-job"));

  const stopped = idOf(await run({ command: "sleep 30", background: true }));
  await stop(stopped);
  assert.deepEqual(branch.at(-1)!.data, { id: stopped, ownerSessionId: "session-1", state: "ended" });
});

const jobEntry = (data: Entry["data"]): Entry => ({ type: "custom", customType: "bash-background-job", data });

test("on session start, this session's jobs that never ended are reported once without a new turn, and others are ignored", async () => {
  const branch = [
    jobEntry({ id: "cut", ownerSessionId: "session-1", state: "started", command: "npm run build", logPath: "/tmp/cut.log" }),
    jobEntry({ id: "done", ownerSessionId: "session-1", state: "started", command: "echo", logPath: "/tmp/done.log" }),
    jobEntry({ id: "done", ownerSessionId: "session-1", state: "ended" }),
    jobEntry({ id: "parent", ownerSessionId: "session-0", state: "started", command: "make", logPath: "/tmp/parent.log" }),
  ];
  const { sent, emit } = await setup({}, { branch });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].options, { triggerTurn: false });
  assert.match(sent[0].message.content, /^Background commands interrupted: pi stopped while they ran, or before their results were posted\./);
  assert.match(sent[0].message.content, /\n- cut: npm run build\n  log: \/tmp\/cut\.log$/);
  assert.deepEqual(branch.at(-1)!.data, { id: "cut", ownerSessionId: "session-1", state: "ended" });
  assert.equal(branch.length, 5);

  await emit("session_start");
  assert.equal(sent.length, 1, "reported once");
});

test("the interrupted notice is marked reported only once it is posted, so a quit before then reports it again", async () => {
  const branch = [jobEntry({ id: "cut", ownerSessionId: "session-1", state: "started", command: "npm run build", logPath: "/tmp/cut.log" })];
  const first = await setup({}, { branch, idle: false });
  assert.equal(first.sent.length, 0);
  assert.equal(branch.length, 1, "no ended entry before the notice is posted");
  await first.emit("session_shutdown");

  const second = await setup({}, { branch, idle: false });
  assert.equal(second.sent.length, 0);
  assert.equal(branch.length, 1);
  second.agent.idle = true;
  await second.emit("agent_settled", { aborted: false });
  assert.equal(second.sent.length, 1);
  assert.deepEqual(second.sent[0].options, { triggerTurn: false });
  assert.match(second.sent[0].message.content, /\n- cut: npm run build\n/);
  assert.deepEqual(branch.at(-1)!.data, { id: "cut", ownerSessionId: "session-1", state: "ended" });
  assert.equal(branch.length, 2);
});

test("two stops at once share one result, post nothing, and save one end entry", async () => {
  const { run, stop, sent, branch } = await setup();
  const reply = await run({ command: "echo ready; sleep 30", background: true });
  await waitFor(() => (readLog(logPathOf(reply)).includes("ready") ? true : undefined));
  const [first, second] = await Promise.all([stop(idOf(reply)), stop(idOf(reply))]);
  assert.deepEqual(first, second);
  assert.equal(sent.length, 0);
  assert.equal(branch.filter((entry) => entry.data.state === "ended").length, 1);
});

test("a stop whose signal fails fails every overlapping stop, and a retry stops the command", async () => {
  const { run, stop, sent } = await setup();
  const reply = await run({ command: "echo ready; sleep 30", background: true });
  await waitFor(() => (readLog(logPathOf(reply)).includes("ready") ? true : undefined));
  const kill = process.kill.bind(process);
  let failed = false;
  process.kill = (pid: number, signal?: string | number) => {
    if (!failed && signal === "SIGTERM") {
      failed = true;
      throw Object.assign(new Error("simulated EPERM"), { code: "EPERM" });
    }
    return kill(pid, signal);
  };
  try {
    await Promise.all([assert.rejects(stop(idOf(reply)), /simulated EPERM/), assert.rejects(stop(idOf(reply)), /simulated EPERM/)]);
  } finally {
    process.kill = kill;
  }
  const retry = stop(idOf(reply));
  const outcome = await Promise.race([retry.then(() => "stopped"), sleep(2_000).then(() => "hung")]);
  assert.equal(outcome, "stopped");
  assert.match((await retry).content[0].text, /stopped by the agent/);
  assert.equal(sent.length, 0);
});

test("session shutdown during an agent stop fails the stop, posts nothing, and saves no end entry", async () => {
  const { run, stop, sent, emit, branch } = await setup();
  const reply = await run({ command: "trap '' TERM; echo ready; sleep 30", background: true });
  await waitFor(() => (readLog(logPathOf(reply)).includes("ready") ? true : undefined));
  const stopping = assert.rejects(stop(idOf(reply)), /pi is shutting down/);
  await emit("session_shutdown");
  await stopping;
  assert.equal(sent.length, 0);
  assert.equal(branch.filter((entry) => entry.data.state === "ended").length, 0);
});

test("a result still held at shutdown is reported as interrupted on the next start", async () => {
  const first = await setup();
  first.agent.idle = false;
  const reply = await first.run({ command: "echo done", background: true });
  await waitFor(() => (readLog(logPathOf(reply)).includes("done") ? true : undefined));
  await sleep(100);
  assert.equal(first.sent.length, 0);
  assert.equal(first.branch.length, 1);
  await first.emit("session_shutdown");

  const second = await setup({}, { branch: first.branch });
  assert.equal(second.sent.length, 1);
  assert.match(second.sent[0].message.content, /^Background commands interrupted/);
  assert.equal(second.branch.filter((entry) => entry.data.state === "ended").length, 1);
});

test("a compaction or /tree while busy posts the running list once, on the next tick, without a new turn", async () => {
  const { run, stop, sent, emit, agent } = await setup();
  const reply = await run({ command: "echo ready; sleep 30", background: true });
  for (const event of ["session_compact", "session_tree"]) {
    const count = sent.length;
    agent.idle = false;
    await emit(event);
    assert.equal(sent.length, count, event);
    agent.idle = true;
    await sleep(10);
    assert.equal(sent.length, count + 1, event);
    assert.equal(sent.at(-1)!.options.triggerTurn, false, event);
  }
  await stop(idOf(reply));
});
