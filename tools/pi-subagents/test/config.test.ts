import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { loadChildEnv } from "../config.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-config-"));
let n = 0;
const write = (config: unknown) => {
  const file = path.join(dir, `subagents-${n++}.json`);
  fs.writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));
  return file;
};
const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const haiku = { provider: "anthropic", id: "claude-haiku-5-5" };
const gpt = { provider: "openai-codex", id: "gpt-5.6-sol" };

test("a missing file sets nothing", () => {
  assert.deepEqual(loadChildEnv(path.join(dir, "missing.json"))(opus), {});
});

test("the first matching rule applies, by provider or model", () => {
  const childEnv = loadChildEnv(
    write({
      models: [
        { model: "anthropic/claude-haiku-*", cacheRetention: "long" },
        { model: "anthropic/*", cacheRetention: "short" },
      ],
    }),
  );
  assert.deepEqual(childEnv(opus), { PI_CACHE_RETENTION: "short" });
  assert.deepEqual(childEnv(haiku), { PI_CACHE_RETENTION: "long" });
  assert.deepEqual(childEnv(gpt), {});
});

test("a matching rule without cacheRetention inherits the parent's value", () => {
  const childEnv = loadChildEnv(
    write({ models: [{ model: "anthropic/claude-opus-*" }, { model: "anthropic/*", cacheRetention: "short" }] }),
  );
  assert.deepEqual(childEnv(opus), {});
  assert.deepEqual(childEnv(haiku), { PI_CACHE_RETENTION: "short" });
});

test("glob characters other than * match literally", () => {
  const childEnv = loadChildEnv(write({ models: [{ model: "openai-codex/gpt-5.6-sol", cacheRetention: "short" }] }));
  assert.deepEqual(childEnv(gpt), { PI_CACHE_RETENTION: "short" });
  assert.deepEqual(childEnv({ provider: "openai-codex", id: "gpt-5x6-sol" }), {});
});

test("invalid config fails at load", () => {
  assert.throws(() => loadChildEnv(write("{ not json")), /subagents-\d+\.json: invalid JSON/);
  assert.deepEqual(loadChildEnv(write("null"))(opus), {});
  assert.throws(() => loadChildEnv(write({ models: {} })), /"models" must be a list/);
  assert.throws(() => loadChildEnv(write({ models: [{ cacheRetention: "short" }] })), /models\[0\]\.model must be a string/);
  assert.throws(
    () => loadChildEnv(write({ models: [{ model: "anthropic/*", cacheRetention: "none" }] })),
    /models\[0\]\.cacheRetention must be one of short, long/,
  );
});
