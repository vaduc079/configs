/** Agent definitions: `agents/*.md` next to this file, YAML-style frontmatter plus the system prompt. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type Agent = {
  name: string;
  description: string;
  /** Passed to the child's `--tools`; omitted means the parent's defaults. */
  tools?: string;
  systemPrompt: string;
};

const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "agents");

export function loadAgents(dir = AGENTS_DIR): Agent[] {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) throw new Error(`Subagent definition ${file} has no frontmatter.`);
      const fields = Object.fromEntries(
        match[1].split("\n").flatMap((line) => {
          const colon = line.indexOf(":");
          return colon > 0 ? [[line.slice(0, colon).trim(), line.slice(colon + 1).trim()]] : [];
        }),
      );
      if (!fields.name || !fields.description) throw new Error(`Subagent definition ${file} needs name and description.`);
      return { name: fields.name, description: fields.description, tools: fields.tools, systemPrompt: match[2].trim() };
    });
}
