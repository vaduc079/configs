import { globSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandHome } from "./rules.ts";
import type { Check, Location, ShellParse } from "./types.ts";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function field(input: unknown, key: string): string {
  return input !== null && typeof input === "object" ? str((input as Record<string, unknown>)[key]) : "";
}

function absolute(p: string, loc: Location): string {
  return path.resolve(loc.cwd, expandHome(p, loc.home));
}

function isDirectory(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false; // missing path
  }
}

/** [relative-to-cwd, absolute], deduped; plus `abs/` for an existing directory so `<dir>/*` rules match the directory itself. */
function forms(abs: string, loc: Location): string[] {
  const rel = path.relative(loc.cwd, abs).split(path.sep).join("/") || ".";
  const out = [rel, abs];
  if (isDirectory(abs)) out.push(abs === "/" ? abs : abs + "/");
  return [...new Set(out)];
}

function within(abs: string, base: string): boolean {
  return abs === base || abs.startsWith(base.endsWith("/") ? base : base + "/");
}

function isOutside(abs: string, loc: Location): boolean {
  return !within(abs, loc.cwd) && !(loc.root !== undefined && within(abs, loc.root));
}

function externalCheck(abs: string): Check {
  const dir = isDirectory(abs) ? abs : path.dirname(abs);
  return { action: "external_directory", resources: [`${dir}/*`] };
}

/** A file-tool path as pi reads it: Unicode spaces, one leading "@", "~", then a file:// URL. Shell words are not normalised this way. Also expands `$HOME/`, which pi does not; that can only over-deny. */
function toolPath(p: string, loc: Location): string {
  let s = p.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
  if (s.startsWith("@")) s = s.slice(1);
  s = expandHome(s, loc.home);
  return /^file:\/\//.test(s) ? fileURLToPath(s) : s;
}

const GLOB = /[*?[{]/;
const MAX_GLOB_MATCHES = 200;

/** The word itself plus what bash would expand it to. Never throws; no match or an error leaves the word alone. */
function expandWord(w: string, loc: Location): string[] {
  const out = [w];
  // a bash brace range ({1..100000}, {a..z}, {1..9..2}) expands to one pattern per value before globSync touches the disk, so leave it alone;
  // other `..` inside braces (`{.env,../x}`) is a path and still gets expanded
  if (!GLOB.test(w) || /\{(?:-?\d+|[A-Za-z])\.\.(?:-?\d+|[A-Za-z])(?:\.\.-?\d+)?\}/.test(w)) return out;
  try {
    // bash 3.2 (pi's shell) has no globstar, so a run of two or more * means *; globSync would walk the whole tree
    const pattern = expandHome(w, loc.home).replace(/\*{2,}/g, "*");
    for (const m of globSync(pattern, { cwd: loc.cwd })) {
      out.push(m);
      if (out.length > MAX_GLOB_MATCHES) break;
    }
  } catch {
    // bad pattern or unreadable directory: keep the literal word only
  }
  return out;
}

function pathChecks(action: string, p: string, loc: Location): Check[] {
  const abs = path.resolve(loc.cwd, toolPath(p, loc));
  const checks: Check[] = [];
  if (isOutside(abs, loc)) checks.push(externalCheck(abs));
  checks.push({ action, resources: forms(abs, loc) });
  return checks;
}

export function classify(
  toolName: string,
  input: unknown,
  loc: Location,
  parseShell: (command: string) => ShellParse,
): Check[] {
  switch (toolName) {
    case "read":
    case "grep":
    case "find":
    case "ls":
      return pathChecks("read", field(input, "path"), loc);
    case "write":
    case "edit":
      return pathChecks("edit", field(input, "path"), loc);
    case "bash": {
      const parsed = parseShell(field(input, "command"));
      const checks: Check[] = [];
      for (const dir of parsed.directories) {
        const abs = absolute(dir, loc);
        if (isOutside(abs, loc)) checks.push(externalCheck(abs));
      }
      if (parsed.commands.length > 0) checks.push({ action: "shell", resources: parsed.commands });
      const words = [...new Set(parsed.pathWords.flatMap((w) => expandWord(w, loc).flatMap((x) => forms(absolute(x, loc), loc))))];
      if (words.length > 0) {
        checks.push({ action: "read", resources: words, denyOnly: true });
        checks.push({ action: "edit", resources: words, denyOnly: true });
      }
      return checks;
    }
    case "codemode":
      return [];
    default:
      return [{ action: toolName, resources: ["*"] }];
  }
}
