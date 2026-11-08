/** What the user sees: the running list under the status line, result messages, the /subagents command, and children's dialogs (dialogs.ts). */
import { type ExtensionAPI, type ExtensionContext, getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { collapsibleRow } from "../../src/collapsible-row.ts";
import { formatDuration } from "../../src/format.ts";
import { RunningList } from "../../src/running-list.ts";
import { DialogForwarder } from "./dialogs.ts";
import type { Subagents } from "./manager.ts";
import { blockBody, RESULT_TYPE, type ResultDetails } from "./result.ts";
import type { Subagent } from "./subagent.ts";

/** UI bound to one session's context: the running-children list and forwarded dialogs. */
export class SessionUi {
  private readonly runningList: RunningList;
  readonly dialogs: DialogForwarder;

  constructor(ctx: ExtensionContext, list: () => Subagent[]) {
    this.dialogs = new DialogForwarder(ctx.ui, ctx.hasUI);
    this.runningList = new RunningList(ctx.ui, "subagents", () =>
      list()
        .filter((subagent) => subagent.state === "running")
        .map((subagent) => ({
          label: `${subagent.agent.name} · "${subagent.description}" · ${modelLabel(subagent)}`,
          startedAt: subagent.runStartedAt,
        })),
    );
  }

  renderRunningList() {
    this.runningList.render();
  }

  dispose() {
    this.runningList.dispose();
    this.dialogs.dispose();
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
 * A result shows as one row in the style of a quiet tool row: `▸ subagent general "<description>"  ✓ 1m 2s`.
 * Click it, or press ctrl+o, to see the usage, sessionID, and the child's response. Errors also show a short preview.
 */
export function registerResultRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer<ResultDetails>(RESULT_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details;
    const content = typeof message.content === "string" ? message.content : "";
    if (!details) return new Text(theme.fg("muted", content), 0, 0);

    const body = blockBody(content);
    return collapsibleRow({
      message,
      expanded,
      outputPad,
      background: (text) => theme.bg(details.state === "completed" ? "toolSuccessBg" : "toolErrorBg", text),
      fill: (box, open) => {
        box.addChild(new Text(resultHeader(details, open, theme), 0, 0));
        if (open) {
          box.addChild(new Text(theme.fg("dim", `sessionID: ${details.sessionID}`), 0, 0));
          box.addChild(new Markdown(body, 0, 0, getMarkdownTheme()));
        } else if (details.state === "error") {
          box.addChild(new Text(theme.fg("toolOutput", body.split("\n").slice(0, 3).join("\n")), 0, 0));
        }
      },
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
