/**
 * Background subagents, modelled on OpenCode V2's `subagent` tool (packages/core/src/tool/plugin/subagent.ts).
 *
 * Each child is a `pi --mode rpc` process with its own saved session. Layers, top to bottom:
 *   index.ts (wiring) → tools.ts, ui.ts, result.ts → manager.ts (all children) → subagent.ts (one child) → rpc.ts (one process)
 * Lower layers report upward through the callbacks wired here.
 */
import * as path from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { registerInbox } from "../../src/inbox.ts";
import { isSubagentChild } from "../../src/subagent-child.ts";
import { loadAgents } from "./agents.ts";
import { loadChildEnv, loadFloatSize } from "./config.ts";
import { type JobEntry, Subagents } from "./manager.ts";
import { deliverInterrupted, postResult } from "./result.ts";
import { RpcProcess } from "./rpc.ts";
import { registerTools } from "./tools.ts";
import { registerResultRenderer, registerSubagentsCommand, SessionUi } from "./ui.ts";

const JOB_TYPE = "subagent-job";

export default function (pi: ExtensionAPI) {
  if (isSubagentChild()) return;

  const agents = loadAgents();
  const childEnv = loadChildEnv();
  // One folder for all children (their IDs are UUIDs).
  const sessionDir = path.join(getAgentDir(), "sessions", "subagents");
  // Pi creates a new extension instance per session, so these are set once in session_start.
  let subagents: Subagents | undefined;
  let ui: SessionUi | undefined;
  const current = () => {
    if (!subagents) throw new Error("Subagents are not available before the session starts.");
    return subagents;
  };

  const inbox = registerInbox(pi, "Subagent result");
  registerTools(pi, agents, current);
  registerResultRenderer(pi);
  registerSubagentsCommand(pi, current, sessionDir, loadFloatSize());

  pi.on("session_start", async (_event, ctx) => {
    // `manager` is read only when a callback fires, after it is assigned below.
    const sessionUi: SessionUi = new SessionUi(ctx, () => manager.list());
    const manager: Subagents = new Subagents({
      ownerSessionId: ctx.sessionManager.getSessionId(),
      cwd: ctx.cwd,
      sessionDir,
      agents,
      childEnv,
      saveJob: (entry) => pi.appendEntry(JOB_TYPE, entry),
      onFinish: (subagent, result, delivered) =>
        inbox.deliver((triggerTurn) => {
          postResult(pi, sessionDir, subagent, result, triggerTurn);
          delivered();
        }),
      onChange: () => sessionUi.renderRunningList(),
      onUiRequest: (subagent, request, signal) => sessionUi.dialogs.forward(subagent.description, request, signal),
      startProcess: (options) => new RpcProcess(options),
    });
    subagents = manager;
    ui = sessionUi;

    const saved = ctx.sessionManager
      .getBranch()
      .flatMap((entry) => (entry.type === "custom" && entry.customType === JOB_TYPE ? [entry.data as JobEntry] : []));
    const interrupted = manager.restore(saved);
    if (interrupted.length > 0) deliverInterrupted(pi, interrupted);
  });

  pi.on("session_shutdown", async () => {
    subagents?.shutdown();
    ui?.dispose();
    subagents = undefined;
    ui = undefined;
  });
}
