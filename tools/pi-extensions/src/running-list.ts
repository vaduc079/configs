// A list of running background jobs below the status line, with elapsed time.
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { formatElapsed } from "./format.ts";
import { LINES_STATUS_PREFIX } from "./status.ts";

export type RunningItem = { label: string; startedAt: number };

/**
 * Shows `items()` as a tree under the status line (`├── <label> · 1m 2s`), redrawn every second while any run.
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

  constructor(ui: ExtensionUIContext, name: string, items: () => RunningItem[]) {
    this.ui = ui;
    this.key = `${LINES_STATUS_PREFIX}${name}`;
    this.items = items;
  }

  render() {
    if (this.disposed) return;
    const items = this.items();
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
      return `${theme.bold(branch)} ${theme.fg("dim", `${item.label} · ${elapsed}`)}`;
    });
    this.ui.setStatus(this.key, lines.join("\n"));
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
  }
}
