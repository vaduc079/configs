/** `1.2s` under a minute, `1m 2s` from a minute; the duration on tool and result rows. */
export function formatDuration(ms: number) {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}
