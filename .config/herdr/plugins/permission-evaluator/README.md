# Permission Evaluator

Approves safe agent permission prompts without a human. Every prompt is queued by the agent
harness's permission hook, which also starts a runner right away (launchd starts one every minute
as a sweep). The runner evaluates the queue with a short-lived headless Claude, which either
approves the prompt once through Herdr or leaves it for you and sends a notification.

Set `dryRun: true` in `runner.js` to record what it would approve without sending keys.

## Flow

```text
harness permission hook ──> queue.js enqueue ──> queue.db (pending)
                                   └─> starts runner.js (detached)
launchd (60 s, sweep) ──> runner.js ──> one claude -p per target ──> herdr send-keys enter
                                  └─> handled / need_human (+ notification) / stale
```

1. The harness hook (Claude Code `PermissionRequest`) runs `queue.js enqueue`, which stores the ask
   with its target (where the agent runs) and context (tool and input), then exits 0 without a
   decision, so the normal dialog shows. Asks outside a supported target are ignored. For a stored
   ask it starts a detached `runner.js` with a launchd-like environment.
2. `runner.js` takes a lock in the DB (one runner at a time; a runner that finds it held exits),
   puts rows from a dead run back to pending, expires rows pending for more than 15 minutes, and
   exits if nothing is pending. It waits until rows are `minAgeMs` old so the dialog is drawn.
3. For each target, oldest first and up to `maxConcurrentTargets` at once, it claims the pending
   rows and starts one `claude -p` with only
   that target's inspection commands allowed, plus `enter` on that target in active mode.
4. The evaluator handles rows in order. For each it reads the screen:
   - showing an escalation still waiting for you -> `deferred` (stays pending) for the rest;
   - not this row's prompt -> `stale` (answered elsewhere);
   - this row's prompt -> approve once (`handled`) or leave it (`need_human`, rest `deferred`).
5. The runner validates the result (one result per claimed row), records it, appends the audit
   log and notifies you for each `need_human`. A failed evaluation returns the rows to pending;
   after 3 failures they become `need_human`.
6. The runner repeats steps 3–5 until no row it has not tried yet is pending, so asks that arrive
   during a run (including ones whose own runner found the lock held) are handled by it. Rows it
   deferred or failed wait for the next run. After releasing the lock it checks once more and
   retakes it if an ask slipped in.

Every failure path leaves the prompt on screen for you; nothing is approved on error.

## Layout

| Path | Role |
|---|---|
| `queue.js` | Hook entry point (`enqueue --harness <name>`) and `status` |
| `runner.js` | Runner started by the hook and by launchd; `CONFIG` lives here |
| `db.js` | SQLite schema and queue operations |
| `evaluator.js` | Evaluator prompt, `claude -p` arguments, result validation |
| `harnesses/` | One adapter per agent harness: parse the hook payload, describe the prompt UI |
| `targets/` | One driver per multiplexer: detect from env, allowed commands, environment |

### Adding a harness

Write `harnesses/<name>.js` exporting `{ name, promptGuide, parseHookInput }` (see `claude.js`),
register it in `harnesses/index.js`, and make the harness's permission hook run
`bun ~/.config/herdr/plugins/permission-evaluator/queue.js enqueue --harness <name>` with the
payload on stdin.

### Adding a multiplexer

Write `targets/<type>.js` exporting `{ type, fromEnvironment, isValid, key, label, readCommand,
inspectCommands, approveCommand, environment }` (see `herdr.js`) and register it in
`targets/index.js`. Anything interpolated into commands must be validated in `isValid`, because it
ends up in the evaluator's Bash allowlist.

## Setup

1. Stow the dotfiles (`./setup.sh`); this links the plugin and
   `~/Library/LaunchAgents/com.duc.herdr-permission-runner.plist`.
2. Create `policy.md` next to the scripts (see below).
3. Register the Claude Code hook in `~/.claude/settings.json`:

   ```json
   "PermissionRequest": [
     {
       "hooks": [
         {
           "type": "command",
           "command": "bun '/Users/duc.vu/.config/herdr/plugins/permission-evaluator/queue.js' enqueue --harness claude",
           "timeout": 10
         }
       ]
     }
   ]
   ```

4. Load the runner:

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.duc.herdr-permission-runner.plist
   ```

   Reload after editing the plist with `launchctl bootout gui/$(id -u)/com.duc.herdr-permission-runner`
   followed by the bootstrap command. Script and policy changes need no reload.

## Configuration

`CONFIG` near the top of `runner.js`:

| Key | Default | Meaning |
|---|---|---|
| `dryRun` | `false` | Record would-approve decisions without sending keys |
| `auditEnabled` | `true` | Append `audit.jsonl` for the viewer |
| `notifyEnabled` | `true` | macOS notification for each `need_human` |
| `model` | `claude-haiku-5-5` | Evaluator model |
| `maxRowsPerTarget` | `10` | Rows per evaluator run |
| `maxConcurrentTargets` | `3` | Targets evaluated in parallel (one `claude -p` each) |
| `baseTimeoutMs`, `perRowTimeoutMs` | `45 s`, `15 s` | Evaluator timeout = base + per row |
| `maxAttempts` | `3` | Failed evaluations before a row becomes `need_human` |
| `minAgeMs` | `5 s` | The runner waits until rows are this old before claiming them (the dialog may not be drawn yet) |
| `expireAfterMs` | `15 min` | Pending rows older than this become `stale` |
| `lockLeaseMs` | `10 min` | Lock lease; renewed per target |
| `retentionMs` | `30 days` | Decided rows older than this are deleted |

## Approval policy

`policy.md` defines when the evaluator should approve and when it should leave the prompt for you.
It is local-only and ignored by Git. It is read on every run. The runner embeds it in the system
prompt between fixed guardrails that stay in code: untrusted pane text and row context, the exact
allowed commands, row order and screen matching, never choosing persistent permission, and the
JSON result. A missing or empty `policy.md` stops the run; rows stay pending and expire.

## State

All under `~/.local/state/herdr/plugins/local.permission-evaluator/` (or `$HERDR_PLUGIN_STATE_DIR`):

| File | Content |
|---|---|
| `queue.db` | The queue (mode 0600; rows may contain command text) |
| `audit.jsonl` | One entry per decided row: pane, ask id, summary, decision, reason, policy hash, duration |
| `runner.log` | Runner stdout/stderr (launchd and hook-started): one line per evaluated target and runner errors |
| `enqueue.err.log` | Hook failures |

Inspect the queue:

```sh
bun ~/.config/herdr/plugins/permission-evaluator/queue.js status
sqlite3 ~/.local/state/herdr/plugins/local.permission-evaluator/queue.db \
  "SELECT id, status, json_extract(context, '$.summary'), reason FROM permission_asks ORDER BY id DESC LIMIT 20"
```

### Audit viewer

```sh
herdr plugin action invoke audit-view --plugin local.permission-evaluator
herdr plugin action invoke audit-view-stop --plugin local.permission-evaluator
```

The background server listens on `127.0.0.1:7788` and exits after 15 minutes without requests. To
run it in the foreground instead, use `bun audit-viewer.js [--port N] [--no-open]`.

## Test

```sh
cd ~/.config/herdr/plugins/permission-evaluator && bun test
```
