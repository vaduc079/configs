import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fixtureRoot = mkdtempSync(join(tmpdir(), "herdr-agent-sidebar-"));
const socketPath = join(fixtureRoot, "herdr.sock");
const stateDir = join(fixtureRoot, "state");
const agentPath = join(fixtureRoot, "agent.json");
const callsPath = join(fixtureRoot, "calls.jsonl");
const fakeHerdrPath = join(fixtureRoot, "herdr");
const requests = [];
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let server;

const baseAgent = {
  terminal_id: "term-1",
  pane_id: "w1:p1",
  workspace_id: "w1",
  tab_id: "w1:t1",
  agent: "codex",
  agent_status: "working",
  state_change_seq: 10,
  terminal_title_stripped: "Implement sidebar",
  tokens: {},
};

function writeAgent(overrides = {}) {
  writeFileSync(agentPath, JSON.stringify({ ...baseAgent, ...overrides }));
}

function readAgent() {
  return JSON.parse(readFileSync(agentPath, "utf8"));
}

function readState() {
  return JSON.parse(readFileSync(join(stateDir, "snoozes.json"), "utf8"));
}

async function runSidebar(args, { now = NOW, env = {} } = {}) {
  const child = Bun.spawn(["bun", join(import.meta.dir, "sidebar.js"), ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HERDR_BIN_PATH: fakeHerdrPath,
      HERDR_SOCKET_PATH: socketPath,
      HERDR_PLUGIN_STATE_DIR: stateDir,
      AGENT_SIDEBAR_DISABLE_TIMER: "1",
      AGENT_SIDEBAR_NOW_MS: String(now),
      FAKE_AGENT_PATH: agentPath,
      FAKE_CALLS_PATH: callsPath,
      ...env,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr || stdout);
}

function calls() {
  try {
    return readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
}

function snoozeCalls() {
  return calls().filter((args) => args.includes("sidebar_snoozed=true"));
}

beforeAll(async () => {
  writeFileSync(fakeHerdrPath, `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "agent" && args[1] === "list") {
  if (process.env.FAKE_AGENT_UNAVAILABLE === "1") process.exit(1);
  const agent = JSON.parse(readFileSync(process.env.FAKE_AGENT_PATH, "utf8"));
  console.log(JSON.stringify({ result: { agents: [agent] } }));
  process.exit(0);
}
if (args[0] === "pane" && args[1] === "report-metadata") {
  const agent = JSON.parse(readFileSync(process.env.FAKE_AGENT_PATH, "utf8"));
  agent.tokens ||= {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--token") {
      const [name, ...rest] = args[++i].split("=");
      agent.tokens[name] = rest.join("=");
    } else if (args[i] === "--clear-token") {
      delete agent.tokens[args[++i]];
    }
  }
  writeFileSync(process.env.FAKE_AGENT_PATH, JSON.stringify(agent));
}
appendFileSync(process.env.FAKE_CALLS_PATH, JSON.stringify(args) + "\\n");
console.log(JSON.stringify({ result: { type: "ok" } }));
`);
  chmodSync(fakeHerdrPath, 0o755);

  server = createServer((connection) => {
    let buffered = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk) => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(buffered.slice(0, newline));
      requests.push(request);
      connection.end(`${JSON.stringify({ id: request.id, result: { type: "agent_view", active: true } })}\n`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
});

beforeEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(callsPath, { force: true });
  requests.length = 0;
  writeAgent();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("sidebar command", () => {
  test("publishes title metadata and the Agent view", async () => {
    await runSidebar(["sync"]);

    expect(calls()[0]).toContain("sidebar_background_title=Implement sidebar");
    expect(requests.at(-1).method).toBe("agent.view.set");
    expect(requests.at(-1).params.sort[0]).toEqual({ field: "status", order: "asc" });
  });

  test("a short snooze uses an exact TTL without a sleeper", async () => {
    await runSidebar(["set-snooze", "w1:p1", String(NOW + HOUR)]);

    expect(snoozeCalls()[0]).toContain(String(HOUR));
    expect(readAgent().tokens.sidebar_snoozed).toBe("true");
    expect(readState().timer).toBeNull();
    expect(Object.values(readState().snoozes)[0].token_until_ms).toBe(NOW + HOUR);
  });

  test("a long snooze renews until its final 24-hour lease, then stops sleeping", async () => {
    await runSidebar(["set-snooze", "w1:p1", String(NOW + 3 * DAY)]);
    const first = readState();
    expect(snoozeCalls()[0]).toContain(String(DAY));
    expect(first.timer.wake_at_ms).toBe(NOW + 12 * HOUR);

    await runSidebar(["timer", first.timer.generation], { now: NOW + 12 * HOUR });
    const renewed = readState();
    expect(renewed.snoozes["terminal:term-1"].token_until_ms).toBe(NOW + 36 * HOUR);
    expect(renewed.timer.wake_at_ms).toBe(NOW + 24 * HOUR);
    expect(snoozeCalls()).toHaveLength(2);

    for (const elapsedHours of [24, 36, 48]) {
      const current = readState();
      await runSidebar(["timer", current.timer.generation], { now: NOW + elapsedHours * HOUR });
    }

    const final = readState();
    expect(final.snoozes["terminal:term-1"].token_until_ms).toBe(NOW + 3 * DAY);
    expect(final.timer).toBeNull();
    expect(snoozeCalls()).toHaveLength(5);
  });

  test("a missing marker during normal runtime clears state and is not restored", async () => {
    await runSidebar(["set-snooze", "w1:p1", String(NOW + HOUR)]);
    writeAgent({ tokens: {} });
    const callsBefore = snoozeCalls().length;

    await runSidebar(["sync"]);

    expect(readState().snoozes).toEqual({});
    expect(snoozeCalls()).toHaveLength(callsBefore);
  });

  test("startup restores an unexpired missing marker", async () => {
    await runSidebar(["set-snooze", "w1:p1", String(NOW + HOUR)]);
    writeAgent({ tokens: {} });

    await runSidebar(["sync", "--startup"], { now: NOW + 1_000 });

    expect(readAgent().tokens.sidebar_snoozed).toBe("true");
    expect(readState().snoozes).not.toEqual({});
    expect(snoozeCalls()).toHaveLength(2);
  });

  test("an orphan marker is cleared when state is missing", async () => {
    writeAgent({ tokens: { sidebar_snoozed: "true" } });

    await runSidebar(["sync"]);

    expect(readAgent().tokens.sidebar_snoozed).toBeUndefined();
    expect(readState().snoozes).toEqual({});
  });

  test("a failed renewal arms one bounded retry", async () => {
    await runSidebar(["set-snooze", "w1:p1", String(NOW + 3 * DAY)]);
    const first = readState();

    await runSidebar(["timer", first.timer.generation], {
      now: NOW + 12 * HOUR,
      env: { FAKE_AGENT_UNAVAILABLE: "1" },
    });

    const retried = readState();
    expect(retried.timer.wake_at_ms).toBe(NOW + 12 * HOUR + 5 * 60 * 1000);
    expect(retried.timer.generation).not.toBe(first.timer.generation);
  });

  test("blocked permanently clears snooze and its timer", async () => {
    await runSidebar(["set-snooze", "w1:p1", String(NOW + 3 * DAY)]);
    writeAgent({ agent_status: "blocked", tokens: { sidebar_snoozed: "true" } });

    await runSidebar(["sync"]);

    expect(readState()).toEqual({ snoozes: {}, timer: null });
    expect(readAgent().tokens.sidebar_snoozed).toBeUndefined();
  });

  test("deactivate clears view, metadata, state, and timer", async () => {
    await runSidebar(["set-snooze", "w1:p1", String(NOW + 3 * DAY)]);
    await runSidebar(["deactivate"]);

    expect(readState()).toEqual({ snoozes: {}, timer: null });
    expect(readAgent().tokens).toEqual({});
    expect(requests.at(-1)).toMatchObject({
      method: "agent.view.clear",
      params: { source: "plugin:local.agent-sidebar" },
    });
  });
});
