import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { directiveProblem } from "./plugin.ts";

const ROOT_ENTRIES = new Set([
  "AGENTS.md",
  "extensions",
  "knip.json",
  "lint",
  "node_modules",
  "package-lock.json",
  "package.json",
  "scripts",
  "src",
  "tsconfig.json",
]);

export function structureProblems(root: string): string[] {
  const extensions = fs.readdirSync(path.join(root, "extensions"), { withFileTypes: true });
  const folders = extensions.filter((e) => e.isDirectory()).map((e) => e.name);
  const strays = fs.readdirSync(root).filter((entry) => !ROOT_ENTRIES.has(entry) && !entry.startsWith("."));
  return [
    ...strays.map((entry) => `${entry}: not part of the package layout (AGENTS.md "Structure")`),
    ...extensions.filter((e) => !e.isDirectory()).map((e) => `extensions/${e.name}: extensions/ holds one folder per extension`),
    ...folders
      .filter((name) => !fs.existsSync(path.join(root, "extensions", name, "index.ts")))
      .map((name) => `extensions/${name}: missing index.ts, the entry pi loads`),
    ...testFolders(root).map((dir) => `${dir}: put tests next to the module they test (x.test.ts beside x.ts)`),
    ...directiveProblems(root),
    ...unusedSrc(root).map((module) => `${module}: no extension uses it; delete it or move it into the extension that needs it`),
  ];
}

/**
 * Lint directives oxlint cannot police: a directive naming `local/disable-reason` switches that check off.
 * Scans every line for a directive token wherever it sits (inner line of a block comment, after code, after a
 * string holding `//`), so a directive inside a string is reported too; delete it or reword it.
 * The token must end at whitespace, line end or `*` + `/`, so prose such as `eslint-disable`; is not a directive.
 * Scans every file oxlint lints (.js, .ts, .mts, ...), not only .ts. Skips the root lint/*.test.ts, whose fixtures hold directive text in strings; `local/disable-reason` still checks their real comments.
 */
function directiveProblems(root: string) {
  const token = /\b(?:oxlint|eslint)-(?:disable|enable)(?:-next-line|-line)?(?=\s|$|\*\/)/g;
  return ["extensions", "src", "lint", "scripts"]
    .flatMap((dir) => sourceFiles(path.join(root, dir)))
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !/^lint[\\/][^\\/]*\.test\.ts$/.test(path.relative(root, file)))
    .flatMap((file) =>
      fs.readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
        [...line.matchAll(token)].flatMap((match) => {
          const problem = directiveProblem(line.slice(match.index).replace(/\*\/.*$/, ""));
          return problem ? [`${path.relative(root, file)}:${index + 1}: ${problem}`] : [];
        }),
      ),
    );
}

function testFolders(root: string) {
  return ["extensions", "src"]
    .flatMap((dir) => allEntries(path.join(root, dir)))
    .filter((entry) => entry.isDirectory() && entry.name === "test")
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
}

/** Non-test modules in src/ that no extension reaches through its imports. */
function unusedSrc(root: string) {
  const src = path.join(root, "src");
  const extensionFiles = sourceFiles(path.join(root, "extensions")).filter((file) => !file.endsWith(".test.ts"));
  const reached = reachableSrc(extensionFiles, src);
  return sourceFiles(src)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !reached.has(file))
    .map((file) => path.relative(root, file));
}

function reachableSrc(start: string[], src: string) {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    importsOf(file)
      .filter((target) => target.startsWith(src + path.sep) && !seen.has(target))
      .forEach((target) => {
        seen.add(target);
        visit(target);
      });
  };
  start.forEach(visit);
  return seen;
}

function importsOf(file: string) {
  if (!fs.existsSync(file) || !/\.(ts|js)$/.test(file)) return [];
  const { importedFiles } = ts.preProcessFile(fs.readFileSync(file, "utf8"), true, true);
  return importedFiles
    .filter(({ fileName }) => fileName.startsWith("."))
    .map(({ fileName }) => path.resolve(path.dirname(file), fileName));
}

function allEntries(dir: string) {
  return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }) : [];
}

function sourceFiles(dir: string) {
  return allEntries(dir)
    .filter((entry) => !entry.isDirectory())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

if (import.meta.main) {
  const problems = structureProblems(path.resolve(import.meta.dirname, ".."));
  problems.forEach((problem) => console.error(problem));
  process.exitCode = problems.length > 0 ? 1 : 0;
}
