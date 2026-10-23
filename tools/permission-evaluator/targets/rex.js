// Rex block target: where the agent runs and how the evaluator may inspect and answer it.

import { join } from "node:path";

// The block ID and server URL are interpolated into the evaluator's Bash allowlist, so they must
// stay plain tokens. Rex percent-encodes the space in "Application Support", so the URL has none.
const BLOCK_ID_PATTERN = /^block:[A-Za-z0-9_-]+$/;
const SESSION_ID_PATTERN = /^session:[A-Za-z0-9_-]+$/;
const SERVER_PATTERN = /^unix:\/\/\/[A-Za-z0-9._~%/-]+$/;
// REX_BIN_DIR is the Rex server's app bundle, which is not on launchd's PATH. It goes on PATH, so it
// must be absolute and free of `:`.
const BIN_DIR_PATTERN = /^\/[^:\n]*$/;

// `-S` names the server explicitly, so the evaluator needs no REX_* variables. Those would make
// Rex's own Claude Code SessionStart hook treat the evaluator as an agent in a Rex block.
const rexCommand = (target, args) => `rex -S ${target.server} ${args}`;

export const rex = {
  type: "rex",

  // Hooks run inside the agent process, which inherits the block's environment.
  fromEnvironment(env) {
    if (!env.REX_BLOCK) return null;

    const target = {
      type: "rex",
      pane_id: env.REX_BLOCK,
      server: env.REX_SERVER,
      bin_dir: env.REX_BIN_DIR || null,
      session_id: env.REX_SESSION || null,
    };
    return rex.isValid(target) ? target : null;
  },

  isValid(target) {
    return (
      typeof target?.pane_id === "string" &&
      BLOCK_ID_PATTERN.test(target.pane_id) &&
      typeof target.server === "string" &&
      SERVER_PATTERN.test(target.server) &&
      (target.bin_dir == null || BIN_DIR_PATTERN.test(target.bin_dir)) &&
      (target.session_id == null || SESSION_ID_PATTERN.test(target.session_id))
    );
  },

  key: (target) => `rex:${target.pane_id}`,

  label: (target) => `Rex block ${target.pane_id}`,

  // Brought to the front when a notification is clicked.
  appBundleId: "com.superlogical.rex",

  // Shows the visible screen; the evaluator runs it before every row.
  readCommand: (target) => rexCommand(target, `capture -b ${target.pane_id} --trim`),

  inspectCommands: (target) => [rex.readCommand(target)],

  approveCommand: (target) => rexCommand(target, `send-key -b ${target.pane_id} enter`),

  // Brings the block forward for the human (dashboard, notification click): switches Rex.app to the
  // block's session (needs Remote Control on in its Settings), then focuses the block, which `rex
  // focus` alone does only inside a session the app may not be showing. Argv, not part of any
  // allowlist; the values reach the script as positional arguments, never as script text. The
  // absolute path works from the bare environment of a notification click.
  focusCommand(target) {
    const executable = target.bin_dir ? join(target.bin_dir, "rex") : (Bun.which("rex") ?? "rex");
    if (!target.session_id) return [executable, "-S", target.server, "focus", target.pane_id];
    return [
      "/bin/sh",
      "-c",
      '"$1" -S "$2" do session.select session_id="$3"; "$1" -S "$2" focus -s "$3" "$4"',
      "rex-focus",
      executable,
      target.server,
      target.session_id,
      target.pane_id,
    ];
  },

  // The server is passed with -S, so a process outside any block needs nothing extra.
  serverEnvironment: () => ({}),

  // Drops the runner's own REX_* variables (see rexCommand) and puts the Rex CLI on PATH.
  environment(target) {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("REX_")),
    );
    if (target.bin_dir) environment.PATH = [target.bin_dir, environment.PATH].filter(Boolean).join(":");
    return environment;
  },
};
