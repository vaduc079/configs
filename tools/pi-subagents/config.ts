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
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ModelChoice } from "./subagent.ts";

const CACHE_RETENTIONS = ["short", "long"] as const;

type ModelRule = { model: string; cacheRetention?: (typeof CACHE_RETENTIONS)[number] };

export type ChildEnv = (model: ModelChoice) => Record<string, string>;

export function loadChildEnv(file = path.join(getAgentDir(), "subagents.json")): ChildEnv {
  const rules = fs.existsSync(file) ? parseRules(fs.readFileSync(file, "utf8"), file) : [];
  return (model): Record<string, string> => {
    const name = `${model.provider}/${model.id}`;
    const rule = rules.find((candidate) => globToRegExp(candidate.model).test(name));
    return rule?.cacheRetention ? { PI_CACHE_RETENTION: rule.cacheRetention } : {};
  };
}

function parseRules(text: string, file: string): ModelRule[] {
  // A load error stops pi from starting, so the message must name the file.
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const models: unknown = config?.models ?? [];
  if (!Array.isArray(models)) throw new Error(`${file}: "models" must be a list.`);
  return models.map((rule, index) => {
    const where = `${file}: models[${index}]`;
    if (typeof rule?.model !== "string") throw new Error(`${where}.model must be a string.`);
    const retention = rule.cacheRetention;
    if (retention !== undefined && !CACHE_RETENTIONS.includes(retention)) {
      throw new Error(`${where}.cacheRetention must be one of ${CACHE_RETENTIONS.join(", ")}.`);
    }
    return { model: rule.model, cacheRetention: retention };
  });
}

function globToRegExp(glob: string): RegExp {
  const pattern = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}$`);
}
