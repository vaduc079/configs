import { configFile, readConfig } from "../../src/config.ts";

export interface Config {
  /** Shell command whose stdout (ANSI colours allowed) is drawn left of the info. */
  art?: string;
  greeting?: string;
}

export function loadConfig(): Config {
  const file = configFile("header");
  const raw = readConfig(file);
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${file}: expected a JSON object.`);
  const { art, greeting } = raw as Record<string, unknown>;
  if (art !== undefined && typeof art !== "string") throw new Error(`${file}: "art" must be a shell command string.`);
  if (greeting !== undefined && typeof greeting !== "string") throw new Error(`${file}: "greeting" must be a string.`);
  return { art, greeting };
}
