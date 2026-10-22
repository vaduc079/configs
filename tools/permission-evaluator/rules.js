// Deterministic decisions the hook makes before anything reaches the LLM evaluator.
//
// `rules.json` (local, ignored by Git) holds the allowlists:
//
//   { "slackChannels": ["C0123456789", "U0123456789"] }
//
// A missing or unreadable file disables the allow rules; those asks go to the evaluator as before.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const RULES_FILE = "rules.json";

export function loadRules(pluginRoot) {
  try {
    const rules = JSON.parse(readFileSync(join(pluginRoot, RULES_FILE), "utf8"));
    const slackChannels = Array.isArray(rules?.slackChannels)
      ? rules.slackChannels.filter((channel) => typeof channel === "string" && channel !== "")
      : [];
    return { slackChannels };
  } catch {
    return { slackChannels: [] };
  }
}

// Returns { status, rule, reason } for an ask a rule decides, or null to leave it to the evaluator.
// `handled` is approved by the hook itself; `need_human` is escalated without an evaluator run.
export function ruleDecision(context, rules) {
  const { tool, input } = context;

  // A question for the user, not a permission: only the user can answer it.
  if (tool === "AskUserQuestion") {
    return { status: "need_human", rule: "ask-user-question", reason: "question for you" };
  }

  if (tool === "mcp__slack__slack_send_message" && rules.slackChannels.includes(input?.channel_id)) {
    return {
      status: "handled",
      rule: "slack-allowlisted-channel",
      reason: `Slack message to allowlisted ${input.channel_id}`,
    };
  }

  return null;
}
