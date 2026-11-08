import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { configFile, readConfig } from "./config.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-extensions-config-"));

test("configFile is <agent dir>/<name>.json", () => {
  process.env.PI_CODING_AGENT_DIR = dir;
  assert.equal(configFile("subagents"), path.join(dir, "subagents.json"));
});

test("a missing file reads as undefined", () => {
  assert.equal(readConfig(path.join(dir, "missing.json")), undefined);
});

test("valid JSON is returned as parsed", () => {
  const file = path.join(dir, "ok.json");
  fs.writeFileSync(file, '{"mode": "low"}');
  assert.deepEqual(readConfig(file), { mode: "low" });
});

test("invalid JSON throws an error that names the file", () => {
  const file = path.join(dir, "broken.json");
  fs.writeFileSync(file, "{ nope");
  assert.throws(() => readConfig(file), (error: Error) => error.message.startsWith(`${file}: invalid JSON: `));
});
