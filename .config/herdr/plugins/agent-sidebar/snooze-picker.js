#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { durationDeadline, tomorrowAt } from "./core.js";

const paneId = process.env.HERDR_SNOOZE_TARGET;
const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR || join(process.env.HOME, ".config/herdr/plugins/local.agent-sidebar");
const defaultConfig = { tomorrow_time: "09:00" };

function loadConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")) };
  } catch {
    return defaultConfig;
  }
}

function choose(config) {
  const choices = [
    "1 hour",
    "3 hours",
    `Tomorrow at ${config.tomorrow_time}`,
    "Custom hours...",
  ];
  const result = spawnSync("fzf", ["--prompt", "snooze> ", "--height", "100%", "--layout", "reverse"], {
    input: `${choices.join("\n")}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

async function customHours() {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = await input.question("Snooze for how many hours? ");
    const hours = Number(value.trim());
    if (!Number.isFinite(hours) || hours <= 0) throw new Error("Hours must be a positive number");
    return hours;
  } finally {
    input.close();
  }
}

async function deadline(choice, config) {
  const now = new Date();
  if (choice === "1 hour") return durationDeadline(now.getTime(), 1);
  if (choice === "3 hours") return durationDeadline(now.getTime(), 3);
  if (choice.startsWith("Tomorrow at ")) return tomorrowAt(now, config.tomorrow_time).getTime();
  if (choice === "Custom hours...") return durationDeadline(now.getTime(), await customHours());
  return null;
}

async function main() {
  if (!paneId) throw new Error("Missing target pane");
  const config = loadConfig();
  const choice = choose(config);
  if (!choice) return;

  const untilMs = await deadline(choice, config);
  if (!untilMs) return;

  const result = spawnSync("bun", [join(import.meta.dir, "sidebar.js"), "set-snooze", paneId, String(untilMs)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to snooze agent");

  console.log(`\nSnoozed until ${new Date(untilMs).toLocaleString()}`);
  await Bun.sleep(900);
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  await Bun.sleep(1400);
  process.exitCode = 1;
}
