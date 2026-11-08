/**
 * Per-model child settings from ~/.pi/agent/subagents.json. A missing file means no rules.
 *
 * `models` is a list of rules; the first rule whose `model` glob (`*` matches anything) matches the child's
 * `provider/id` applies, even if it sets nothing. Specific rules go before broad ones. Example:
 * {
 *   "models": [
 *     { "model": "anthropic/claude-haiku-*", "cacheRetention": "long" },
 *     { "model": "anthropic/*", "cacheRetention": "short" }
 *   ]
 * }
 *
 * Settings:
 * - `cacheRetention`: "short" or "long", sent as `PI_CACHE_RETENTION`. Unset inherits the parent's environment.
 *   pi 1.5.0 ignores it for `openai-codex`.
 */
import { configFile, readConfig } from "../../src/config.ts";
import { findModelRule, modelRef } from "../../src/model-rule.ts";
import type { ModelChoice } from "./subagent.ts";

const CACHE_RETENTIONS = ["short", "long"] as const;
type CacheRetention = (typeof CACHE_RETENTIONS)[number];

type ModelRule = { model: string; cacheRetention?: CacheRetention };

export type ChildEnv = (model: ModelChoice) => Record<string, string>;

export function loadChildEnv(file = configFile("subagents")): ChildEnv {
  const rules = parseRules(readConfig(file), file);
  return (model): Record<string, string> => {
    const rule = findModelRule(rules, modelRef(model));
    return rule?.cacheRetention ? { PI_CACHE_RETENTION: rule.cacheRetention } : {};
  };
}

function parseRules(config: unknown, file: string): ModelRule[] {
  const models = (config as { models?: unknown } | null | undefined)?.models ?? [];
  if (!Array.isArray(models)) throw new Error(`${file}: "models" must be a list.`);
  return models.map((rule: unknown, index) => {
    const where = `${file}: models[${index}]`;
    const { model, cacheRetention } = (rule ?? {}) as { model?: unknown; cacheRetention?: unknown };
    if (typeof model !== "string") throw new Error(`${where}.model must be a string.`);
    if (cacheRetention !== undefined && !isCacheRetention(cacheRetention)) {
      throw new Error(`${where}.cacheRetention must be one of ${CACHE_RETENTIONS.join(", ")}.`);
    }
    return { model, cacheRetention };
  });
}

function isCacheRetention(value: unknown): value is CacheRetention {
  return CACHE_RETENTIONS.includes(value as CacheRetention);
}
