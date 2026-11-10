import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Plain text cut to exactly `maxWidth` columns, `…` in the last, so cut lines line up. Not pi-tui's truncateToWidth:
 * that adds a style reset, which would undo the caller's style for the rest of the line.
 */
export function cutToWidth(text: string, maxWidth: number) {
  if (visibleWidth(text) <= maxWidth) return text;
  const kept = sliceByColumn(text, 0, maxWidth - 1, true);
  // A wide character that would cross the cut is left out whole; a space fills its column, so `…` stays in place.
  return `${kept}${" ".repeat(maxWidth - 1 - visibleWidth(kept))}…`;
}

/** `1.2s` under a minute, `1m 2s` from a minute; the duration on tool and result rows. */
export function formatDuration(ms: number) {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

/** Whole seconds, `5s` or `1m 2s`: a timer that ticks every second, where a decimal would only flicker. */
export function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
