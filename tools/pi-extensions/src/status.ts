/**
 * A status whose key starts with this prefix holds lines. statusline draws them as their own lines below the
 * status line; pi's built-in footer shows them inline.
 */
export const LINES_STATUS_PREFIX = "lines:";

/**
 * Emitted on `pi.events` when the user clicks a line of a `lines:` status: `line` counts from 0 within that status.
 * The footer only has the status text, so the extension that set it decides what a click on a line does.
 */
export const STATUS_LINE_CLICK = "statusline:click";
export type StatusLineClick = { key: string; line: number };
