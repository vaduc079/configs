// Reading an extension's JSON config file from pi's agent dir.
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** `<agent dir>/<name>.json`. The agent dir is ~/.pi/agent unless PI_CODING_AGENT_DIR moves it. */
export function configFile(name: string) {
  return path.join(getAgentDir(), `${name}.json`);
}

/**
 * The parsed JSON in `file`, or undefined when the file does not exist. The caller validates the shape.
 * The error names the file, because a load error stops pi from starting.
 */
export function readConfig(file: string): unknown {
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
