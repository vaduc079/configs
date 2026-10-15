# Permission Evaluator

Approves safe agent permission prompts without a human. Every prompt is queued by the agent
harness's permission hook, which also starts a runner for that pane right away (launchd sweeps the
queue every minute as a backup). The runner evaluates the pane's queue with a short-lived headless
Claude, which either approves the prompt once through Herdr or leaves it for you and sends a
notification. Each pane has its own lock, so different panes are evaluated in parallel.

Set `dryRun: true` in `runner.js` to record what it would approve without sending keys.

## Flow

```text
harness permission hook ──> queue.js enqueue ──> queue.db (pending)
                                   └─> runner.js --target <pane> (detached)
launchd (60 s) ──> runner.js (sweep) ──> runner.js --target <pane>, one per pane with pending rows

runner.js --target <pane> ──> lock <pane> ──> claude -p ──> herdr send-keys enter
                                         └─> handled / need_human (+ notification) / stale
```

1. The harness hook (Claude Code `PermissionRequest`) runs `queue.js enqueue`, which stores the ask
   with its target (where the agent runs) and context (tool and input), then exits 0 without a
   decision, so the normal dialog shows. Asks outside a supported target are ignored. For a stored
   ask it starts a detached `runner.js --target <pane>` from the plugin directory with launchd's
   environment.
2. The runner takes that pane's lock in the DB (a runner that finds it held exits: the holder
   handles the ask; a lock is held exactly as long as its runner process lives). It puts the pane's
   rows from a dead run back to pending (after `maxAttempts` crashes they go to you, with a
   notification), expires its rows pending for more than 15 minutes, and waits until the oldest
   untried row is `minAgeMs` old so the dialog is drawn.
3. It claims the pane's pending rows and starts one `claude -p` with only that pane's inspection
   commands allowed, plus `enter` on that pane in active mode.
4. The evaluator handles rows in order. For each it reads the screen:
   - showing an escalation still waiting for you -> `deferred` (stays pending) for the rest;
   - not this row's prompt -> `stale` (answered elsewhere);
   - this row's prompt -> approve once (`handled`) or leave it (`need_human`, rest `deferred`).
5. The runner validates the result (one result per claimed row), records it, appends the audit
   log and notifies you for each `need_human`. A failed evaluation returns the rows to pending;
   after 3 failures they become `need_human`.
6. The runner repeats steps 2–5 until no row it has not tried yet is pending on the pane, so asks
   that arrive during a run (including ones whose own runner found the lock held) are handled by
   it. Rows it deferred or failed wait for the next run, unless a newer ask on the pane brings them
   back. After releasing the lock it retakes it if a new ask arrived meanwhile.
7. The launchd sweep (`runner.js` without arguments) deletes decided rows past retention and starts
   a runner for each pane with pending or in-progress rows: asks whose own runner never started,
   asks deferred behind an escalation, and claims of a runner that crashed.

Every failure path leaves the prompt on screen for you; nothing is approved on error.

## Layout

| Path | Role |
|---|---|
| `queue.js` | Hook entry point (`enqueue --harness <name>`) and `status` |
| `runner.js` | Per-pane runner (`--target`, started by the hook) and launchd sweep; `CONFIG` lives here |
| `db.js` | SQLite schema and queue operations |
| `evaluator.js` | Evaluator prompt, `claude -p` arguments, result validation |
| `harnesses/` | One adapter per agent harness: parse the hook payload, describe the prompt UI |
| `targets/` | One driver per multiplexer: detect from env, allowed commands, environment |
| `dashboard.js`, `dashboard.html` | Local dashboard over the queue, logs and live agents |

### Adding a harness

Write `harnesses/<name>.js` exporting `{ name, promptGuide, parseHookInput }` (see `claude.js`),
register it in `harnesses/index.js`, and make the harness's permission hook run
`bun ~/.config/herdr/plugins/permission-evaluator/queue.js enqueue --harness <name>` with the
payload on stdin.

### Adding a multiplexer

Write `targets/<type>.js` exporting `{ type, fromEnvironment, isValid, key, label, readCommand,
inspectCommands, approveCommand, focusCommand, environment }` (see `herdr.js`) and register it in
`targets/index.js`. Anything interpolated into commands must be validated in `isValid`, because it
ends up in the evaluator's Bash allowlist.

## Setup

1. Stow the dotfiles (`./setup.sh`); this links the plugin and
   `~/Library/LaunchAgents/com.duc.herdr-permission-runner.plist`.
2. Create `policy.md` next to the scripts (see below).
3. Register the Claude Code hook in `~/.claude/settings.json`. The `cd` keeps Bun from loading the
   agent project's `.env` and `bunfig.toml`, since the hook otherwise runs in the project directory:

   ```json
   "PermissionRequest": [
     {
       "hooks": [
         {
           "type": "command",
           "command": "cd '/Users/duc.vu/.config/herdr/plugins/permission-evaluator' && bun queue.js enqueue --harness claude",
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
| `baseTimeoutMs`, `perRowTimeoutMs` | `45 s`, `15 s` | Evaluator timeout = base + per row |
| `maxAttempts` | `3` | Failed evaluations or runner crashes before a row becomes `need_human` |
| `minAgeMs` | `1 s` | The runner waits until rows are this old before claiming them (the dialog may not be drawn yet) |
| `expireAfterMs` | `15 min` | Pending rows older than this become `stale` |
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
| `audit.jsonl` | One entry per decided row: pane, ask id, summary, decision, reason, policy hash, duration (the dashboard reads `queue.db` instead) |
| `runner.log` | Runner stdout/stderr (launchd and hook-started): one line per evaluated target and runner errors |
| `enqueue.err.log` | Hook failures |

Inspect the queue:

```sh
bun ~/.config/herdr/plugins/permission-evaluator/queue.js status
sqlite3 ~/.local/state/herdr/plugins/local.permission-evaluator/queue.db \
  "SELECT id, status, json_extract(context, '$.summary'), reason FROM permission_asks ORDER BY id DESC LIMIT 20"
```

### Dashboard

Press `prefix+p` in Herdr (or run the plugin action) to open the dashboard in the browser:

```sh
herdr plugin action invoke dashboard --plugin local.permission-evaluator
herdr plugin action invoke dashboard-stop --plugin local.permission-evaluator
```

It reads `queue.db` live (every 3 s) and shows:

- **Health**: launchd sweep, open rows (flags pending > 2 min and claims whose runner died),
  active runners (pane locks), errors in `runner.log` / `enqueue.err.log` over 24 h, policy hash,
  Herdr reachability.
- **Needs you**: escalations from the last 15 minutes, marked "still waiting" while the pane is
  blocked, with a button that focuses the pane in Herdr; plus blocked panes the queue has no current
  ask for (no hook, hook failure). The tab title shows the waiting count.
- **Queue**, **last 24 hours** (counts, auto-approval rate, ask-to-approval p50/p90, hourly bars),
  **history** of the last 300 decisions including stale ones (filter, search, click for the full
  tool input and context), **live Herdr agents**, and **log tails**.

The background server listens on `127.0.0.1:7788`, answers only requests addressed to that host,
and exits after 15 minutes without requests. To run it in the foreground instead, use
`bun dashboard.js [--port N] [--no-open]`.

## Test

```sh
cd ~/.config/herdr/plugins/permission-evaluator && bun test
```
