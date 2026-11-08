import { readFileSync } from "node:fs";
import type { Check, Decision, Effect, Rule } from "./types.ts";

// match/evaluate semantics adapted from OpenCode (MIT): packages/core/src/util/wildcard.ts, permission.ts.

const EFFECTS: readonly string[] = ["allow", "ask", "deny"];
const HOME_ACTIONS = new Set(["read", "edit", "external_directory"]);

/** `*` any run (including `/`), `?` one char, trailing " *" optional. Posix only. */
export function match(input: string, pattern: string): boolean {
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?";
  return new RegExp("^" + escaped + "$", "s").test(input);
}

/** Expand a leading `~`, `~/`, `$HOME`, `$HOME/`, `${HOME}` or `${HOME}/`. */
export function expandHome(resource: string, home: string): string {
  if (resource === "~" || resource === "$HOME" || resource === "${HOME}") return home;
  if (resource.startsWith("~/")) return home + resource.slice(1);
  if (resource.startsWith("$HOME/")) return home + resource.slice(5);
  if (resource.startsWith("${HOME}/")) return home + resource.slice(7);
  return resource;
}

export function parseRules(text: string, home: string): Rule[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`permissions: invalid JSON: ${(e as Error).message}`, { cause: e });
  }
  const list = (data as { permissions?: unknown } | null)?.permissions;
  if (!Array.isArray(list)) throw new Error('permissions: expected {"permissions": [...]}');
  return list.map((raw: unknown, i): Rule => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`permissions[${i}]: must be an object`);
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.action !== "string") throw new Error(`permissions[${i}]: "action" must be a string`);
    if (typeof r.resource !== "string") throw new Error(`permissions[${i}]: "resource" must be a string`);
    if (typeof r.effect !== "string" || !EFFECTS.includes(r.effect)) {
      throw new Error(`permissions[${i}]: "effect" must be one of allow, ask, deny`);
    }
    if (r.reason !== undefined && typeof r.reason !== "string") {
      throw new Error(`permissions[${i}]: "reason" must be a string`);
    }
    const resource = HOME_ACTIONS.has(r.action) ? expandHome(r.resource, home) : r.resource;
    const rule: Rule = { action: r.action, resource, effect: r.effect as Effect };
    if (r.reason !== undefined) rule.reason = r.reason;
    if (r.input !== undefined) rule.input = parseInput(r.input, r.effect, i);
    return rule;
  });
}

/** `{field: pattern | [patterns]}` → `{field: [patterns]}`. Allow rules only: on a deny rule, an input the patterns miss would skip the deny. */
function parseInput(raw: unknown, effect: string, i: number): Record<string, string[]> {
  if (effect !== "allow") throw new Error(`permissions[${i}]: "input" is only allowed on allow rules`);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length === 0) {
    throw new Error(`permissions[${i}]: "input" must be a non-empty object`);
  }
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => {
      const patterns: unknown = typeof value === "string" ? [value] : value;
      const valid = Array.isArray(patterns) && patterns.length > 0 && patterns.every((p): p is string => typeof p === "string");
      if (!valid) throw new Error(`permissions[${i}]: "input.${key}" must be a string or a non-empty array of strings`);
      return [key, patterns];
    }),
  );
}

function inputMatches(patterns: Record<string, string[]>, input: Record<string, unknown>): boolean {
  return Object.entries(patterns).every(([key, list]) => {
    const value = input[key];
    return typeof value === "string" && list.some((p) => match(value, p));
  });
}

export function loadRules(file: string, home: string): Rule[] {
  let text: string;
  // fs boundary: the error names the file
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`permissions: cannot read ${file}: ${(e as Error).message}`, { cause: e });
  }
  return parseRules(text, home);
}

/** Last rule where action, resource and (if set) input all match; none → ask. */
export function evaluate(action: string, resource: string, rules: Rule[], input: Record<string, unknown> = {}): Rule {
  const rule = rules.findLast(
    (r) => match(action, r.action) && match(resource, r.resource) && (r.input === undefined || inputMatches(r.input, input)),
  );
  return rule ?? { action, resource: "*", effect: "ask" };
}

export function decide(checks: Check[], rules: Rule[], input: Record<string, unknown> = {}): Decision {
  let ask: Decision | undefined;
  for (const check of checks) {
    for (const resource of check.resources) {
      const rule = evaluate(check.action, resource, rules, input);
      if (rule.effect === "deny") return { effect: "deny", rule, check, resource };
      if (rule.effect === "ask" && !check.denyOnly && !ask) ask = { effect: "ask", rule, check, resource };
    }
  }
  return ask ?? { effect: "allow" };
}
