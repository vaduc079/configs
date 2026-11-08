/** Model-facing text for the `subagent_models` tool: its system-prompt line, description, and parameter descriptions. */

export const PROMPT_SNIPPET = 'List the models a subagent can run on, as "provider/id"';

export const DESCRIPTION =
  'List the models a subagent can run on, as "provider/id". Pass one of these as the subagent tool\'s model.';

export const PARAMETERS = {
  query: "Case-insensitive filter on provider, id, or name",
};
