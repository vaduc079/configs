#!/usr/bin/env bun

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRules, ruleDecision } from "./rules.js";

const RULES = { slackChannels: ["C1", "U1"] };

describe("ruleDecision", () => {
  test("approves a Slack message to an allowlisted channel or DM", () => {
    for (const channel_id of ["C1", "U1"]) {
      const decision = ruleDecision({ tool: "mcp__slack__slack_send_message", input: { channel_id } }, RULES);
      expect(decision).toMatchObject({ status: "handled", rule: "slack-allowlisted-channel" });
    }
  });

  test("leaves other channels and other Slack tools to the evaluator", () => {
    const asks = [
      { tool: "mcp__slack__slack_send_message", input: { channel_id: "C9" } },
      { tool: "mcp__slack__slack_send_message", input: {} },
      { tool: "mcp__slack__slack_schedule_message", input: { channel_id: "C1" } },
      { tool: "Bash", input: { command: "rm -rf /tmp/x" } },
    ];
    for (const ask of asks) expect(ruleDecision(ask, RULES)).toBeNull();
  });

  test("escalates AskUserQuestion", () => {
    expect(ruleDecision({ tool: "AskUserQuestion", input: {} }, RULES)).toMatchObject({ status: "need_human" });
  });
});

describe("loadRules", () => {
  test("reads the Slack allowlist and drops invalid entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "rules-"));
    writeFileSync(join(dir, "rules.json"), JSON.stringify({ slackChannels: ["C1", "", 3] }));
    expect(loadRules(dir)).toEqual({ slackChannels: ["C1"] });
  });

  test("allows nothing when the file is missing or invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "rules-"));
    expect(loadRules(dir)).toEqual({ slackChannels: [] });
    writeFileSync(join(dir, "rules.json"), "{");
    expect(loadRules(dir)).toEqual({ slackChannels: [] });
  });
});
