// The contract between pi-subagents and the extensions loaded in its child sessions.

/** Added to the environment of every child session that subagents starts. */
export const SUBAGENT_CHILD_ENV = { PI_SUBAGENT_CHILD: "1" };

/** True inside a subagent child: there is no user to ask, so nothing may prompt. */
export function isSubagentChild() {
  return process.env.PI_SUBAGENT_CHILD === "1";
}
