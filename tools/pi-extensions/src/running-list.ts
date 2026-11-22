// A list of running background jobs below the status line, with elapsed time.
import type { EventBus, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { cutToWidth, formatElapsed } from "./format.ts";
import { LINES_STATUS_PREFIX, STATUS_LINE_CLICK, type StatusLineClick } from "./status.ts";

/** `name` says what runs (`bash`, an agent name); `label` says which one (a command, a task) and may be long. */
export type RunningItem = { id: string; name: string; label: string; startedAt: number };

type ClickOptions = { events: Pick<EventBus, "on">; onClick: (id: string) => void };

/**
 * A line after its tree branch is cut to this width: the footer is no place to read a whole shell command. The line is
 * cut, not the label, so cut lines end in the same column whatever the width of their name and time. 91 leaves 80
 * columns of command after `bash 23s · `.
 */
const MAX_LINE_WIDTH = 91;

/**
 * Shows `items()` as a tree under the status line (`├── <name> 1m 2s · <label>`), redrawn every second while any run.
 * The time comes before the label: the footer cuts a line wider than the terminal from the right, and that should
 * cost the end of the label, not the time.
 * statusline draws it as lines below the status line; pi's built-in footer shows it on one line.
 * One per session: dispose it on session shutdown.
 */
export class RunningList {
  private readonly ui: ExtensionUIContext;
  private readonly key: string;
  private readonly items: () => RunningItem[];
  private timer: NodeJS.Timeout | undefined;
  /** Jobs can finish after session shutdown; their callbacks must not touch the old context. */
  private disposed = false;
  /** The items as last drawn: a click names a line on screen, and items may have started or ended since. */
  private shown: RunningItem[] = [];
  private readonly unsubscribe: (() => void) | undefined;

  constructor(ui: ExtensionUIContext, name: string, items: () => RunningItem[], click?: ClickOptions) {
    this.ui = ui;
    this.key = `${LINES_STATUS_PREFIX}${name}`;
    this.items = items;
    this.unsubscribe = click?.events.on(STATUS_LINE_CLICK, (data) => {
      const { key, line } = data as StatusLineClick;
      const item = key === this.key ? this.shown.at(line) : undefined;
      if (item) click.onClick(item.id);
    });
  }

  render() {
    if (this.disposed) return;
    const items = this.items();
    this.shown = items;
    if (items.length === 0) {
      this.ui.setStatus(this.key, undefined);
      clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    this.timer ??= setInterval(() => this.render(), 1_000);
    const { theme } = this.ui;
    const lines = items.map((item, index) => {
      const elapsed = formatElapsed(Date.now() - item.startedAt);
      const branch = index === items.length - 1 ? "└──" : "├──";
      // Styled per line: the footer draws them as separate lines. The tree is bold so it stands out from the dim text.
      const head = `${item.name} ${elapsed} · `;
      const label = cutToWidth(item.label.replace(/\s+/g, " "), MAX_LINE_WIDTH - visibleWidth(head));
      return `${theme.bold(branch)} ${theme.fg("dim", head + label)}`;
    });
    this.ui.setStatus(this.key, lines.join("\n"));
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.unsubscribe?.();
  }
}
