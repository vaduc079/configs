/**
 * Replaces pi's startup header: optional art on the left, and beside it the version, an optional
 * greeting, the cwd, and counts of loaded contexts, skills and extensions.
 *
 * Config, ~/.pi/agent/header.json (all optional):
 * {
 *   "art": "pokemon-colorscripts --no-title -r",
 *   "greeting": "Hi Duc, what are we building today?"
 * }
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sep } from "node:path";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import { countResources, formatCounts } from "./resources.ts";

const GAP = "   ";
const ART_TIMEOUT_MS = 2000;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const config = loadConfig();

    const art = config.art ? await runArt(pi, config.art, ctx.cwd) : [];
    if (art === undefined) ctx.ui.notify(`header: \`${config.art}\` failed; showing the header without art`, "warning");
    const counts = formatCounts(await countResources(ctx));

    const home = process.env.HOME;
    const inHome = home !== undefined && (ctx.cwd === home || ctx.cwd.startsWith(home + sep));
    const cwd = inHome ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd;

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        const info = [
          `${theme.bold(theme.fg("accent", "Pi"))} ${theme.fg("dim", `v${VERSION}`)}`,
          ...(config.greeting ? [theme.fg("accent", config.greeting)] : []),
          theme.fg("dim", cwd),
          theme.fg("dim", counts),
        ];
        return ["", ...besides(art ?? [], info, width).map((line) => truncateToWidth(line, width))];
      },
      invalidate() {},
    }));
  });
}

async function runArt(pi: ExtensionAPI, command: string, cwd: string): Promise<string[] | undefined> {
  const result = await pi.exec("/bin/sh", ["-c", command], { cwd, timeout: ART_TIMEOUT_MS });
  // A command that traps SIGTERM can exit 0 after the timeout kills it.
  if (result.code !== 0 || result.killed) return undefined;
  const lines = result.stdout.split("\n").map((line) => line.trimEnd());
  const first = lines.findIndex((line) => visibleWidth(line) > 0);
  if (first === -1) return [];
  const last = lines.findLastIndex((line) => visibleWidth(line) > 0);
  return lines.slice(first, last + 1);
}

/** Drops the art when it would push the text past `width`: the text is what the header is for. */
export function besides(art: string[], info: string[], width: number): string[] {
  const artWidth = Math.max(0, ...art.map((line) => visibleWidth(line)));
  const infoWidth = Math.max(0, ...info.map((line) => visibleWidth(line)));
  if (artWidth === 0 || artWidth + GAP.length + infoWidth > width) return info;
  const top = Math.max(0, Math.floor((art.length - info.length) / 2));
  return Array.from({ length: Math.max(art.length, info.length) }, (_, i) => {
    const line = art[i] ?? "";
    return `${line}${" ".repeat(artWidth - visibleWidth(line))}${GAP}${info[i - top] ?? ""}`.trimEnd();
  });
}
