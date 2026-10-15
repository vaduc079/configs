#!/usr/bin/env bun

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClaudeArgs,
  evaluateTarget,
  evaluatorPrompt,
  loadPolicy,
  resultsFromOutput,
} from "./evaluator.js";
import { herdr } from "./targets/herdr.js";

const target = { type: "herdr", pane_id: "w1:p2", socket_path: "/tmp/herdr.sock" };
const rows = [
  { id: 7, harness: "claude", context: { summary: "Bash: ls" } },
  { id: 8, harness: "claude", context: { summary: "Bash: git push" } },
];

function argsFor(dryRun) {
  return buildClaudeArgs({
    driver: herdr,
    target,
    rows,
    awaitingHuman: null,
    policy: "Test policy.",
    config: { dryRun, model: "sonnet" },
  });
}

function allowlist(args) {
  return args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--output-format"));
}

describe("buildClaudeArgs", () => {
  test("dry run allows inspection of the target pane only", () => {
    const args = argsFor(true);

    expect(allowlist(args)).toEqual([
      "Bash(herdr agent get w1:p2)",
      "Bash(herdr agent read w1:p2 --source visible)",
      "Bash(herdr agent explain w1:p2 --json --verbose)",
    ]);
  });

  test("active mode adds enter on the target pane", () => {
    expect(allowlist(argsFor(false)).at(-1)).toBe("Bash(herdr agent send-keys w1:p2 enter)");
  });

  test("passes rows as the user message", () => {
    const message = argsFor(true).at(-1);
    expect(message).toContain('"id": 7');
    expect(message).toContain("Bash: git push");
  });
});

describe("evaluatorPrompt", () => {
  test("embeds policy and the harness prompt guide", () => {
    const prompt = evaluatorPrompt({ driver: herdr, target, rows, policy: "Approve ls.", dryRun: true });

    expect(prompt).toContain("<policy>\nApprove ls.\n</policy>");
    expect(prompt).toContain("- claude: ");
    expect(prompt).toContain("send no keys");
    expect(prompt).not.toContain("send-keys");
  });
});

describe("resultsFromOutput", () => {
  function output(results, extra = {}) {
    return JSON.stringify({ is_error: false, structured_output: { results }, ...extra });
  }

  test("accepts one valid result per claimed row", () => {
    const results = resultsFromOutput(
      output([
        { id: 7, status: "handled", reason: "  read-only\n listing " },
        { id: 8, status: "need_human", reason: "push" },
      ]),
      [7, 8],
    );

    expect(results).toEqual([
      { id: 7, status: "handled", reason: "read-only listing" },
      { id: 8, status: "need_human", reason: "push" },
    ]);
  });

  test("rejects missing, duplicate, unknown or invalid results", () => {
    const handled = (id) => ({ id, status: "handled", reason: "ok" });

    expect(resultsFromOutput(output([handled(7)]), [7, 8])).toBeNull();
    expect(resultsFromOutput(output([handled(7), handled(7)]), [7, 8])).toBeNull();
    expect(resultsFromOutput(output([handled(7), handled(9)]), [7, 8])).toBeNull();
    expect(resultsFromOutput(output([handled(7), { id: 8, status: "denied", reason: "x" }]), [7, 8])).toBeNull();
    expect(resultsFromOutput(output([handled(7), handled(8)], { is_error: true }), [7, 8])).toBeNull();
    expect(resultsFromOutput("not json", [7])).toBeNull();
  });
});

describe("loadPolicy", () => {
  test("rejects an empty policy", () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), "permission-policy-"));
    writeFileSync(join(pluginRoot, "policy.md"), "  \n");

    expect(() => loadPolicy(pluginRoot)).toThrow("policy.md is empty");
  });
});

describe("evaluateTarget", () => {
  // Puts a fake `claude` first on PATH; the evaluator inherits PATH through driver.environment.
  async function evaluateWithFakeClaude(script, config) {
    const binDir = mkdtempSync(join(tmpdir(), "fake-claude-"));
    const claudePath = join(binDir, "claude");
    writeFileSync(claudePath, `#!/bin/sh\n${script}\n`);
    chmodSync(claudePath, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath}`;
    try {
      return await evaluateTarget({
        driver: herdr,
        target,
        rows,
        awaitingHuman: null,
        policy: "p",
        config: { dryRun: true, model: "sonnet", baseTimeoutMs: 5_000, perRowTimeoutMs: 0, ...config },
        pluginRoot: binDir,
      });
    } finally {
      process.env.PATH = originalPath;
    }
  }

  test("returns validated results from a successful run", async () => {
    const output = JSON.stringify({
      is_error: false,
      structured_output: {
        results: [
          { id: 7, status: "stale", reason: "gone" },
          { id: 8, status: "stale", reason: "gone" },
        ],
      },
    });
    const outcome = await evaluateWithFakeClaude(`echo '${output}'`);

    expect(outcome.error).toBeUndefined();
    expect(outcome.results.map((result) => result.status)).toEqual(["stale", "stale"]);
  });

  test("hard-kills an evaluator that ignores SIGTERM", async () => {
    const startedAt = Date.now();
    const outcome = await evaluateWithFakeClaude("trap '' TERM; sleep 10", { baseTimeoutMs: 300 });

    expect(outcome.results).toBeNull();
    expect(outcome.error).toBe("killed by SIGKILL (timeout 300 ms)");
    expect(Date.now() - startedAt).toBeLessThan(4_000);
  });

  test("stops waiting when a leftover child keeps the output open", async () => {
    const startedAt = Date.now();
    const outcome = await evaluateWithFakeClaude("sleep 10 & exit 0");

    expect(outcome.results).toBeNull();
    expect(outcome.error).toBe("evaluator output did not close after exit");
    expect(Date.now() - startedAt).toBeLessThan(4_000);
  });

  test("reports a non-zero exit with its stderr", async () => {
    const outcome = await evaluateWithFakeClaude("echo 'auth failed' >&2; exit 3");

    expect(outcome).toMatchObject({ results: null, exitStatus: 3, error: "auth failed" });
  });
});
