import assert from "node:assert/strict";
import { test } from "node:test";
import { findModelRule, modelRef } from "./model-rule.ts";

const rules = [
  { model: "anthropic/claude-haiku-*", name: "haiku" },
  { model: "anthropic/*", name: "anthropic" },
  { model: "openai-codex/gpt-5.6", name: "exact" },
];

test("modelRef is provider/id", () => {
  assert.equal(modelRef({ provider: "anthropic", id: "claude-opus-5-5" }), "anthropic/claude-opus-5-5");
});

test("the first matching rule wins", () => {
  assert.equal(findModelRule(rules, "anthropic/claude-haiku-5-5")?.name, "haiku");
  assert.equal(findModelRule(rules, "anthropic/claude-opus-5-5")?.name, "anthropic");
});

test("only * is a wildcard; other characters match literally", () => {
  assert.equal(findModelRule(rules, "openai-codex/gpt-5.6")?.name, "exact");
  assert.equal(findModelRule(rules, "openai-codex/gpt-5x6"), undefined);
  assert.equal(findModelRule([{ model: "a/b?" }], "a/bc"), undefined);
});
