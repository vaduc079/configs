/** Runs one background command to its end: output to a log file, the last lines kept for the result. */
import fs from "node:fs";
import os from "node:os";
import { stripVTControlCharacters } from "node:util";
import { type BashOperations, DEFAULT_MAX_BYTES, truncateTail } from "@earendil-works/pi-coding-agent";

/** Lines of output the result message carries; the log file has the rest. */
const TAIL_LINES = 50;

export type JobEnd = { status: string; output: string };

type RunOptions = {
  logPath: string;
  pidPath: string;
  exec: BashOperations["exec"];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv | undefined;
  timeout: number | undefined;
  signal: AbortSignal;
};

/**
 * Stops the job's whole process group. pi starts the shell detached, so its PID is the group ID; a plain `kill`
 * of the shell would leave `cmd &` children running.
 */
export function killCommand(pidPath: string) {
  return `kill -TERM -- -$(cat '${pidPath}')`;
}

export async function runJob({ exec, command, cwd, env, timeout, signal, logPath, pidPath }: RunOptions): Promise<JobEnd> {
  const log = fs.createWriteStream(logPath);
  // A failed write (a full disk) must not crash pi; the result message still carries the last lines.
  log.on("error", () => {});
  let tail = Buffer.alloc(0);
  const onData = (data: Buffer) => {
    log.write(data);
    tail = Buffer.concat([tail, data]).subarray(-DEFAULT_MAX_BYTES);
  };

  let status: string;
  try {
    // The shell first saves its PID for killCommand.
    const { exitCode } = await exec(`echo $$ > '${pidPath}'\n${command}`, cwd, { onData, signal, timeout, env });
    status = exitStatus(exitCode);
    // Only a normal return is checked: a timeout or abort kills the group before exec rejects.
    if (groupIsRunning(Number(fs.readFileSync(pidPath, "utf8")))) {
      status = `the shell exited (${status}) but processes it started are still running, probably because the command ended with '&'. Their output is not captured. Stop them with: ${killCommand(pidPath)}`;
    }
  } catch (error) {
    // pi's exec reports a timeout as `timeout:<seconds>`; other errors (missing cwd, bad timeout) read as they are.
    // An abort is the user's stop from /background: the agent should know it was deliberate, not a crash.
    const message = error instanceof Error ? error.message : String(error);
    status = signal.aborted ? "stopped by the user" : message.startsWith("timeout:") ? `timed out after ${timeout}s` : message;
  } finally {
    log.end();
  }
  const output = truncateTail(stripVTControlCharacters(tail.toString()), { maxLines: TAIL_LINES }).content;
  return { status, output };
}

function groupIsRunning(pgid: number) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** pi reports a shell killed by a signal as 128 + the signal number. */
function exitStatus(exitCode: number | null) {
  if (exitCode === null) return "ended without an exit code";
  const signal = Object.entries(os.constants.signals).find(([, number]) => number === exitCode - 128)?.[0];
  return signal ? `exit ${exitCode} (${signal})` : `exit ${exitCode}`;
}
