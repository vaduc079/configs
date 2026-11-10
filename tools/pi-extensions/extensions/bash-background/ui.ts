/** The /background command: running background commands, the details of one, and stopping one. */
import fs from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { DynamicBorder, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Container, Spacer, Text, visibleWidth } from "@earendil-works/pi-tui";
import { cutToWidth, formatDuration, formatElapsed } from "../../src/format.ts";

export type BackgroundJob = {
  id: string;
  command: string;
  cwd: string;
  logPath: string;
  startedAt: number;
  /** Set when the command exits; the details screen stays open on it and shows how it ended. */
  end?: { status: string; durationMs: number };
};

type BackgroundListOptions = {
  /** Running jobs, oldest first. */
  running: () => BackgroundJob[];
  stop: (id: string) => void;
  /** Rows the screen may take: the details screen shows fewer log lines to fit, so its key hints stay visible. */
  maxHeight: () => number;
  copy: (text: string) => Promise<void>;
  theme: Theme;
  keybindings: Pick<KeybindingsManager, "matches">;
  requestRender: () => void;
  done: () => void;
};

/**
 * A list row after its `→ ` is cut to this width, or to the terminal's if narrower. The row is cut, not the command, so
 * cut rows end in the same column whatever the width of their time. 95 leaves 80 columns of command after
 * `<id> 23s · `, like the footer.
 */
const MAX_ROW_WIDTH = 95;
/** Enough of a command to recognize it in a narrow terminal; the row wraps below this. */
const MIN_COMMAND_WIDTH = 10;
/** Lines of log the details screen shows, when the terminal has room. */
const TAIL_LINES = 15;
/** Shown even when the screen is taller than the terminal: fewer would not show what the command is doing. */
const MIN_TAIL_LINES = 3;
/** Bytes read from the end of the log: enough for TAIL_LINES of long lines without reading a large log whole. */
const TAIL_BYTES = 64 * 1024;

/**
 * Two screens. The list shows running commands, newest first: Enter opens one, `x` stops it, Esc closes. The details
 * screen shows the full command, cwd, log path, and the last lines of the log, re-read every second; it stays open
 * after the command exits. `x` stops, `c` copies the log path, Esc goes back to the list.
 */
export class BackgroundList implements Component {
  private readonly options: BackgroundListOptions;
  /** By ID, not index: rows move when a command starts or finishes. */
  private selectedId: string | undefined;
  /** The job the details screen shows; kept after it finishes, when it has left `running()`. */
  private opened: BackgroundJob | undefined;
  private tail = "";
  /** The outcome of the last key action, shown above the key hints. */
  private notice = "";
  private readonly timer: NodeJS.Timeout;

  constructor(options: BackgroundListOptions) {
    this.options = options;
    this.timer = setInterval(() => {
      if (this.opened) this.tail = readTail(this.opened.logPath);
      options.requestRender();
    }, 1_000);
  }

  render(width: number) {
    if (!this.opened) return this.screen(width, (box) => this.renderList(box, width));
    const job = this.opened;
    const tail = this.tail ? this.tail.split("\n") : ["(no output yet)"];
    const room = this.options.maxHeight() - this.screen(width, (box) => this.renderDetails(box, job, width, [])).length;
    const shown = tail.slice(-Math.max(MIN_TAIL_LINES, room));
    return this.screen(width, (box) => this.renderDetails(box, job, width, shown));
  }

  /** The frame around a screen's content: borders, the notice, and the key hints. */
  private screen(width: number, content: (box: Container) => void) {
    const { theme } = this.options;
    const box = new Container();
    box.addChild(new DynamicBorder((text) => theme.fg("border", text)));
    box.addChild(new Spacer(1));
    content(box);
    if (this.notice) box.addChild(new Text(theme.fg("muted", this.notice), 1, 0));
    box.addChild(new Spacer(1));
    box.addChild(new Text(this.hints(), 1, 0));
    box.addChild(new Spacer(1));
    box.addChild(new DynamicBorder((text) => theme.fg("border", text)));
    return box.render(width);
  }

  handleInput(data: string) {
    const { keybindings } = this.options;
    const cancel = keybindings.matches(data, "tui.select.cancel");
    if (this.opened) {
      const job = this.opened;
      if (cancel) {
        this.opened = undefined;
        this.notice = "";
      } else if (data === "x" && !job.end) {
        this.stop(job);
      } else if (data === "c") {
        this.options.copy(job.logPath).then(
          () => (this.notice = `Copied: ${job.logPath}`),
          (error: unknown) => (this.notice = `Copy failed: ${error instanceof Error ? error.message : String(error)}`),
        ).finally(() => this.options.requestRender());
      }
      this.options.requestRender();
      return;
    }

    if (cancel) {
      this.options.done();
      return;
    }
    const rows = this.rows();
    const selected = this.selected(rows);
    const up = keybindings.matches(data, "tui.select.up") || data === "k";
    const down = keybindings.matches(data, "tui.select.down") || data === "j";
    if ((up || down) && !selected) {
      // The highlighted command ended: the arrow picks a row again, rather than x acting on one the user did not pick.
      this.selectedId = rows.at(0)?.id;
    } else if (selected && (up || down)) {
      const index = rows.indexOf(selected);
      this.selectedId = rows[up ? Math.max(0, index - 1) : Math.min(rows.length - 1, index + 1)].id;
    } else if (selected && keybindings.matches(data, "tui.select.confirm")) {
      this.opened = selected;
      this.tail = readTail(selected.logPath);
      this.notice = "";
    } else if (selected && data === "x") {
      this.stop(selected);
    }
    this.options.requestRender();
  }

  invalidate() { }

  dispose() {
    clearInterval(this.timer);
  }

  private stop(job: BackgroundJob) {
    this.options.stop(job.id);
    this.notice = `Stopped ${job.id}.`;
  }

  private rows() {
    return this.options.running().toReversed();
  }

  /** The highlighted row: the first until one is picked; none once the picked one has ended, until an arrow key picks again. */
  private selected(rows: BackgroundJob[]) {
    if (this.selectedId === undefined) return rows.at(0);
    return rows.find((job) => job.id === this.selectedId);
  }

  private renderList(box: Container, width: number) {
    const { theme } = this.options;
    box.addChild(new Text(theme.fg("accent", theme.bold("Background commands")), 1, 0));
    box.addChild(new Spacer(1));
    const rows = this.rows();
    if (rows.length === 0) box.addChild(new Text(theme.fg("muted", "No background commands running."), 1, 0));
    const selected = this.selected(rows);
    // Pinned once drawn: the highlight then follows its command, not a position, as commands start and end.
    this.selectedId ??= selected?.id;
    for (const job of rows) {
      // `<id> 1m 2s · <command>`, like the footer. Text wraps, so a long command is cut here: one row per command.
      const elapsed = formatElapsed(Date.now() - job.startedAt);
      const head = `${job.id} ${elapsed} · `;
      // The Text padding of one column on each side, and `→ `.
      const rowWidth = Math.min(MAX_ROW_WIDTH, width - 4);
      const command = cutToWidth(job.command.replace(/\s+/g, " "), Math.max(MIN_COMMAND_WIDTH, rowWidth - visibleWidth(head)));
      const line =
        job === selected
          ? theme.fg("accent", `→ ${head}${command}`)
          : `  ${theme.fg("text", job.id)} ${theme.fg("accent", elapsed)}${theme.fg("text", ` · ${command}`)}`;
      box.addChild(new Text(line, 1, 0));
    }
  }

  private renderDetails(box: Container, job: BackgroundJob, width: number, tail: string[]) {
    const { theme } = this.options;
    const state = job.end
      ? `${job.end.status} · ${formatDuration(job.end.durationMs)}`
      : `running ${formatElapsed(Date.now() - job.startedAt)}`;
    const stateColor = !job.end ? "accent" : job.end.status === "exit 0" ? "success" : "error";
    box.addChild(new Text(theme.fg("accent", theme.bold(`Background command ${job.id}`)) + theme.fg(stateColor, ` · ${state}`), 1, 0));
    box.addChild(new Spacer(1));
    box.addChild(new Text(theme.fg("text", `$ ${job.command}`), 1, 0));
    box.addChild(new Spacer(1));
    box.addChild(new Text(`${theme.fg("dim", "cwd")}  ${theme.fg("muted", job.cwd)}`, 1, 0));
    box.addChild(new Text(`${theme.fg("dim", "log")}  ${theme.fg("muted", job.logPath)}`, 1, 0));
    box.addChild(new Spacer(1));
    box.addChild(new Text(theme.fg("dim", "Last output"), 1, 0));
    // Cut, not wrapped: each log line stays one screen line, so the screen keeps its height as the log grows.
    for (const line of tail) box.addChild(new Text(theme.fg("toolOutput", cutToWidth(line, Math.max(1, width - 6))), 3, 0));
  }

  private hints() {
    const { theme } = this.options;
    const hint = (key: string, description: string, enabled = true) =>
      enabled ? theme.fg("dim", key) + theme.fg("muted", ` ${description}`) : theme.fg("dim", `${key} ${description}`);
    if (this.opened) {
      return [hint("x", "stop", !this.opened.end), hint("c", "copy log path"), hint("esc", "back")].join("  ");
    }
    const rows = this.rows();
    const picked = this.selected(rows) !== undefined;
    return [hint("↑↓", "navigate", rows.length > 0), hint("enter", "details", picked), hint("x", "stop", picked), hint("esc", "close")].join("  ");
  }
}

/** The last lines of a log as a terminal would show them: styles stripped, and a `\r` progress line at its final state. */
export function readTail(logPath: string) {
  let text: string;
  try {
    const fd = fs.openSync(logPath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, TAIL_BYTES));
      fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
      text = buffer.toString();
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    // The log is created when the job starts; a missing file means it was removed from the temp dir.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "(log file is gone)";
    throw error;
  }
  return stripVTControlCharacters(text)
    .replace(/\n$/, "")
    .split("\n")
    .slice(-TAIL_LINES)
    .map((line) => (line.split("\r").findLast((part) => part !== "") ?? "").replaceAll("\t", "  "))
    .join("\n");
}
