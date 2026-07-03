#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

const DEFAULT_CELL_HEIGHT_WIDTH_RATIO = 2;
const CONTROLLED_PROCESS_PATTERN =
  /^g?\.?(view|l?n?vim?x?|fzf|lumen|lazygit)(diff)?(-wrapped)?$/i;

const DIRECTION_KEYS = {
  left: "ctrl+h",
  down: "ctrl+j",
  up: "ctrl+k",
  right: "ctrl+l",
};

function runHerdr(args) {
  const herdr = process.env.HERDR_BIN_PATH || "herdr";
  const result = spawnSync(herdr, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`${herdr} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }

  return result.stdout.trim();
}

function herdrJson(args) {
  const output = runHerdr(args);
  if (!output) throw new Error(`herdr ${args.join(" ")} returned no output`);
  return JSON.parse(output);
}

export function splitDirection(width, height, cellHeightWidthRatio) {
  const pixelAdjustedHeight = height * cellHeightWidthRatio;
  return pixelAdjustedHeight > width ? "down" : "right";
}

export function cellHeightWidthRatio(value) {
  if (value == null || value === "") return DEFAULT_CELL_HEIGHT_WIDTH_RATIO;

  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(`invalid HERDR_SMART_SPLIT_CELL_RATIO: ${value}`);
  }

  return ratio;
}

export function processControlsNavigation(processes) {
  return processes.some((process) => {
    const name = String(process?.name || "");
    return CONTROLLED_PROCESS_PATTERN.test(name);
  });
}

function requiredPaneId() {
  const paneId = process.env.HERDR_PANE_ID?.trim();
  if (!paneId) throw new Error("HERDR_PANE_ID is unavailable");
  return paneId;
}

function findPane(layout, paneId) {
  const pane = layout?.panes?.find((candidate) => candidate?.pane_id === paneId);
  if (!pane) throw new Error(`layout for Herdr pane ${paneId} not found`);
  return pane;
}

function smartSplit() {
  const paneId = requiredPaneId();
  const response = herdrJson(["pane", "layout", "--pane", paneId]);
  const pane = findPane(response?.result?.layout, paneId);
  const width = Number(pane?.rect?.width);
  const height = Number(pane?.rect?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`layout for Herdr pane ${paneId} has invalid dimensions`);
  }

  const ratio = cellHeightWidthRatio(process.env.HERDR_SMART_SPLIT_CELL_RATIO);
  const direction = splitDirection(width, height, ratio);
  runHerdr(["pane", "split", paneId, "--direction", direction, "--focus"]);
}

function navigate(direction) {
  const key = DIRECTION_KEYS[direction];
  if (!key) throw new Error(`invalid navigation direction: ${direction || "<empty>"}`);

  const paneId = requiredPaneId();
  const response = herdrJson(["pane", "process-info", "--pane", paneId]);
  const processes = response?.result?.process_info?.foreground_processes || [];

  if (processControlsNavigation(processes)) {
    runHerdr(["pane", "send-keys", paneId, key]);
    return;
  }

  runHerdr(["pane", "focus", "--direction", direction, "--pane", paneId]);
}

function main(args) {
  const [action, direction] = args;

  if (action === "smart-split") {
    smartSplit();
    return;
  }

  if (action === "navigate") {
    navigate(direction);
    return;
  }

  throw new Error("usage: pane-actions.js <smart-split|navigate DIRECTION>");
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
