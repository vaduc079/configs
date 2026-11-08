// The package's import boundaries, checked by the `local/boundaries` rule in plugin.ts. See AGENTS.md "Structure".
import { builtinModules } from "node:module";
import path from "node:path";
import packageJson from "../package.json" with { type: "json" };

const ROOT = path.resolve(import.meta.dirname, "..");

/** Provided by pi at runtime; linked into node_modules by `npm run link-pi`, never installed. */
export const HOST_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
];

type Area = { kind: "extension"; name: string } | { kind: "src" } | { kind: "tooling" } | { kind: "outside" };

function areaOf(file: string): Area {
  const parts = path.relative(ROOT, file).split(path.sep);
  if (parts[0] === "..") return { kind: "outside" };
  if (parts[0] === "extensions" && parts.length > 2) return { kind: "extension", name: parts[1] };
  if (parts[0] === "src") return { kind: "src" };
  return { kind: "tooling" };
}

/** Why `file` may not import `source`, or undefined when it may. */
export function importProblem(file: string, source: string): string | undefined {
  const from = areaOf(file);
  if (source.startsWith("node:")) return undefined;
  if (!source.startsWith(".")) return packageProblem(from, source);
  if (!/\.(ts|js|json)$/.test(source)) return "Relative imports need the file extension: Node and pi load the path as written.";

  const to = areaOf(path.resolve(path.dirname(file), source));
  if (to.kind === "outside") return "Imports must stay inside the pi-extensions package.";
  if (from.kind === "tooling") return undefined;
  if (from.kind === "src" && to.kind === "extension") return "src/ must not import from extensions/: shared code cannot depend on one extension.";
  if (to.kind === "tooling") return "Extensions and src/ import only their own folder, src/, and packages.";
  if (from.kind === "extension" && to.kind === "extension" && from.name !== to.name) {
    return `extensions/${from.name} must not import extensions/${to.name}. Move code that 2+ extensions use to src/.`;
  }
  return undefined;
}

function packageProblem(from: Area, source: string) {
  const name = source.startsWith("@") ? source.split("/").slice(0, 2).join("/") : source.split("/")[0];
  if (builtinModules.includes(name)) return `Use "node:${source}" for Node built-ins.`;
  const devDependencies = Object.keys(packageJson.devDependencies);
  if (HOST_PACKAGES.includes(name)) return undefined;
  if (from.kind === "tooling" && devDependencies.includes(name)) return undefined;
  return `"${name}" is not available to extensions: use pi's host packages or node: built-ins.`;
}
