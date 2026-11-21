// Runs real shell commands through pi's exec. Needs pi's packages: `npm run link-pi`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { runJob, stopJob } from "./job.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bash-background-job-test-"));
after(() => fs.rmSync(tmp, { recursive: true }));

async function start(name: string, command: string) {
  const logPath = path.join(tmp, `${name}.log`);
  const pidPath = path.join(tmp, `${name}.pid`);
  const abort = new AbortController();
  const { exec } = createLocalBashOperations();
  const ended = runJob({ exec, command, cwd: tmp, env: undefined, timeout: undefined, signal: abort.signal, logPath, pidPath });
  for (const end = Date.now() + 4_000; !(fs.existsSync(logPath) && fs.readFileSync(logPath, "utf8").includes("ready")); await sleep(20)) {
    if (Date.now() > end) throw new Error("timed out waiting for the command to start");
  }
  return { pidPath, abort, ended };
}

test("stopJob ends a job with SIGTERM, without waiting for the grace period", async () => {
  const { pidPath, abort, ended } = await start("term", "echo ready; sleep 30");
  const started = Date.now();
  await stopJob(pidPath, ended, abort, 2_000);
  assert.ok(Date.now() - started < 1_000);
  assert.equal((await ended).status, "exit 143 (SIGTERM)");
  assert.ok(!abort.signal.aborted);
});

test("stopJob SIGKILLs a job that ignores SIGTERM once the grace period ends", async () => {
  // An ignored signal stays ignored in the shell's children, so `sleep` survives the SIGTERM too.
  const { pidPath, abort, ended } = await start("trap", "trap '' TERM; echo ready; sleep 30");
  const started = Date.now();
  await stopJob(pidPath, ended, abort, 200);
  assert.ok(Date.now() - started >= 200);
  assert.equal((await ended).status, "exit 137 (SIGKILL)");
});

test("stopJob before the shell has saved its PID aborts the job", async () => {
  const abort = new AbortController();
  await stopJob(path.join(tmp, "missing.pid"), new Promise(() => {}), abort);
  assert.ok(abort.signal.aborted);
});
