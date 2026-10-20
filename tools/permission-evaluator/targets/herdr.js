// Herdr pane target: where the agent runs and how the evaluator may inspect and answer it.

// The pane ID is interpolated into the evaluator's Bash allowlist, so it must stay a plain token.
const PANE_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

export const herdr = {
  type: "herdr",

  // Hooks run inside the agent process, which inherits the pane's environment.
  fromEnvironment(env) {
    if (env.HERDR_ENV !== "1") return null;

    const target = {
      type: "herdr",
      pane_id: env.HERDR_PANE_ID,
      socket_path: env.HERDR_SOCKET_PATH || null,
    };
    return herdr.isValid(target) ? target : null;
  },

  isValid(target) {
    return typeof target?.pane_id === "string" && PANE_ID_PATTERN.test(target.pane_id);
  },

  key: (target) => `herdr:${target.pane_id}`,

  label: (target) => `Herdr pane ${target.pane_id}`,

  // Brought to the front when a notification is clicked: the terminal Herdr runs in.
  appBundleId: "com.mitchellh.ghostty",

  // Shows the visible prompt; the evaluator runs it before every row.
  readCommand: (target) => `herdr agent read ${target.pane_id} --source visible`,

  inspectCommands: (target) => [
    `herdr agent get ${target.pane_id}`,
    herdr.readCommand(target),
    `herdr agent explain ${target.pane_id} --json --verbose`,
  ],

  approveCommand: (target) => `herdr agent send-keys ${target.pane_id} enter`,

  // Brings the pane forward for the human (dashboard, notification click); argv, not part of any
  // allowlist.
  focusCommand: (target) => ["herdr", "agent", "focus", target.pane_id],

  // What a process started outside any pane needs to reach the target's server.
  serverEnvironment: (target) => (target.socket_path ? { HERDR_SOCKET_PATH: target.socket_path } : {}),

  // Drops the runner's own HERDR_* variables: a runner started inside a pane would otherwise make
  // the evaluator report itself as that pane's agent. The socket points the CLI at the target's
  // server, since launchd starts the runner outside any pane.
  environment(target) {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("HERDR_")),
    );
    return { ...environment, ...herdr.serverEnvironment(target) };
  },
};
