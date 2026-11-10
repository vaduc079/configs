/**
 * pi's `bash` tool with `background: true`, modelled on OpenCode's shell tool (packages/core/src/tool/plugin/shell.ts).
 * A background call returns at once, its output streams to a log file, and when the command exits the agent gets one
 * message, which starts a turn if the agent is idle. Foreground calls run pi's built-in bash unchanged. `/background`
 * (ui.ts) lists running commands, shows one's full command and output, and stops one.
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
import { isSubagentChild } from "../../src/subagent-child.ts";
import { killCommand, runJob } from "./job.ts";
import { postResult, registerResultRenderer } from "./result.ts";
import { BackgroundList, type BackgroundJob } from "./ui.ts";

const LOG_DIR = path.join(os.tmpdir(), "pi-bash-bg");

const BACKGROUND_DESCRIPTION =
  "Run the command in the background. The call returns at once; when the command exits you get one message with its exit status and last lines of output. Use it for long builds, test runs and servers. Background commands have no timeout unless you set one. Do not end the command with '&': the shell would exit at once and the job would report success without output.";

const NOTE =
  "When it exits you get a message with its status and last lines of output. Do not poll for it: sleeping and re-reading the log is polling. Read the log only when it helps work you can do now. Continue with other work, or end your turn if nothing else is left.";

// What a codemode script gets from a background call, instead of the foreground result it cannot have yet.
const BackgroundOutput = Type.Object({
  background_id: Type.String(),
  log_path: Type.String({ description: "Output so far; the exit message has the last lines" }),
  kill_command: Type.String({ description: "Stops the command and every process it started" }),
  note: Type.String(),
});

type Job = BackgroundJob & { abort: AbortController };

export default function (pi: ExtensionAPI) {
  // A subagent child's run ends with its turn, so a message after the command exits would never reach the parent.
  if (isSubagentChild()) return;

  const inbox = registerInbox(pi, "Background command result");
  const jobs = new Map<string, Job>();
  let runningList: RunningList | undefined;
  registerResultRenderer(pi);

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
      const job: Job = { id, command: params.command, cwd: ctx.cwd, logPath, startedAt: Date.now(), abort: new AbortController() };
      const { exec } = createLocalBashOperations({ shellPath });
      fs.mkdirSync(LOG_DIR, { recursive: true });
      jobs.set(job.id, job);

      // pi's bash tool resolves the command prefix, cwd and session environment, then calls `exec`. This `exec`
      // starts the job and returns at once, so the job runs exactly what a foreground call would.
      const start = createBashToolDefinition(ctx.cwd, {
        ...options,
        operations: {
          exec: async (command, cwd, { env, timeout }) => {
            const run = runJob({ exec, command, cwd, env, timeout, signal: job.abort.signal, logPath, pidPath });
            void run.then((end) => {
              // Session shutdown already removed it: the session it would post to is gone.
              if (!jobs.delete(job.id)) return;
              const durationMs = Date.now() - job.startedAt;
              job.end = { status: end.status, durationMs };
              runningList?.render();
              const details = { ...end, id: job.id, command: job.command, logPath, durationMs };
              inbox.deliver((triggerTurn) => postResult(pi, details, triggerTurn));
            });
            return { exitCode: 0 };
          },
        },
      });
      await start.execute(toolCallId, params, undefined, undefined, ctx);
      runningList?.render();

      const structuredContent = { background_id: job.id, log_path: logPath, kill_command: killCommand(pidPath), note: NOTE };
      const text = [
        `Running in the background (id ${job.id}).`,
        `Output log: ${logPath}`,
        `To stop it and every process it started: ${structuredContent.kill_command}`,
        NOTE,
      ].join("\n");
      return { content: [{ type: "text", text }], structuredContent, details: undefined };
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
            stop: (id) => jobs.get(id)?.abort.abort(),
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
  });

  pi.on("session_shutdown", async () => {
    for (const job of jobs.values()) job.abort.abort();
    jobs.clear();
    runningList?.dispose();
    runningList = undefined;
  });
}
