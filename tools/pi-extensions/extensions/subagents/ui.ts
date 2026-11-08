/** What the user sees: the running list under the status line, result messages, the /subagents command, and children's dialogs (dialogs.ts). */
import { type ExtensionAPI, type ExtensionContext, getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, MouseRegion, Text } from "@earendil-works/pi-tui";
import { DialogForwarder } from "./dialogs.ts";
import type { Subagents } from "./manager.ts";
import { blockBody, RESULT_TYPE, type ResultDetails } from "./result.ts";
import type { Subagent } from "./subagent.ts";

/** pi-statusline draws this status as lines below the status line; pi's built-in footer shows it on one line. */
const STATUS_KEY = "subagents";

/** UI bound to one session's context: the running-children list and forwarded dialogs. */
export class SessionUi {
  private readonly ctx: ExtensionContext;
  private readonly list: () => Subagent[];
  private listTimer: NodeJS.Timeout | undefined;
  /** Children exit after session shutdown; their callbacks must not touch the old context. */
  private disposed = false;
  readonly dialogs: DialogForwarder;

  constructor(ctx: ExtensionContext, list: () => Subagent[]) {
    this.ctx = ctx;
    this.list = list;
    this.dialogs = new DialogForwarder(ctx.ui, ctx.hasUI);
  }

  renderRunningList() {
    if (this.disposed) return;
    const running = this.list().filter((subagent) => subagent.state === "running");
    if (running.length === 0) {
      this.ctx.ui.setStatus(STATUS_KEY, undefined);
      clearInterval(this.listTimer);
      this.listTimer = undefined;
      return;
    }
    // Redraw every second for the elapsed time.
    this.listTimer ??= setInterval(() => this.renderRunningList(), 1_000);
    const lines = running.map((subagent, index) => {
      const seconds = Math.floor((Date.now() - subagent.runStartedAt) / 1000);
      const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`;
      const branch = index === running.length - 1 ? "└──" : "├──";
      // Styled per line: the footer draws them as separate lines. The tree is bold so it stands out from the dim text.
      const { theme } = this.ctx.ui;
      return `${theme.bold(branch)} ${theme.fg("dim", `${subagent.agent.name} · "${subagent.description}" · ${modelLabel(subagent)} · ${elapsed}`)}`;
    });
    this.ctx.ui.setStatus(STATUS_KEY, lines.join("\n"));
  }

  dispose() {
    this.disposed = true;
    this.dialogs.dispose();
    clearInterval(this.listTimer);
  }
}

/**
 * `Opus 5.5 high`, like pi-statusline's model part; `Opus 5.5 thinking off` when off, since a bare `off` reads oddly.
 * Until the child reports it, the requested model and level.
 */
export function modelLabel(subagent: Subagent) {
  const { model, effective } = subagent;
  const name = effective ? effective.model.replace(/^Claude /, "") : model.id;
  const thinking = effective ? effective.thinking : model.thinking;
  if (!thinking) return name;
  return thinking === "off" ? `${name} thinking off` : `${name} ${thinking}`;
}

/**
 * Rows the user clicked open or shut, with the ctrl+o state at that time. pi rebuilds the row on ctrl+o and on
 * resize; a click survives a resize, and ctrl+o overrides it, as it does for tool rows.
 */
const clicks = new WeakMap<object, { open: boolean; expanded: boolean }>();

/**
 * A result shows as one row in the style of a quiet tool row: `▸ subagent general "<description>"  ✓ 1m 2s`.
 * Click it, or press ctrl+o, to see the usage, sessionID, and the child's response. Errors also show a short preview.
 */
export function registerResultRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer<ResultDetails>(RESULT_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details;
    const content = typeof message.content === "string" ? message.content : "";
    if (!details) return new Text(theme.fg("muted", content), 0, 0);

    const body = blockBody(content);
    // Match tool rows, which pad by the outputPad setting.
    const box = new Box(outputPad, 1, (text) => theme.bg(details.state === "completed" ? "toolSuccessBg" : "toolErrorBg", text));
    // ctrl+o was pressed since the click.
    if (clicks.get(message)?.expanded !== expanded) clicks.delete(message);
    const isOpen = () => clicks.get(message)?.open ?? expanded;
    const fill = () => {
      const open = isOpen();
      box.clear();
      box.addChild(new Text(resultHeader(details, open, theme), 0, 0));
      if (open) {
        box.addChild(new Text(theme.fg("dim", `sessionID: ${details.sessionID}`), 0, 0));
        box.addChild(new Markdown(body, 0, 0, getMarkdownTheme()));
      } else if (details.state === "error") {
        box.addChild(new Text(theme.fg("toolOutput", body.split("\n").slice(0, 3).join("\n")), 0, 0));
      }
    };
    fill();
    return new MouseRegion(box, (event) => {
      if (event.type !== "click" || event.button !== "left") return undefined;
      clicks.set(message, { open: !isOpen(), expanded });
      fill();
      return { handled: true };
    });
  });
}

function resultHeader(details: ResultDetails, open: boolean, theme: Theme) {
  const head = `${theme.fg("muted", open ? "▾ " : "▸ ")}${theme.fg("toolTitle", "subagent")} ${theme.fg("dim", `${details.agent} "${details.description}"`)}`;
  const duration = ` ${formatDuration(details.durationMs)}`;
  const status =
    details.state === "completed"
      ? theme.fg("success", "✓") + theme.fg("muted", duration)
      : theme.fg("error", "✗") + theme.fg("muted", ` ${details.state}${duration}`);
  const { turns, input, output, cost } = details.usage;
  const usage = open ? theme.fg("dim", ` · ${turns} turns ↑${input} ↓${output} $${cost.toFixed(4)}`) : "";
  return `${head}  ${status}${usage}`;
}

/** Same format as pi-tools-verbose-low's tool rows. */
function formatDuration(ms: number) {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

export function registerSubagentsCommand(pi: ExtensionAPI, current: () => Subagents, sessionDir: string) {
  pi.registerCommand("subagents", {
    description: "List this session's subagents, then message, abort, or inspect one",
    handler: async (_args, ctx) => {
      const subagents = current();
      const all = subagents.list();
      if (all.length === 0) {
        ctx.ui.notify("No subagents in this session.", "info");
        return;
      }
      const labels = all.map(
        (subagent) => `${subagent.agent.name} · "${subagent.description}" · ${subagent.state} · ${subagent.id.slice(0, 8)}`,
      );
      const picked = await ctx.ui.select("Subagents", labels);
      if (!picked) return;
      const subagent = all[labels.indexOf(picked)];

      const action = await ctx.ui.select(`${subagent.agent.name} · "${subagent.description}"`, [
        "Send message",
        "Abort",
        "Show session",
      ]);
      if (action === "Show session") {
        ctx.ui.notify(`sessionID ${subagent.id}\nOpen it with: pi --session ${subagent.id} --session-dir ${sessionDir}`, "info");
        return;
      }
      if (action === "Abort") {
        if (subagent.state !== "running") {
          ctx.ui.notify("That subagent is not running.", "warning");
          return;
        }
        await subagents.abort(subagent.id);
        return;
      }
      if (action !== "Send message") return;
      const text = await ctx.ui.input(`Message to "${subagent.description}"`);
      if (!text) return;
      const outcome = await subagents.message(subagent.id, text, subagent.model);
      ctx.ui.notify(`Subagent ${outcome}.`, "info");
    },
  });
}
