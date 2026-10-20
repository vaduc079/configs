// Claude Code `PermissionRequest` hook adapter.

const SUMMARY_LIMIT = 200;

function summarize(toolName, toolInput) {
  const subject =
    toolInput.command ?? toolInput.file_path ?? toolInput.url ?? toolInput.pattern ?? toolInput.path;
  const detail = typeof subject === "string" ? subject : JSON.stringify(toolInput);
  return `${toolName}: ${detail}`.replace(/\s+/g, " ").slice(0, SUMMARY_LIMIT);
}

export const claude = {
  name: "claude",

  // Tells the evaluator how this harness renders a permission prompt.
  promptGuide:
    "Claude Code shows a permission dialog naming the tool and its input, followed by numbered " +
    "options. The first option (\"Yes\") allows once and is selected by default (marked with ❯). " +
    "Options that mention \"don't ask again\", \"always\" or a session-wide allow are persistent.",

  parseHookInput(input) {
    if (input?.hook_event_name !== "PermissionRequest") return null;

    const toolName = typeof input.tool_name === "string" ? input.tool_name : "unknown";
    const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};

    return {
      sessionId: input.session_id ?? null,
      context: {
        tool: toolName,
        input: toolInput,
        summary: summarize(toolName, toolInput),
        cwd: input.cwd,
        permission_mode: input.permission_mode,
        agent_id: input.agent_id,
        agent_type: input.agent_type,
        permission_suggestions: input.permission_suggestions,
      },
    };
  },
};
