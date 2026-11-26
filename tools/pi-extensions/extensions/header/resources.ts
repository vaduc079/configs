// pi keeps its loaded resources to itself, so the header resolves them from disk the way pi does.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DefaultPackageManager,
  getAgentDir,
  loadProjectContextFiles,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface ResourceCounts {
  contexts: number;
  skills: number;
  extensions: number;
}

/** Extensions passed with `-e` and flags such as `--no-skills` are not reflected. */
export async function countResources(ctx: ExtensionContext): Promise<ResourceCounts> {
  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  // pi reads project settings, resources and prompt files only once the project is trusted.
  const projectTrusted = ctx.isProjectTrusted();
  const dirs = projectTrusted ? [agentDir, join(cwd, ".pi")] : [agentDir];

  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager, commandOutput: "capture" });
  const resolved = await packageManager.resolve(() => Promise.resolve("skip"));

  // pi loads one file per name, the project copy over the global one.
  const promptFiles = ["SYSTEM.md", "APPEND_SYSTEM.md"].filter((file) => dirs.some((dir) => existsSync(join(dir, file))));

  return {
    contexts: loadProjectContextFiles({ cwd, agentDir }).length + promptFiles.length,
    skills: resolved.skills.filter((skill) => skill.enabled).length,
    extensions: resolved.extensions.filter((extension) => extension.enabled).length,
  };
}

export function formatCounts(counts: ResourceCounts): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    count(counts.contexts, "context"),
    count(counts.skills, "skill"),
    count(counts.extensions, "extension"),
  ].join(" · ");
}
