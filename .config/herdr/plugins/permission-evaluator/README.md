# Claude Permission Evaluator

This Herdr plugin reacts after a Claude Code pane displays a blocked UI. It launches a short-lived
headless Claude evaluator, which inspects the rendered prompt and either approves it once through
Herdr or leaves it unchanged for human review.

The script currently has `dryRun: true`, so the evaluator cannot send keys.

## Flow

1. Herdr emits `pane.agent_status_changed` after Claude becomes blocked.
2. The script accepts only a blocked Claude pane with a valid pane ID.
3. It launches `claude -p` with only target-pane Herdr inspection commands allowed; `dontAsk`
   denies every Bash command outside that exact allowlist.
4. Claude checks the visible UI against the concise safety policy in the system prompt.
5. In active mode, Claude can only send `enter` to the target pane when the one-time affirmative
   option is already selected.
6. The script records the result in a persistent metadata-only audit log.

This initial version intentionally has no event deduplication or concurrency lock.

## Configuration

Configuration is the `CONFIG` object near the top of `evaluate-permission.js`:

```js
const CONFIG = {
  dryRun: true,
  auditEnabled: true,
  model: "sonnet",
  timeoutMs: 30_000,
};
```

Change `dryRun` to `false` only after validating dry-run results.
Set `auditEnabled` to `false` to stop appending the persistent audit log. Herdr's in-memory plugin
command logs remain available independently.

## Audit log

The plugin appends one JSON object per evaluation to:

```text
$HERDR_PLUGIN_STATE_DIR/audit.jsonl
```

For the default Herdr installation, this is normally:

```text
~/.local/state/herdr/plugins/local.permission-evaluator/audit.jsonl
```

Each entry contains timestamp, pane ID, dry-run mode, decision, the model's concise reason,
completion status, exit status, and duration. Reasons are normalized to one line and capped at 500
characters. The audit does not contain raw terminal contents.

`HERDR_PLUGIN_STATE_DIR` is required only when `auditEnabled` is `true`.

Herdr also keeps the latest 200 plugin command logs in server memory, including capped stdout and
stderr. Those logs disappear when the server restarts:

```sh
herdr plugin log list --plugin local.permission-evaluator --limit 20
```

## Test

```sh
bun test ~/.config/herdr/plugins/permission-evaluator/evaluate-permission.test.js
```

## Link

After reviewing and stowing the dotfiles:

```sh
herdr plugin link ~/.config/herdr/plugins/permission-evaluator
herdr plugin list
```

The plugin does not require a Herdr server restart.

Disable or remove it with:

```sh
herdr plugin disable local.permission-evaluator
herdr plugin unlink local.permission-evaluator
```
