/** What the user sees: the running list under the status line, result messages, the /subagents command, and children's dialogs (dialogs.ts). */
import {
  copyToClipboard,
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { collapsibleRow } from "../../src/collapsible-row.ts";
import { formatDuration, formatElapsed } from "../../src/format.ts";
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
          name: subagent.agent.name,
          label: `"${subagent.description}" · ${modelLabel(subagent)}`,
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
    description: "List this session's subagents; abort one or copy the command that opens its session",
    handler: async (_args, ctx) => {
      const subagents = current();
      if (subagents.list().length === 0) {
        ctx.ui.notify("No subagents in this session.", "info");
        return;
      }
      await ctx.ui.custom<void>(
        (tui, theme, keybindings, done) =>
          new SubagentList({
            subagents,
            theme,
            keybindings,
            openCommand: (id) => `pi --session ${id} --session-dir ${sessionDir}`,
            copy: copyToClipboard,
            requestRender: () => tui.requestRender(),
            done,
          }),
      );
    },
  });
}

type SubagentListOptions = {
  subagents: Pick<Subagents, "list" | "abort">;
  theme: Theme;
  keybindings: Pick<KeybindingsManager, "matches">;
  openCommand: (id: string) => string;
  copy: (text: string) => Promise<void>;
  requestRender: () => void;
  done: () => void;
};

/**
 * The `/subagents` screen: one row per child, running first, then newest first. `x` aborts the selected running child,
 * `c` copies the command that opens its session, Esc closes. Redrawn every second so running times tick.
 */
export class SubagentList implements Component {
  private readonly options: SubagentListOptions;
  /** By ID, not index: rows move when a child starts or finishes. */
  private selectedId: string | undefined;
  private notice = "";
  private readonly timer: NodeJS.Timeout;

  constructor(options: SubagentListOptions) {
    this.options = options;
    this.timer = setInterval(() => options.requestRender(), 1_000);
  }

  render(width: number) {
    const { theme } = this.options;
    const rows = this.rows();
    const selected = this.selected(rows);
    // Pinned to the row drawn, so a key acts on the highlighted child even if rows reorder before it is pressed.
    this.selectedId = selected?.id;
    const hint = (key: string, description: string, enabled = true) =>
      enabled ? theme.fg("dim", key) + theme.fg("muted", ` ${description}`) : theme.fg("dim", `${key} ${description}`);

    const box = new Container();
    box.addChild(new DynamicBorder((text) => theme.fg("border", text)));
    box.addChild(new Spacer(1));
    box.addChild(new Text(theme.fg("accent", theme.bold("Subagents")), 1, 0));
    box.addChild(new Spacer(1));
    for (const subagent of rows) {
      const label = `${subagent.agent.name} · ${subagent.description} · ${modelLabel(subagent)} · `;
      const line =
        subagent === selected ? theme.fg("accent", `→ ${label}`) : `  ${theme.fg("text", label)}`;
      box.addChild(new Text(line + this.status(subagent), 1, 0));
    }
    if (this.notice) box.addChild(new Text(theme.fg("muted", this.notice), 1, 0));
    box.addChild(new Spacer(1));
    const hints = [
      hint("↑↓", "navigate"),
      hint("x", "abort", selected?.state === "running"),
      hint("c", "copy open command"),
      hint("esc", "close"),
    ];
    box.addChild(new Text(hints.join("  "), 1, 0));
    box.addChild(new Spacer(1));
    box.addChild(new DynamicBorder((text) => theme.fg("border", text)));
    return box.render(width);
  }

  handleInput(data: string) {
    const { keybindings } = this.options;
    if (keybindings.matches(data, "tui.select.cancel")) {
      this.options.done();
      return;
    }
    const rows = this.rows();
    const selected = this.selected(rows);
    if (!selected) return;
    const index = rows.indexOf(selected);
    if (keybindings.matches(data, "tui.select.up") || data === "k") {
      this.selectedId = rows[Math.max(0, index - 1)].id;
    } else if (keybindings.matches(data, "tui.select.down") || data === "j") {
      this.selectedId = rows[Math.min(rows.length - 1, index + 1)].id;
    } else if (data === "x" && selected.state === "running") {
      this.act(this.options.subagents.abort(selected.id), `Aborted ${selected.description}.`, "Abort failed");
    } else if (data === "c") {
      const command = this.options.openCommand(selected.id);
      this.act(this.options.copy(command), `Copied: ${command}`, "Copy failed");
    }
    this.options.requestRender();
  }

  invalidate() {}

  dispose() {
    clearInterval(this.timer);
  }

  private act(action: Promise<void>, success: string, failure: string) {
    action.then(
      () => (this.notice = success),
      (error: unknown) => (this.notice = `${failure}: ${error instanceof Error ? error.message : String(error)}`),
    ).finally(() => this.options.requestRender());
  }

  private rows() {
    const newestFirst = this.options.subagents.list().toReversed();
    return [
      ...newestFirst.filter((subagent) => subagent.state === "running"),
      ...newestFirst.filter((subagent) => subagent.state !== "running"),
    ];
  }

  private selected(rows: Subagent[]) {
    return rows.find((subagent) => subagent.id === this.selectedId) ?? rows.at(0);
  }

  /** The state of the run, not the process: idle and stopped children both show how their last run ended. */
  private status(subagent: Subagent) {
    const { theme } = this.options;
    if (subagent.state === "running") return theme.fg("accent", `running ${formatElapsed(Date.now() - subagent.runStartedAt)}`);
    const run = subagent.lastRun;
    if (!run) return theme.fg("muted", subagent.state);
    const duration = run.durationMs === undefined ? "" : ` ${formatDuration(run.durationMs)}`;
    const color = run.state === "completed" ? "success" : run.state === "error" ? "error" : "warning";
    return theme.fg(color, run.state) + theme.fg("muted", duration);
  }
}
