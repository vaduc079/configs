import path from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { LINES_STATUS_PREFIX } from "../../src/status.ts";

const ICON_FOLDER = "\uf07b";
const ICON_BRANCH = "\uf418";
const ICON_CONTEXT = "\u{f01bc}";
const SEP = " · ";

type Limit = { utilization: number; resetAt: number };
type Limits = { fiveHour?: Limit; sevenDay?: Limit; status?: string };

const THINKING_COLOR: Record<string, ThemeColor> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

// 5h window: hours, then minutes. 7d window: days, then hours, then minutes.
function formatCountdown(resetAt: number, useDays: boolean): string {
  const seconds = Math.max(0, resetAt - Date.now() / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600);
  if (useDays && days >= 1) return `${days}d`;
  if (hours >= 1) return `${hours}h`;
  return `${Math.floor(seconds / 60)}m`;
}

function parseLimit(headers: Record<string, string>, window: "5h" | "7d"): Limit | undefined {
  const utilization = Number(headers[`anthropic-ratelimit-unified-${window}-utilization`]);
  const resetAt = Number(headers[`anthropic-ratelimit-unified-${window}-reset`]);
  if (!Number.isFinite(utilization) || !Number.isFinite(resetAt)) return undefined;
  return { utilization, resetAt };
}

function renderModel(ctx: ExtensionContext, thinking: string, theme: Theme): string {
  const model = ctx.model;
  if (!model) return theme.fg("dim", "no model");
  const name = theme.fg("accent", model.name.replace(/^Claude /, ""));
  if (!model.reasoning) return name;
  return `${name} ${theme.fg(THINKING_COLOR[thinking] ?? "muted", thinking)}`;
}

function renderContext(ctx: ExtensionContext, theme: Theme): string | undefined {
  const usage = ctx.getContextUsage();
  if (!usage) return undefined;
  const pct = Math.round(usage.percent ?? 0);
  const barColor = pct >= 90 ? "error" : pct >= 70 ? "warning" : "success";
  const filled = Math.min(10, Math.floor(pct / 10));
  const bar = theme.fg(barColor, "█".repeat(filled)) + theme.fg("dim", "░".repeat(10 - filled));
  const tokenCount = usage.tokens ?? 0;
  const tokenColor = tokenCount >= 500_000 ? "error" : tokenCount >= 200_000 ? "warning" : "muted";
  const tokens = theme.fg(tokenColor, usage.tokens == null ? "?" : formatTokens(tokenCount));
  const label = `${theme.fg("muted", `${pct}% (`)}${tokens}${theme.fg("muted", `/${formatTokens(usage.contextWindow)})`)}`;
  return `${theme.fg("muted", ICON_CONTEXT)} ${bar} ${label}`;
}

// Cache hit rate of the latest response on the current branch, computed like pi's built-in footer:
// cacheRead / (input + cacheRead + cacheWrite). Responses with no prompt tokens (e.g. aborted) are skipped.
function renderCacheHit(ctx: ExtensionContext, theme: Theme): string | undefined {
  let entry = ctx.sessionManager.getLeafEntry();
  while (entry) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const { input, cacheRead, cacheWrite } = entry.message.usage;
      const promptTokens = input + cacheRead + cacheWrite;
      if (promptTokens > 0) {
        const hit = Math.round((cacheRead / promptTokens) * 100);
        const color = hit < 50 ? "error" : hit < 80 ? "warning" : "muted";
        return theme.fg(color, `cache ${hit}%`);
      }
    }
    entry = entry.parentId ? ctx.sessionManager.getEntry(entry.parentId) : undefined;
  }
  return undefined;
}

function renderLimits(limits: Limits, theme: Theme): string | undefined {
  const { fiveHour, sevenDay } = limits;
  if (!fiveHour || !sevenDay) return undefined;
  const blocked = limits.status !== undefined && limits.status !== "allowed";
  const part = (limit: Limit, useDays: boolean) => {
    const left = Math.round(100 - limit.utilization * 100);
    const color = blocked || left < 25 ? "error" : "warning";
    return theme.fg(color, `${formatCountdown(limit.resetAt, useDays)}:${left}%`);
  };
  return `${part(fiveHour, false)}${theme.fg("dim", " - ")}${part(sevenDay, true)}`;
}

export default function (pi: ExtensionAPI) {
  let limits: Limits = {};
  let requestRender: (() => void) | undefined;
  const rerender = () => requestRender?.();

  pi.on("after_provider_response", (event, ctx) => {
    if (ctx.model?.provider !== "anthropic") return;
    const headers = event.headers;
    const fiveHour = parseLimit(headers, "5h");
    const sevenDay = parseLimit(headers, "7d");
    if (!fiveHour && !sevenDay) return;
    limits = { fiveHour, sevenDay, status: headers["anthropic-ratelimit-unified-status"] };
    rerender();
  });

  pi.on("model_select", rerender);
  pi.on("thinking_level_select", rerender);
  pi.on("turn_end", rerender);
  pi.on("message_end", rerender);
  pi.on("agent_end", rerender);
  pi.on("session_tree", rerender);

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose() {
          unsubscribe();
          requestRender = undefined;
        },
        invalidate() { },
        render(width: number): string[] {
          const branch = footerData.getGitBranch();
          const statuses = [...footerData.getExtensionStatuses()];
          const inline = statuses.filter(([key]) => !key.startsWith(LINES_STATUS_PREFIX)).map(([, text]) => text);
          const below = statuses
            .filter(([key]) => key.startsWith(LINES_STATUS_PREFIX))
            .flatMap(([, text]) => text.split("\n"))
            .map((line) => truncateToWidth(line, width));
          const parts = [
            renderModel(ctx, pi.getThinkingLevel(), theme),
            `${theme.fg("success", ICON_FOLDER)} ${theme.fg("success", path.basename(ctx.cwd))}`,
            branch ? `${theme.fg("mdLink", ICON_BRANCH)} ${theme.fg("mdLink", branch)}` : undefined,
            renderContext(ctx, theme),
            ctx.model?.provider === "anthropic" ? renderLimits(limits, theme) : undefined,
            ...inline,
          ].filter((part): part is string => !!part);
          const left = parts.join(theme.fg("dim", SEP));
          const right = renderCacheHit(ctx, theme);
          if (!right) return [truncateToWidth(left, width), ...below];
          // Keep the right part visible; truncate the left part to make room.
          const rightWidth = visibleWidth(right);
          const leftText = truncateToWidth(left, Math.max(0, width - rightWidth - 1));
          const gap = Math.max(1, width - visibleWidth(leftText) - rightWidth);
          return [truncateToWidth(leftText + " ".repeat(gap) + right, width), ...below];
        },
      };
    });
  });
}
