import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Context file names in priority order, as in pi's own discovery (resource-loader.js). */
const NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** The realpath of `p`, or undefined when it cannot be resolved. */
export function realpath(p: string): string | undefined {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return undefined;
  }
}

/** The realpath of a `read` tool path argument, resolved like pi's read tool (`@`, `~`, `file://`). Undefined if it does not exist. */
export function resolveReadPath(input: string, cwd: string, home: string = os.homedir()): string | undefined {
  let p = input.replace(UNICODE_SPACES, " ");
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~") p = home;
  else if (p.startsWith("~/")) p = path.join(home, p.slice(2));
  else if (/^file:\/\//.test(p)) p = fileURLToPath(p);
  return realpath(path.resolve(cwd, p));
}

/** True when `target` is strictly inside `root`. Both must be absolute. */
export function isBelow(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * The realpath of the first context file in `dir`, or undefined.
 * Names must match exactly: on a case-insensitive filesystem (macOS) `stat("AGENTS.md")` also finds `agents.md`.
 */
function contextFileIn(dir: string): string | undefined {
  let entries: Set<string>;
  try {
    entries = new Set(fs.readdirSync(dir));
  } catch {
    return undefined;
  }
  for (const name of NAMES) {
    if (!entries.has(name)) continue;
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) return fs.realpathSync.native(candidate);
    } catch {
      // missing or unreadable: try the next name
    }
  }
  return undefined;
}

/**
 * Context files in the folders from `file`'s folder up to `root` (exclusive), outermost first.
 * `file` and `root` are realpaths. `file` itself is excluded; `root` and its ancestors are never searched.
 */
export function findContextFiles(file: string, root: string): string[] {
  const found: string[] = [];
  for (let dir = path.dirname(file); isBelow(dir, root); dir = path.dirname(dir)) {
    const hit = contextFileIn(dir);
    if (hit && hit !== file) found.unshift(hit);
  }
  return found;
}

