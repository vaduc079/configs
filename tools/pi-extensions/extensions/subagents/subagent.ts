/**
 * One child session: its process, its state (stopped → running → idle), and the run in progress.
 * Reports each finished run through onFinish. Knows nothing about other children or the parent session.
 */
import { SUBAGENT_CHILD_ENV } from "../../src/subagent-child.ts";
import type { Agent } from "./agents.ts";
import type { ChildEnv } from "./config.ts";
import type { RpcConnection, RpcEvent, RpcProcessOptions, UiAnswer, UiRequest } from "./rpc.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Thinking = (typeof THINKING_LEVELS)[number];
export type ModelChoice = { provider: string; id: string; thinking?: Thinking };
export type Usage = { turns: number; input: number; output: number; cost: number };
export type RunState = "completed" | "error" | "cancelled";
export type RunResult = { state: RunState; text: string; usage: Usage; durationMs: number };
export type SubagentState = "stopped" | "idle" | "running";
/** The last finished run, for `/subagents`. No duration when restored from an entry saved without one, or interrupted. */
export type LastRun = { state: RunState; durationMs?: number };
/** The model and thinking level the child process reports it runs with; pi fills in a default level and clamps it to the model. */
type Effective = { model: string; thinking?: string };

export type SubagentOptions = {
  id: string;
  agent: Agent;
  description: string;
  model: ModelChoice;
  cwd: string;
  sessionDir: string;
  /** Extra environment for the child process, by model. */
  childEnv: ChildEnv;
  startProcess(options: RpcProcessOptions): RpcConnection;
  /** Called on every run the child starts, including ones prompt() did not start. */
  onRunStart(subagent: Subagent): void;
  onFinish(subagent: Subagent, result: RunResult): void;
  onChange(): void;
  /** `signal` aborts when the process that asked stops, even if the child has since restarted. */
  onUiRequest(subagent: Subagent, request: UiRequest, signal: AbortSignal): Promise<UiAnswer>;
};

type AssistantMessage = {
  role: string;
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input?: number; output?: number; cost?: { total?: number } };
};

const IDLE_STOP_MS = 60_000;

export class Subagent {
  readonly id: string;
  readonly agent: Agent;
  readonly description: string;
  model: ModelChoice;
  state: SubagentState = "stopped";
  runStartedAt = 0;
  lastRun: LastRun | undefined;
  /** Read from the current process; undefined until it answers. */
  effective: Effective | undefined;

  private readonly options: SubagentOptions;
  /**
   * The current process. stop() detaches it at once, so a follow-up can start a new process while the old
   * one shuts down, and the old one's late events and exit are ignored (the parent session may be gone).
   */
  private rpc: RpcConnection | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  /** Whether the child started a run since the last prompt() call. */
  private runStarted = false;
  private lastText = "";
  private error: string | undefined;
  private usage = emptyUsage();

  constructor(options: SubagentOptions) {
    this.options = options;
    this.id = options.id;
    this.agent = options.agent;
    this.description = options.description;
    this.model = options.model;
  }

  /** Starts a run. Restarts the process from the saved session if it is stopped. */
  async prompt(text: string, model = this.model) {
    if (this.state === "running") throw new Error(`Subagent ${this.id} is running; steer it instead.`);
    // Running before any await, so a parallel message steers instead of sending a second prompt,
    // and events that arrive before the response find the right state.
    this.state = "running";
    this.runStartedAt = Date.now();
    this.runStarted = false;
    clearTimeout(this.idleTimer);

    let rpc = this.rpc;
    if (rpc && !sameModel(model, this.model)) {
      // The child's env depends on its model (config.ts), so a new model needs a new process.
      // Replacing this.rpc below makes the old process's late events and exit ignored.
      rpc.close();
      rpc = undefined;
    }
    if (!rpc) {
      this.model = model;
      this.effective = undefined;
      rpc = this.rpc = this.startProcess();
      void this.readEffective(rpc);
    }

    const response = await rpc.send({ type: "prompt", message: text });
    if (this.rpc !== rpc) return;
    if (!response.success) this.failPrompt(`Subagent rejected the prompt: ${response.error}`);
    // A prompt an extension command consumed is answered "handled" after the command returns (rpc.md).
    // If the command started no run, no agent_settled will come.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- child events handled during `await rpc.send` can set runStarted; TS keeps the narrowing from the reset above
    if (response.data?.disposition === "handled" && !this.runStarted)
      this.failPrompt("The subagent handled this message as a command, so no run started.");
    this.options.onChange();
  }

  /**
   * Delivered after the child's current step, inside the same run. Sent as a prompt rather than `steer`:
   * if the child settled just before it arrived, a `steer` would only sit in its queue, while this starts a new run.
   */
  async steer(text: string) {
    if (this.state !== "running" || !this.rpc) throw new Error(`Subagent ${this.id} is not running.`);
    const response = await this.rpc.send({ type: "prompt", message: text, streamingBehavior: "steer" });
    if (!response.success) throw new Error(`Steer failed: ${response.error}`);
  }

  async abort() {
    const rpc = this.rpc;
    if (this.state !== "running" || !rpc) throw new Error(`Subagent ${this.id} is not running.`);
    // rpc-commands.md: abort continues queued messages, so a queued steer would start a new run.
    await rpc.send({ type: "clear_queue" });
    await rpc.send({ type: "abort" });
  }

  stop() {
    clearTimeout(this.idleTimer);
    const rpc = this.rpc;
    if (!rpc) return;
    this.rpc = undefined;
    this.state = "stopped";
    rpc.close();
    this.options.onChange();
  }

  private startProcess() {
    const { agent, model } = this;
    const args = [
      "--session-id",
      this.id,
      "--session-dir",
      this.options.sessionDir,
      "--name",
      `subagent: ${this.description}`,
      "--model",
      `${model.provider}/${model.id}`,
      ...(model.thinking ? ["--thinking", model.thinking] : []),
      ...(agent.tools ? ["--tools", agent.tools] : []),
      ...(agent.systemPrompt ? ["--append-system-prompt", agent.systemPrompt] : []),
    ];
    const rpc: RpcConnection = this.options.startProcess({
      args,
      cwd: this.options.cwd,
      // Marks the process as a child: this extension turns itself off (no nested subagents), and
      // pi-permissions blocks `ask` rules instead of prompting.
      env: { ...this.options.childEnv(model), ...SUBAGENT_CHILD_ENV },
      onEvent: (event) => {
        if (this.rpc === rpc) this.handleEvent(event);
      },
      onUiRequest: (request, signal) => this.options.onUiRequest(this, request, signal),
      onExit: ({ code, signal, stderrTail }) => {
        if (this.rpc !== rpc) return;
        const crashed = this.state === "running";
        this.rpc = undefined;
        this.state = "stopped";
        if (crashed) {
          this.error = `Subagent process exited (${code ?? signal}).\n${stderrTail}`;
          this.finishRun("error");
          return;
        }
        this.options.onChange();
      },
    });
    return rpc;
  }

  private async readEffective(rpc: RpcConnection) {
    const response = await rpc.send({ type: "get_state" });
    if (this.rpc !== rpc || !response.success) return;
    // Checked, not cast: this runs outside RpcProcess's guard, so a throw here (or in the redraw it
    // triggers) would be an unhandled rejection that exits the parent pi.
    const data = response.data as { model?: { name?: unknown }; thinkingLevel?: unknown } | undefined;
    const name = data?.model?.name;
    const thinking = data?.thinkingLevel;
    this.effective = {
      model: typeof name === "string" ? name : this.model.id,
      thinking: typeof thinking === "string" ? thinking : undefined,
    };
    this.options.onChange();
  }

  private failPrompt(message: string): never {
    // The child may have started a run of its own meanwhile (a late steer); it is still running then.
    if (!this.runStarted) this.becomeIdle();
    this.options.onChange();
    throw new Error(message);
  }

  private handleEvent(event: RpcEvent) {
    switch (event.type) {
      case "agent_start":
        this.runStarted = true;
        if (this.state !== "running") {
          // A run prompt() did not start: a steer that reached the child just after it settled, or an extension command's own run.
          this.state = "running";
          this.runStartedAt = Date.now();
          clearTimeout(this.idleTimer);
          this.options.onChange();
        }
        // After the state change, so a failed save cannot leave a running child marked idle.
        this.options.onRunStart(this);
        return;
      case "message_end": {
        const message = event.message as AssistantMessage;
        if (message.role !== "assistant") return;
        this.usage.turns++;
        this.usage.input += message.usage?.input ?? 0;
        this.usage.output += message.usage?.output ?? 0;
        this.usage.cost += message.usage?.cost?.total ?? 0;
        const text = message.content
          .filter((part) => part.type === "text" && part.text)
          .map((part) => part.text)
          .join("\n\n");
        if (text) this.lastText = text;
        this.error = message.stopReason === "error" ? message.errorMessage : undefined;
        return;
      }
      case "agent_settled":
        this.finishRun(event.aborted ? "cancelled" : this.error ? "error" : "completed");
    }
  }

  private finishRun(state: RunState) {
    const text =
      state === "completed"
        ? this.lastText || "Subagent completed without a text response."
        : state === "error"
          ? this.error || "Subagent failed."
          : "Subagent was aborted.";
    const result = { state, text, usage: this.usage, durationMs: Date.now() - this.runStartedAt };
    this.lastText = "";
    this.error = undefined;
    this.usage = emptyUsage();
    this.lastRun = { state, durationMs: result.durationMs };
    if (this.rpc) this.becomeIdle();
    this.options.onFinish(this, result);
    this.options.onChange();
  }

  private becomeIdle() {
    this.state = "idle";
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_STOP_MS);
    this.idleTimer.unref();
  }
}

function emptyUsage(): Usage {
  return { turns: 0, input: 0, output: 0, cost: 0 };
}

function sameModel(a: ModelChoice, b: ModelChoice) {
  return a.provider === b.provider && a.id === b.id && a.thinking === b.thinking;
}
