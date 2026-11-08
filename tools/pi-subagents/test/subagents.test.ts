import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { Agent } from "../agents.ts";
import { type JobEntry, Subagents } from "../manager.ts";
import type { RpcCommand, RpcConnection, RpcEvent, RpcProcessOptions, RpcResponse } from "../rpc.ts";
import type { RunResult } from "../subagent.ts";

const general: Agent = { name: "general", description: "General agent", systemPrompt: "Do the task." };
const haiku = { provider: "anthropic", id: "claude-haiku-5-5" };
const sonnet = { provider: "anthropic", id: "claude-sonnet-5" };

type Responder = (command: RpcCommand, fake: FakeProcess) => Partial<RpcResponse>;

class FakeProcess implements RpcConnection {
  readonly options: RpcProcessOptions;
  readonly sent: RpcCommand[] = [];
  respond: Responder = () => ({});
  closed = false;

  constructor(options: RpcProcessOptions) {
    this.options = options;
  }

  /** Like pi, an accepted prompt starts a run, unless a command consumed it or it is a steer queued into the current run. */
  send(command: RpcCommand): Promise<RpcResponse> {
    this.sent.push(command);
    const response: RpcResponse = { type: "response", command: command.type, success: true, ...this.respond(command, this) };
    const startsRun = response.success && response.data?.disposition !== "handled" && !command.streamingBehavior;
    if (command.type === "prompt" && startsRun) this.emit({ type: "agent_start" });
    return Promise.resolve(response);
  }

  close() {
    this.closed = true;
  }

  exit(code: number, stderrTail = "") {
    this.options.onExit({ code, signal: null, stderrTail });
  }

  emit(event: RpcEvent) {
    this.options.onEvent(event);
  }

  reply(text: string) {
    this.emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text }], usage: { input: 10, output: 5, cost: { total: 0.01 } } },
    });
  }

  settle(aborted = false) {
    this.emit({ type: "agent_settled", aborted });
  }

  types() {
    return this.sent.map((command) => command.type);
  }

  flag(name: string) {
    const args = this.options.args;
    return args[args.indexOf(name) + 1];
  }
}

function setup(firstResponder?: Responder, ownerSessionId = "parent-1") {
  const processes: FakeProcess[] = [];
  const jobs: JobEntry[] = [];
  const finished: RunResult[] = [];
  let saveError: Error | undefined;
  let held: Array<() => void> | undefined;
  const uiSignals: AbortSignal[] = [];
  const manager = new Subagents({
    ownerSessionId,
    cwd: "/tmp",
    sessionDir: "/tmp/sessions",
    agents: [general],
    childEnv: (model) => ({ PI_CACHE_RETENTION: `short:${model.id}` }),
    saveJob: (entry) => {
      if (saveError) throw saveError;
      jobs.push(entry);
    },
    onFinish: (_subagent, result, delivered) => {
      finished.push(result);
      if (held) held.push(delivered);
      else delivered();
    },
    onChange: () => {},
    onUiRequest: async (_subagent, _request, signal) => {
      uiSignals.push(signal);
      return { cancelled: true };
    },
    startProcess: (processOptions) => {
      const fake = new FakeProcess(processOptions);
      if (firstResponder && processes.length === 0) fake.respond = firstResponder;
      processes.push(fake);
      return fake;
    },
  });
  const start = (prompt = "find the bug") => manager.start({ agent: general, description: "find bug", prompt, model: haiku });
  /** Makes later saves throw, as appendEntry would on a full disk. */
  const failSaves = () => {
    saveError = new Error("disk full");
  };
  /** Leaves results undelivered, as when the parent is busy; returns the pending `delivered` callbacks. */
  const holdDeliveries = () => {
    const pending: Array<() => void> = [];
    held = pending;
    return pending;
  };
  return { manager, processes, jobs, finished, start, failSaves, holdDeliveries, uiSignals };
}

test("start spawns a child with its own session and sends the task", async () => {
  const { processes, jobs, start } = setup();
  const subagent = await start();

  assert.equal(processes.length, 1);
  assert.equal(processes[0].flag("--session-id"), subagent.id);
  assert.equal(processes[0].flag("--model"), "anthropic/claude-haiku-5-5");
  assert.deepEqual(processes[0].options.env, { PI_CACHE_RETENTION: "short:claude-haiku-5-5", PI_SUBAGENT_CHILD: "1" });
  assert.equal(processes[0].sent[0].type, "prompt");
  assert.match(String(processes[0].sent[0].message), /^You are a subagent spawned by another session.\nfind the bug$/);
  assert.equal(subagent.state, "running");
  assert.deepEqual(jobs.map((job) => job.status), ["launched"]);
});

test("a settled run reports its last text, usage, and duration, then the child is idle", async () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  const { processes, jobs, finished, start } = setup();
  const subagent = await start();
  processes[0].reply("first draft");
  processes[0].reply("final answer");
  mock.timers.tick(1_500);
  processes[0].settle();
  mock.timers.reset();

  assert.deepEqual(finished, [
    { state: "completed", text: "final answer", usage: { turns: 2, input: 20, output: 10, cost: 0.02 }, durationMs: 1_500 },
  ]);
  assert.equal(subagent.state, "idle");
  assert.deepEqual(jobs.map((job) => job.status), ["launched", "completed"]);
});

test("a message to a running child steers it", async () => {
  const { manager, processes, start } = setup();
  const subagent = await start();

  assert.equal(await manager.message(subagent.id, "look in auth.ts instead", haiku), "steered");
  assert.deepEqual(processes[0].sent[1], { type: "prompt", message: "look in auth.ts instead", streamingBehavior: "steer" });
  assert.equal(subagent.state, "running");
});

test("a run the child starts after settling, such as a late steer, is tracked and reported", async () => {
  const { manager, processes, jobs, finished, start } = setup();
  const subagent = await start();
  await manager.message(subagent.id, "also check tests", haiku);
  processes[0].reply("first result");
  processes[0].settle();
  assert.equal(subagent.state, "idle");

  processes[0].emit({ type: "agent_start" });
  assert.equal(subagent.state, "running");
  assert.equal(jobs.at(-1)?.status, "launched", "a quit during this run is reported as interrupted");
  processes[0].reply("result with tests");
  processes[0].settle();

  assert.deepEqual(finished.map((result) => result.text), ["first result", "result with tests"]);
});

test("a message to an idle child starts a new run in the same process", async () => {
  const { manager, processes, start } = setup();
  const subagent = await start();
  processes[0].settle();

  assert.equal(await manager.message(subagent.id, "now fix it", haiku), "prompted");
  assert.equal(processes.length, 1);
  assert.deepEqual(processes[0].types(), ["prompt", "prompt"]);
  assert.equal(subagent.state, "running");
});

test("a different model on a follow-up restarts the idle child with that model and its env", async () => {
  const { manager, processes, start } = setup();
  const subagent = await start();
  processes[0].settle();

  await manager.message(subagent.id, "now fix it", { ...sonnet, thinking: "high" });
  assert.equal(processes[0].closed, true);
  assert.equal(processes[1].flag("--session-id"), subagent.id);
  assert.equal(processes[1].flag("--model"), "anthropic/claude-sonnet-5");
  assert.equal(processes[1].flag("--thinking"), "high");
  assert.equal(processes[1].options.env.PI_CACHE_RETENTION, "short:claude-sonnet-5");
  assert.deepEqual(processes[1].types(), ["prompt"]);
  assert.deepEqual(subagent.model, { ...sonnet, thinking: "high" });
});

test("a command that starts its own run is tracked like any other run", async () => {
  const { manager, processes, jobs, finished, start } = setup((command, fake) => {
    if (command.type !== "prompt" || fake.sent.length === 1) return {};
    fake.emit({ type: "agent_start" });
    return { data: { disposition: "handled" } };
  });
  const subagent = await start();
  processes[0].settle();

  assert.equal(await manager.message(subagent.id, "/review", haiku), "prompted");
  assert.equal(subagent.state, "running");
  processes[0].settle();
  assert.equal(finished.length, 2);
  assert.deepEqual(jobs.map((job) => job.status), ["launched", "completed", "launched", "completed"]);
});

test("a prompt the child handles as a command fails instead of waiting for a run", async () => {
  const { manager, processes, start } = setup((command, fake) =>
    command.type === "prompt" && fake.sent.length > 1 ? { data: { disposition: "handled" } } : {},
  );
  const subagent = await start();
  processes[0].settle();

  await assert.rejects(manager.message(subagent.id, "/compact", haiku), /handled this message as a command/);
  assert.equal(subagent.state, "idle");
});

test("an idle child stops after 60 s and restarts from its session on the next message", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { manager, processes, finished, start } = setup();
  const subagent = await start();
  processes[0].settle();
  mock.timers.tick(60_000);
  mock.timers.reset();

  assert.equal(processes[0].closed, true);
  assert.equal(subagent.state, "stopped");

  // Before the old process has exited: the follow-up starts a new one, and the old exit is ignored.
  await manager.message(subagent.id, "continue", sonnet);
  processes[0].exit(0);
  assert.equal(finished.length, 1, "stopping an idle child is not a result");
  assert.equal(subagent.state, "running");
  assert.equal(processes.length, 2);
  assert.equal(processes[1].flag("--session-id"), subagent.id);
  assert.equal(processes[1].flag("--model"), "anthropic/claude-sonnet-5");
  assert.deepEqual(processes[1].types(), ["prompt"]);
});

test("a crash while running reports an error with the end of stderr", async () => {
  const { processes, jobs, finished, start } = setup();
  const subagent = await start();
  processes[0].exit(1, "Error: provider overloaded");

  assert.equal(finished[0].state, "error");
  assert.match(finished[0].text, /exited \(1\)[\s\S]*provider overloaded/);
  assert.equal(subagent.state, "stopped");
  assert.deepEqual(jobs.map((job) => job.status), ["launched", "error"]);
});

test("a child that exits while starting reports one error and no launch entry", async () => {
  // Like RpcProcess: the exit is reported, then the pending prompt resolves as failed.
  const { finished, jobs, start } = setup((_command, fake) => {
    fake.exit(1, "Error: no API key");
    return { success: false, error: "process exited (1)" };
  });
  const subagent = await start();

  assert.deepEqual(finished.map((result) => result.state), ["error"]);
  assert.match(finished[0].text, /no API key/);
  assert.deepEqual(jobs.map((job) => job.status), ["error"]);
  assert.equal(subagent.state, "stopped");
});

test("the old process exiting after a model switch does not end the new run", async () => {
  const { manager, processes, finished, start } = setup();
  const subagent = await start();
  processes[0].settle();

  await manager.message(subagent.id, "now fix it", sonnet);
  processes[0].exit(1, "Error: crashed");
  assert.deepEqual(finished.map((result) => result.state), ["completed"]);
  assert.equal(subagent.state, "running");
});

test("a child whose first prompt is rejected is dropped", async () => {
  const { manager, processes, start } = setup(() => ({ success: false, error: "bad input" }));
  await assert.rejects(start(), /rejected the prompt: bad input/);

  assert.deepEqual(manager.list(), []);
  assert.equal(processes[0].closed, true);
});

test("abort clears queued messages first and the run is reported as cancelled", async () => {
  const { manager, processes, finished, start } = setup();
  const subagent = await start();
  await manager.abort(subagent.id);
  processes[0].settle(true);

  assert.deepEqual(processes[0].types(), ["prompt", "clear_queue", "abort"]);
  assert.equal(finished[0].state, "cancelled");
});

test("an error stop reason makes the run an error", async () => {
  const { processes, finished, start } = setup();
  await start();
  processes[0].emit({
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "error", errorMessage: "429 rate limited" },
  });
  processes[0].settle();

  assert.deepEqual(finished.map(({ state, text }) => ({ state, text })), [{ state: "error", text: "429 rate limited" }]);
});

test("a fifth running child is refused, and a finished child frees a slot", async () => {
  const { processes, start } = setup();
  for (let i = 0; i < 4; i++) await start();
  await assert.rejects(start(), /4 subagents are already running/);
  processes[0].settle();
  await start();
});

test("a sessionID that is not a child of this session is rejected", async () => {
  const { manager } = setup();
  await assert.rejects(manager.message("someone-else", "hi", haiku), /not a subagent of this session/);
});

test("restore reports children left running as interrupted and keeps them usable", async () => {
  const { manager, processes, jobs } = setup();
  const job = (id: string, status: JobEntry["status"]): JobEntry => ({
    id,
    ownerSessionId: "parent-1",
    agent: "general",
    description: id,
    model: haiku,
    status,
  });
  const interrupted = manager.restore([job("a", "launched"), job("a", "completed"), job("b", "launched")]);

  assert.deepEqual(interrupted.map((entry) => entry.id), ["b"]);
  assert.deepEqual(jobs, [job("b", "cancelled")]);
  assert.deepEqual(manager.list().map((subagent) => [subagent.id, subagent.state]), [["a", "stopped"], ["b", "stopped"]]);

  assert.equal(await manager.message("b", "continue", haiku), "prompted");
  assert.equal(processes[0].flag("--session-id"), "b");
});

test("the original session restores its saved children and a fork restores none", async () => {
  const original = setup(undefined, "original");
  const subagent = await original.start();
  const saved = [...original.jobs];

  const resumed = setup(undefined, "original");
  assert.deepEqual(resumed.manager.restore(saved).map((job) => job.id), [subagent.id]);
  assert.deepEqual(resumed.manager.list().map((child) => child.id), [subagent.id]);

  const fork = setup(undefined, "fork");
  assert.deepEqual(fork.manager.restore(saved), []);
  assert.deepEqual(fork.manager.list(), []);
  assert.deepEqual(fork.jobs, []);
  await assert.rejects(fork.manager.message(subagent.id, "continue", haiku), /not a subagent of this session/);
});

test("a rejected prompt leaves a child running if it started a run of its own meanwhile", async () => {
  const { manager, processes, start } = setup((command, fake) => {
    if (command.type !== "prompt" || fake.sent.length === 1) return {};
    fake.emit({ type: "agent_start" });
    return { success: false, error: "Agent is already processing" };
  });
  const subagent = await start();
  processes[0].settle();

  await assert.rejects(manager.message(subagent.id, "now fix it", haiku), /already processing/);
  assert.equal(subagent.state, "running");
});

test("a run the child starts on its own is marked running even if saving its entry fails", async () => {
  const { processes, start, failSaves } = setup();
  const subagent = await start();
  processes[0].settle();
  failSaves();

  assert.throws(() => processes[0].emit({ type: "agent_start" }), /disk full/);
  assert.equal(subagent.state, "running");
});

test("a finished run is delivered even if saving its entry fails", async () => {
  const { processes, finished, start, failSaves } = setup();
  await start();
  processes[0].reply("found it");
  failSaves();

  assert.throws(() => processes[0].settle(), /disk full/);
  assert.equal(finished[0].text, "found it");
});

test("a finished run is saved as completed only once it is delivered", async () => {
  const { processes, jobs, start, holdDeliveries } = setup();
  await start();
  const pending = holdDeliveries();
  processes[0].settle();
  assert.deepEqual(jobs.map((job) => job.status), ["launched"]);

  pending[0]();
  assert.deepEqual(jobs.map((job) => job.status), ["launched", "completed"]);
});

test("a held result delivered after the child started a new run keeps that run's launch entry last", async () => {
  const { manager, processes, jobs, start, holdDeliveries } = setup();
  const subagent = await start();
  const pending = holdDeliveries();
  processes[0].settle();
  await manager.message(subagent.id, "now fix it", haiku);

  pending[0]();
  assert.deepEqual(jobs.map((job) => job.status), ["launched", "launched"]);
});

test("a dialog request carries the signal of the process that asked", async () => {
  const { processes, start, uiSignals } = setup();
  await start();
  const signal = new AbortController().signal;
  await processes[0].options.onUiRequest({ id: "1", method: "confirm", title: "Allow?" }, signal);
  assert.equal(uiSignals[0], signal);
});

test("a run the child starts on its own cancels the idle stop", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { processes, start } = setup();
  const subagent = await start();
  processes[0].settle();
  processes[0].emit({ type: "agent_start" });
  mock.timers.tick(60_000);
  mock.timers.reset();

  assert.equal(processes[0].closed, false);
  assert.equal(subagent.state, "running");
});

test("after shutdown, the child's late events and exit report nothing", async () => {
  const { manager, processes, finished, jobs, start } = setup();
  await start();
  manager.shutdown();
  processes[0].reply("done after all");
  processes[0].settle();
  processes[0].exit(0);

  assert.equal(processes[0].closed, true);
  assert.equal(finished.length, 0);
  assert.deepEqual(jobs.map((job) => job.status), ["launched"], "the launched entry marks it interrupted for next start");
});
