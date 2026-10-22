// Settings shared by the hook (queue.js), the runner and the dashboard.

const MINUTE = 60_000;

export const CONFIG = {
  dryRun: false,
  auditEnabled: true,
  notifyEnabled: true,
  model: "haiku",
  maxRowsPerTarget: 10,
  baseTimeoutMs: 45_000,
  perRowTimeoutMs: 15_000,
  maxAttempts: 3,
  // The hook runs just before the dialog is drawn; younger rows could be misread as stale, so a
  // run waits until its rows are this old.
  minAgeMs: 1_000,
  // A prompt still pending after this long was almost certainly answered by a human.
  expireAfterMs: 15 * MINUTE,
  retentionMs: 30 * 24 * 60 * MINUTE,
};
