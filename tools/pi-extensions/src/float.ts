/**
 * Opens a command in a floating pane of the terminal pi runs in. Each supported terminal is one opener; Rex is the only
 * one so far. Another terminal (tmux `display-popup`, zellij `run --floating`, a kitty overlay) adds a branch to
 * `floatOpener` that detects it from the environment.
 */
import { execFile } from "node:child_process";

type FloatCommand = { argv: string[]; cwd: string; title: string };
/** Width and height as fractions of the window, from 0 (exclusive) to 1. The float is centred. */
export type FloatSize = { width: number; height: number };
type FloatOpener = (command: FloatCommand, size: FloatSize) => Promise<void>;
type Run = (file: string, args: string[]) => Promise<string>;

/** The opener for the terminal pi runs in, or undefined when pi can't open floats there. */
export function floatOpener(env: NodeJS.ProcessEnv = process.env, run: Run = runFile): FloatOpener | undefined {
  const { REX_SESSION: session, REX_BLOCK: block } = env;
  if (session && block) return (command, size) => openRexFloat(run, session, block, command, size);
  return undefined;
}

/**
 * A Rex floating layer over the window that holds pi's pane (`REX_BLOCK`), not the active window, which may be another
 * tab. The command runs through an interactive login shell, so it gets the PATH and environment of the user's
 * terminals. The pane closes when the command exits.
 */
async function openRexFloat(run: Run, session: string, block: string, command: FloatCommand, size: FloatSize) {
  const inspected = JSON.parse(await run("rex", ["block", "inspect", "-s", session, block, "--json"])) as {
    block?: { window_id?: string };
  };
  const windowId = inspected.block?.window_id;
  if (!windowId) throw new Error(`Rex did not report the window of ${block}.`);
  const layer = {
    window_id: windowId,
    bounds: [(1 - size.width) / 2, (1 - size.height) / 2, size.width, size.height],
    focus: true,
    layout: {
      block: {
        flavor: "com.superlogical.terminal.shell",
        label: command.title,
        options: { command: command.argv, cwd: command.cwd, interactive: true },
      },
    },
  };
  await run("rex", ["api", "call", "-s", session, "session.new_layer", JSON.stringify(layer)]);
}

function runFile(file: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message, { cause: error }));
      else resolve(stdout);
    });
  });
}
