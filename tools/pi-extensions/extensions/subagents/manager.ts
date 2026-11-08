/**
 * All children of one parent session: the running limit, which IDs belong to this session,
 * routing a message to steer or prompt, and the saved job records.
 */
import { randomUUID } from "node:crypto";
import type { Agent } from "./agents.ts";
import type { ChildEnv } from "./config.ts";
import type { RpcConnection, RpcProcessOptions, UiAnswer, UiRequest } from "./rpc.ts";
import { type ModelChoice, type RunResult, type RunState, Subagent } from "./subagent.ts";

/** Saved in the parent session on every launch and finish. `launched` with no later status means interrupted. */
export type JobEntry = {
  id: string;
  /** The parent session that created the child. A fork copies the entries but has a new ID, so it starts with no children. */
  ownerSessionId: string;
  agent: string;
  description: string;
  model: ModelChoice;
  status: "launched" | RunState;
};

export type SubagentsOptions = {
  ownerSessionId: string;
  cwd: string;
  sessionDir: string;
  agents: Agent[];
  childEnv: ChildEnv;
  saveJob: (entry: JobEntry) => void;
  /** Call `delivered` once the result is posted to the parent; only then is the job saved as finished. */
  onFinish: (subagent: Subagent, result: RunResult, delivered: () => void) => void;
  onChange: () => void;
  onUiRequest: (subagent: Subagent, request: UiRequest, signal: AbortSignal) => Promise<UiAnswer>;
  startProcess: (options: RpcProcessOptions) => RpcConnection;
};

const MAX_RUNNING = 4;
// Same opening OpenCode gives a new child (packages/core/src/tool/plugin/subagent.ts).
const FIRST_PROMPT_PREFIX = "You are a subagent spawned by another session.\n";

export class Subagents {
  private readonly options: SubagentsOptions;
  private readonly subagents = new Map<string, Subagent>();

  constructor(options: SubagentsOptions) {
    this.options = options;
  }

  /** Rebuilds the children from saved entries. Returns the ones that were running when pi stopped. */
  restore(entries: JobEntry[]): JobEntry[] {
    const own = entries.filter((entry) => entry.ownerSessionId === this.options.ownerSessionId);
    const latest = new Map(own.map((entry) => [entry.id, entry]));
    const interrupted: JobEntry[] = [];
    for (const job of latest.values()) {
      const agent = this.options.agents.find((candidate) => candidate.name === job.agent);
      if (!agent) continue;
      this.add(job.id, agent, job.description, job.model);
      if (job.status !== "launched") continue;
      interrupted.push(job);
      this.options.saveJob({ ...job, status: "cancelled" });
    }
    return interrupted;
  }

  async start(input: { agent: Agent; description: string; prompt: string; model: ModelChoice }) {
    this.checkLimit();
    const subagent = this.add(randomUUID(), input.agent, input.description, input.model);
    // A child whose first prompt fails was never handed to the model, so drop it.
    await subagent.prompt(FIRST_PROMPT_PREFIX + input.prompt).catch((error: unknown) => {
      this.subagents.delete(subagent.id);
      subagent.stop();
      throw error;
    });
    return subagent;
  }

  async message(id: string, text: string, model: ModelChoice): Promise<"steered" | "prompted"> {
    const subagent = this.get(id);
    if (subagent.state === "running") {
      await subagent.steer(text);
      return "steered";
    }
    this.checkLimit();
    await subagent.prompt(text, model);
    return "prompted";
  }

  abort(id: string) {
    return this.get(id).abort();
  }

  list() {
    return [...this.subagents.values()];
  }

  /** Running children keep their `launched` entry, so the next session start reports them as interrupted. */
  shutdown() {
    for (const subagent of this.subagents.values()) subagent.stop();
  }

  private add(id: string, agent: Agent, description: string, model: ModelChoice) {
    const { cwd, sessionDir, childEnv, startProcess, onChange, onUiRequest } = this.options;
    const subagent = new Subagent({
      id,
      agent,
      description,
      model,
      cwd,
      sessionDir,
      childEnv,
      startProcess,
      onChange,
      onUiRequest,
      // Saved when the child reports a run, not when a prompt is sent: a rejected or command-handled
      // prompt leaves no entry, and runs the child starts on its own are recorded too.
      onRunStart: (started) => this.save(started, "launched"),
      // Saved once delivered: a result not yet posted when pi stops leaves `launched`, which the next start
      // reports as interrupted. A held result delivered after the child started a new run must not overwrite
      // that run's `launched` entry.
      onFinish: (finished, result) =>
        this.options.onFinish(finished, result, () => {
          if (finished.state !== "running") this.save(finished, result.state);
        }),
    });
    this.subagents.set(id, subagent);
    return subagent;
  }

  private get(id: string) {
    const subagent = this.subagents.get(id);
    if (!subagent) throw new Error(`Session ${id} is not a subagent of this session.`);
    return subagent;
  }

  private checkLimit() {
    const running = this.list().filter((subagent) => subagent.state === "running").length;
    if (running >= MAX_RUNNING) throw new Error(`${MAX_RUNNING} subagents are already running. Wait for one to finish.`);
  }

  private save(subagent: Subagent, status: JobEntry["status"]) {
    this.options.saveJob({
      id: subagent.id,
      ownerSessionId: this.options.ownerSessionId,
      agent: subagent.agent.name,
      description: subagent.description,
      model: subagent.model,
      status,
    });
  }
}
