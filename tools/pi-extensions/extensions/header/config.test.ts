import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "./config.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "header-"));
process.env.PI_CODING_AGENT_DIR = dir;
const file = path.join(dir, "header.json");
const write = (config: unknown) => fs.writeFileSync(file, JSON.stringify(config));

test("no config file means no art and no greeting", () => {
  fs.rmSync(file, { force: true });
  assert.deepEqual(loadConfig(), {});
});

test("art and greeting are read as given", () => {
  write({ art: "pokemon-colorscripts --no-title -r", greeting: "Hi" });
  assert.deepEqual(loadConfig(), { art: "pokemon-colorscripts --no-title -r", greeting: "Hi" });
});

test("a config that is not an object names the file", () => {
  write([]);
  assert.throws(() => loadConfig(), (error: Error) => error.message === `${file}: expected a JSON object.`);
});

test("invalid fields name the file and the field", () => {
  for (const [config, field] of [
    [{ art: ["ls"] }, '"art"'],
    [{ greeting: 1 }, '"greeting"'],
  ] as const) {
    write(config);
    assert.throws(() => loadConfig(), (error: Error) => error.message.startsWith(file) && error.message.includes(field));
  }
});
