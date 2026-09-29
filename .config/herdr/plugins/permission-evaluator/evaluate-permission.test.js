#!/usr/bin/env bun

import { describe, expect, test } from "bun:test";
import {
  buildClaudeArgs,
  claudeEnvironment,
  evaluatorPrompt,
  eventPaneId,
  verdictFromOutput,
} from "./evaluate-permission.js";

describe("eventPaneId", () => {
  test("returns a blocked Claude pane", () => {
    const event = JSON.stringify({
      event: "pane_agent_status_changed",
      data: { pane_id: "wF6:p2", agent: "claude", agent_status: "blocked" },
    });

    expect(eventPaneId(event)).toBe("wF6:p2");
  });

  test("ignores other events and unsafe pane IDs", () => {
    expect(
      eventPaneId(
        JSON.stringify({
          data: { pane_id: "w1:p1", agent: "codex", agent_status: "blocked" },
        }),
      ),
    ).toBeNull();
    expect(
      eventPaneId(
        JSON.stringify({
          data: { pane_id: "w1:p1; bad", agent: "claude", agent_status: "blocked" },
        }),
      ),
    ).toBeNull();
  });
});
describe("buildClaudeArgs", () => {
  test("dry run allows inspection but not terminal input", () => {
    const args = buildClaudeArgs("w1:p2", {
      dryRun: true,
      model: "sonnet",
      timeoutMs: 45_000,
    });

    const allowlistStart = args.indexOf("--allowedTools") + 1;
    const allowlistEnd = args.indexOf("--output-format");
    expect(args.slice(allowlistStart, allowlistEnd)).toEqual([
      "Bash(herdr agent get w1:p2)",
      "Bash(herdr agent read w1:p2 --source visible)",
      "Bash(herdr agent explain w1:p2 --json --verbose)",
    ]);
    expect(args).not.toContain("--restricted");
    expect(args).not.toContain("--safe-mode");
    expect(args).not.toContain("--max-budget-usd");
    expect(args.slice(args.indexOf("--tools") + 1, args.indexOf("--allowedTools"))).toEqual([
      "Bash",
    ]);
    expect(args.slice(args.indexOf("--permission-mode") + 1, args.indexOf("--permission-prompts"))).toEqual([
      "dontAsk",
    ]);
  });

  test("active mode allows only Enter in the target pane", () => {
    const args = buildClaudeArgs("w1:p2", {
      dryRun: false,
      model: "sonnet",
      timeoutMs: 45_000,
    });

    const allowlistStart = args.indexOf("--allowedTools") + 1;
    const allowlistEnd = args.indexOf("--output-format");
    expect(args.slice(allowlistStart, allowlistEnd)).toEqual([
      "Bash(herdr agent get w1:p2)",
      "Bash(herdr agent read w1:p2 --source visible)",
      "Bash(herdr agent explain w1:p2 --json --verbose)",
      "Bash(herdr agent send-keys w1:p2 enter)",
    ]);
  });
});

describe("evaluatorPrompt", () => {
  test("judges rm and WebFetch by concrete risk instead of tool name", () => {
    const prompt = evaluatorPrompt("w1:p2", false);

    expect(prompt).toContain("rm -rf \"$f\"");
    expect(prompt).toContain("WebFetch reading an explicitly shown public URL");
    expect(prompt).toContain("A confirmation prompt itself is not evidence");
    expect(prompt).toContain("globs or expansions whose values cannot be determined");
  });
});

describe("verdictFromOutput", () => {
  test("validates the decision and normalizes its reason", () => {
    const output = JSON.stringify({
      is_error: false,
      structured_output: {
        decision: "dry_run_would_approve",
        reason: "  Routine local\ninspection.  ",
      },
    });

    expect(verdictFromOutput(output, true)).toEqual({
      decision: "dry_run_would_approve",
      reason: "Routine local inspection.",
    });
    expect(verdictFromOutput(output, false)).toBeNull();
  });
});

describe("claudeEnvironment", () => {
  test("prepends only an absolute Herdr binary directory", () => {
    const base = { PATH: "/usr/bin:/bin" };
    expect(claudeEnvironment(undefined, base)).toBe(base);
    expect(claudeEnvironment("herdr", base)).toBe(base);
    expect(claudeEnvironment("/opt/herdr/bin/herdr", base).PATH).toBe(
      "/opt/herdr/bin:/usr/bin:/bin",
    );
  });
});
