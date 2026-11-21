/**
 * pi's `bash` tool with `background: true`, modelled on OpenCode's shell tool (packages/core/src/tool/plugin/shell.ts).
 * A background call returns at once, its output streams to a log file, and when the command exits the agent gets one
 * message, steered into the current run or starting a turn if the agent is idle. Foreground calls run pi's built-in bash unchanged.
 * `background_stop` stops one from the agent; `/background` (ui.ts) lists running commands, shows one's full command
 * and output, and stops one.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyToClipboard,
  createBashToolDefinition,
  createLocalBashOperations,
  type ExtensionAPI,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerInbox } from "../../src/inbox.ts";
import { RunningList } from "../../src/running-list.ts";
import { type JobEnd, runJob, stopJob } from "./job.ts";
import { interruptedMessage, registerNoticeRenderer, runningMessage } from "./notice.ts";
import { registerResultRenderer, type ResultDetails, resultMessage, resultText } from "./result.ts";
import { BackgroundList, type BackgroundJob } from "./ui.ts";

const LOG_DIR = path.join(os.tmpdir(), "pi-bash-bg");

const BACKGROUND_DESCRIPTION =
  "Run the command in the background. The call returns at once with the command's id; when the command exits you get one message with its exit status and last lines of output. Use it for long builds, test runs and servers. Background commands have no timeout unless you set one; stop one with background_stop and its id. Do not end the command with '&': the shell would exit at once and the job would report success without output.";

const NOTE =
  "When it exits you get a message with its status and last lines of output. Do not poll for it: sleeping and re-reading the log is polling. Read the log only when it helps work you can do now. Continue with other work, or end your turn if nothing else is left.";

// What a codemode script gets from a background call, instead of the foreground result it cannot have yet.
const BackgroundOutput = Type.Object({
  background_id: Type.String({ description: "Pass to background_stop to stop the command" }),
  log_path: Type.String({ description: "Output so far; the exit message has the last lines" }),
  note: Type.String(),
});

/** Saved when a job starts and once its result has reached the agent; a job left `started` was cut off by pi stopping. */
const ENTRY_TYPE = "bash-background-job";
type JobEntry =
  | { id: string; ownerSessionId: string; state: "started"; command: string; logPath: string }
  | { id: string; ownerSessionId: string; state: "ended" };

type StoppedBy = "user" | "agent";

type Job = BackgroundJob & {
  pidPath: string;
  ownerSessionId: string;
  abort: AbortController;
  /** Resolves with the result once the command exits; undefined if session shutdown removed the job first. */
  ended: Promise<ResultDetails | undefined>;
  /** The first stop wins: the result says who stopped the job, whatever its exit code. */
  stoppedBy?: StoppedBy;
  /** The stop in progress; overlapping stops share it, including its failure. */
  stopping?: Promise<void>;
};

export default function (pi: ExtensionAPI) {
  const inbox = registerInbox(pi, "Background command result");
  const jobs = new Map<string, Job>();
  let runningList: RunningList | undefined;
  registerResultRenderer(pi);
  registerNoticeRenderer(pi);

  const saveEnded = (job: Job) => pi.appendEntry<JobEntry>(ENTRY_TYPE, { id: job.id, ownerSessionId: job.ownerSessionId, state: "ended" });

  const finish = (job: Job, end: JobEnd): ResultDetails | undefined => {
    // Session shutdown already removed it: the session it would post to is gone.
    if (!jobs.delete(job.id)) return undefined;
    const durationMs = Date.now() - job.startedAt;
    const status = job.stoppedBy ? `stopped by the ${job.stoppedBy}` : end.status;
    job.end = { status, durationMs };
    runningList?.render();
    const details = { ...end, status, id: job.id, command: job.command, logPath: job.logPath, durationMs };
    // The agent's stop returns the result as its tool result, so nothing is posted.
    if (job.stoppedBy === "agent") saveEnded(job);
    else inbox.deliver(resultMessage(details), { onPosted: () => saveEnded(job) });
    return details;
  };

  const stop = async (job: Job, by: StoppedBy) => {
    if (!job.stopping) {
      job.stoppedBy = by;
      job.stopping = stopJob(job.pidPath, job.ended, job.abort).catch((error: unknown) => {
        // Not stopped: let a retry signal again, and report a later natural exit as such.
        job.stoppedBy = undefined;
        job.stopping = undefined;
        throw error;
      });
    }
    await job.stopping;
    return job.ended;
  };

  const builtin = createBashToolDefinition(process.cwd());
  pi.registerTool({
    ...builtin,
    parameters: Type.Object({
      ...builtin.parameters.properties,
      background: Type.Optional(Type.Boolean({ description: BACKGROUND_DESCRIPTION })),
    }),
    // pi's bash always declares its output schema; the type is optional only because other tools may not.
    outputSchema: Type.Union([builtin.outputSchema!, BackgroundOutput]),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // The options pi builds its own bash tool with. pi normalizes the shell path (`~`, file:// URLs) in
      // SettingsManager.getShellPath, and does not export the normalizing function, so ask a SettingsManager.
      const settings = pi.getSettings();
      const shellPath = SettingsManager.inMemory({ shellPath: settings.shellPath }).getShellPath();
      const options = { shellPath, commandPrefix: settings.shellCommandPrefix };
      if (!params.background) return createBashToolDefinition(ctx.cwd, options).execute(toolCallId, params, signal, onUpdate, ctx);

      const id = randomUUID().slice(0, 8);
      const logPath = path.join(LOG_DIR, `${id}.log`);
      const pidPath = path.join(LOG_DIR, `${id}.pid`);
      const ownerSessionId = ctx.sessionManager.getSessionId();
      const { exec } = createLocalBashOperations({ shellPath });
      fs.mkdirSync(LOG_DIR, { recursive: true });

      // pi's bash tool resolves the command prefix, cwd and session environment, then calls `exec`. This `exec`
      // starts the job and returns at once, so the job runs exactly what a foreground call would. The job is
      // registered here, with its end, so a stop always has a job to wait for.
      const start = createBashToolDefinition(ctx.cwd, {
        ...options,
        operations: {
          exec: async (command, cwd, { env, timeout }) => {
            const abort = new AbortController();
            const run = runJob({ exec, command, cwd, env, timeout, signal: abort.signal, logPath, pidPath });
            const job: Job = {
              id,
              command: params.command,
              cwd: ctx.cwd,
              logPath,
              pidPath,
              ownerSessionId,
              startedAt: Date.now(),
              abort,
              ended: run.then((end) => finish(job, end)),
            };
            jobs.set(id, job);
            pi.appendEntry<JobEntry>(ENTRY_TYPE, { id, ownerSessionId, state: "started", command: params.command, logPath });
            return { exitCode: 0 };
          },
        },
      });
      await start.execute(toolCallId, params, undefined, undefined, ctx);
      runningList?.render();

      const structuredContent = { background_id: id, log_path: logPath, note: NOTE };
      const text = [
        `Running in the background (id ${id}).`,
        `Output log: ${logPath}`,
        `To stop it and every process it started, call background_stop with id ${id}.`,
        NOTE,
      ].join("\n");
      return { content: [{ type: "text", text }], structuredContent, details: undefined };
    },
  });

  pi.registerTool({
    name: "background_stop",
    label: "Background stop",
    description:
      "Stop a command started with bash background: true, and every process it started: SIGTERM, then SIGKILL when the shell exits or after up to 3 seconds. Returns how it ended and its last lines of output; no separate message follows.",
    parameters: Type.Object({
      id: Type.String({ description: "The id from the bash reply" }),
    }),
    async execute(_toolCallId, params) {
      const job = jobs.get(params.id);
      if (!job) {
        const running = jobs.size > 0 ? `Running: ${[...jobs.keys()].join(", ")}.` : "No background commands are running.";
        throw new Error(`No running background command with id ${params.id}. ${running} A command that already exited has posted its result.`);
      }
      const details = await stop(job, "agent");
      if (!details) throw new Error(`pi is shutting down; background command ${job.id} was killed.`);
      return { content: [{ type: "text", text: resultText(details) }], details };
    },
  });

  pi.registerCommand("background", {
    description: "List running background commands; see one's full command and output, or stop it",
    handler: async (_args, ctx) => {
      if (jobs.size === 0) {
        ctx.ui.notify("No background commands running.", "info");
        return;
      }
      await ctx.ui.custom<void>(
        (tui, theme, keybindings, done) =>
          new BackgroundList({
            running: () => [...jobs.values()],
            stop: (id) => {
              const job = jobs.get(id);
              // A signal pi may not send (EPERM) is shown rather than left as an unhandled rejection.
              if (job) stop(job, "user").catch((error: unknown) => ctx.ui.notify(`Stop failed: ${error instanceof Error ? error.message : String(error)}`, "error"));
            },
            // Leaves room for the footer: its status line, one running-list line per job, and a line of chat.
            maxHeight: () => tui.terminal.rows - jobs.size - 2,
            copy: copyToClipboard,
            theme,
            keybindings,
            requestRender: () => tui.requestRender(),
            done,
          }),
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    runningList = new RunningList(ctx.ui, "bash-background", () =>
      [...jobs.values()].map((job) => ({ name: "bash", label: job.command, startedAt: job.startedAt })),
    );

    // A fork copies the parent's entries under a new session id; only this session's jobs are its to report.
    const sessionId = ctx.sessionManager.getSessionId();
    const latest = new Map<string, JobEntry>();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const job = entry.data as JobEntry;
      if (job.ownerSessionId === sessionId) latest.set(job.id, job);
    }
    const interrupted = [...latest.values()].filter((job) => job.state === "started");
    if (interrupted.length === 0) return;
    // Posted without starting a turn: pi just started and the user may not be there. A `nextTurn` message would only
    // sit in memory until the next prompt, so `ended` is saved once the notice is in the conversation: if pi stops
    // before then, the jobs are reported again.
    inbox.deliver(interruptedMessage(interrupted), {
      startTurn: false,
      onPosted: () => {
        for (const job of interrupted) pi.appendEntry<JobEntry>(ENTRY_TYPE, { id: job.id, ownerSessionId: sessionId, state: "ended" });
      },
    });
  });

  // A compaction or /tree may drop the start replies, so the agent is told again what runs, without a new turn.
  const reportRunning = async () => {
    if (jobs.size > 0) inbox.deliver(runningMessage([...jobs.values()]), { startTurn: false });
  };
  pi.on("session_compact", reportRunning);
  pi.on("session_tree", reportRunning);

  pi.on("session_shutdown", async () => {
    for (const job of jobs.values()) job.abort.abort();
    jobs.clear();
    runningList?.dispose();
    runningList = undefined;
  });
}
