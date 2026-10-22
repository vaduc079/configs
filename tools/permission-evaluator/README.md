# Permission Evaluator

Approves safe agent permission prompts without a human. Every prompt is queued by the agent
harness's permission hook, which also starts a runner for that pane right away (launchd sweeps the
queue every minute as a backup). The runner evaluates the pane's queue with a short-lived headless
Claude, which either approves the prompt once through the agent's multiplexer (Herdr or Rex) or
leaves it for you and sends a notification. Each pane has its own lock, so different panes are
evaluated in parallel.

The evaluator lives here, outside any multiplexer's config, and is not stowed (`^/tools` in
`.stow-local-ignore`); the hook and launchd point at this directory. Herdr and Rex only add the
dashboard actions (see [Dashboard](#dashboard)).

Set `dryRun: true` in `config.js` to record what it would approve without sending keys.

## Flow

```text
harness permission hook ──> queue.js enqueue ──> rules.js ──> allow in hook output / need_human (+ notification)
                                   ├─> queue.db (pending, when no rule decides)
                                   └─> runner.js --target <pane> (detached)
launchd (60 s) ──> runner.js (sweep) ──> runner.js --target <pane>, one per pane with pending rows

runner.js --target <pane> ──> lock <pane> ──> claude -p ──> herdr agent send-keys / rex send-key enter
                                         └─> handled / need_human (+ notification) / stale
```

1. The harness hook (Claude Code `PermissionRequest`) runs `queue.js enqueue`. It first applies
   the deterministic rules in `rules.js`:
   - `slack_send_message` to a channel in `rules.json` is approved through the hook's own output
     (`decision.behavior: "allow"`), with no evaluator run or keys sent;
   - `AskUserQuestion` is a question, not a permission, so it goes to `need_human` with a
     notification and no evaluator run.

   A rule-decided ask is stored already decided (reason `rule <name>: …`) and audited. Any other
   ask is stored pending with its target (where the agent runs) and context (tool and input), then
   the hook exits 0 without a decision, so the normal dialog shows. Asks outside a supported target
   are not stored (a rule approval still applies). For a pending ask it starts a detached
   `runner.js --target <pane>` from the plugin directory with launchd's environment.
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
| `rules.js` | Deterministic hook rules; reads the local `rules.json` allowlist (ignored by Git) |
| `runner.js` | Per-pane runner (`--target`, started by the hook) and launchd sweep |
| `config.js` | `CONFIG` |
| `report.js` | Audit log and notifications |
| `db.js` | SQLite schema and queue operations |
| `evaluator.js` | Evaluator prompt, `claude -p` arguments, result validation |
| `harnesses/` | One adapter per agent harness: parse the hook payload, describe the prompt UI |
| `targets/` | One driver per multiplexer: detect from env, allowed commands, environment |
| `dashboard.js`, `dashboard.html` | Local dashboard over the queue, logs and live Herdr agents |
| `~/configs/.config/herdr/plugins/permission-evaluator/` | Herdr plugin: dashboard actions only |
| `~/configs/.config/rex/permission_dashboard.lua` | Rex actions: dashboard open and stop |

### Targets

| Target | Detected by | Inspect | Approve | Notes |
|---|---|---|---|---|
| Herdr pane | `HERDR_ENV=1`, `HERDR_PANE_ID` | `herdr agent get/read/explain` | `herdr agent send-keys <pane> enter` | Dashboard shows whether a pane is still blocked |
| Rex block | `REX_BLOCK`, `REX_SERVER` | `rex -S <server> capture -b <block> --trim` | `rex -S <server> send-key -b <block> enter` | Screen only, so the dashboard shows the pane as unknown. The evaluator gets no `REX_*` variables, so Rex's SessionStart hook ignores it; `REX_BIN_DIR` goes on its `PATH` |

A Herdr pane inside a Rex block resolves to the Herdr pane.

### Adding a harness

Write `harnesses/<name>.js` exporting `{ name, promptGuide, parseHookInput }` (see `claude.js`),
register it in `harnesses/index.js`, and make the harness's permission hook run
`bun ~/configs/tools/permission-evaluator/queue.js enqueue --harness <name>` with the
payload on stdin.

### Adding a multiplexer

Write `targets/<type>.js` exporting `{ type, fromEnvironment, isValid, key, label, appBundleId,
readCommand, inspectCommands, approveCommand, focusCommand, serverEnvironment, environment }` (see
`herdr.js` and `rex.js`) and register it in `targets/index.js`, whose order is the detection order.
Store the pane's ID as `pane_id`, which the dashboard and audit log read. Anything interpolated into commands must be validated in `isValid`, because it
ends up in the evaluator's Bash allowlist.

## Setup

1. Stow the dotfiles (`./setup.sh`); this links the Herdr plugin, the Rex config and
   `~/Library/LaunchAgents/com.duc.permission-evaluator-runner.plist`. This directory itself stays in
   `~/configs`.
2. Create `policy.md` next to the scripts (see below).
3. Register the Claude Code hook in `~/.claude/settings.json`. The `cd` keeps Bun from loading the
   agent project's `.env` and `bunfig.toml`, since the hook otherwise runs in the project directory:

   ```json
   "PermissionRequest": [
     {
       "hooks": [
         {
           "type": "command",
           "command": "cd '/Users/duc.vu/configs/tools/permission-evaluator' && bun queue.js enqueue --harness claude",
           "timeout": 10
         }
       ]
     }
   ]
   ```

4. Load the runner:

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.duc.permission-evaluator-runner.plist
   ```

   Reload after editing the plist with `launchctl bootout gui/$(id -u)/com.duc.permission-evaluator-runner`
   followed by the bootstrap command. Script and policy changes need no reload.

5. For Rex, allow its socket in the Claude Code sandbox (`sandbox.network.allowUnixSockets`:
   `~/Library/Application Support/rex/server.sock`); otherwise the evaluator's `rex` commands fail.

## Configuration

`CONFIG` in `config.js`:

| Key | Default | Meaning |
|---|---|---|
| `dryRun` | `false` | Record would-approve decisions without sending keys |
| `auditEnabled` | `true` | Append `audit.jsonl` for the viewer |
| `notifyEnabled` | `true` | macOS notification for each `need_human`, showing the evaluator's reason. With `terminal-notifier` installed, clicking it brings the target's app forward (the driver's `appBundleId`: Ghostty for Herdr, Rex for Rex) and focuses the pane; otherwise it falls back to `osascript` (no click action) |
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

`rules.json`, also local-only, holds the allowlists for the hook rules, read on every hook call:

```json
{ "slackChannels": ["C0123456789", "U0123456789"] }
```

A missing or invalid `rules.json` turns the Slack rule off; those asks go to the evaluator.

## State

All under `~/.local/state/permission-evaluator/` (or `$PERMISSION_EVALUATOR_STATE_DIR`):

| File | Content |
|---|---|
| `queue.db` | The queue (mode 0600; rows may contain command text) |
| `audit.jsonl` | One entry per decided row: pane, ask id, summary, decision, reason, policy hash, duration (the dashboard reads `queue.db` instead) |
| `runner.log` | Runner stdout/stderr (launchd and hook-started): one line per evaluated target and runner errors |
| `enqueue.err.log` | Hook failures |

Inspect the queue:

```sh
bun ~/configs/tools/permission-evaluator/queue.js status
sqlite3 ~/.local/state/permission-evaluator/queue.db \
  "SELECT id, status, json_extract(context, '$.summary'), reason FROM permission_asks ORDER BY id DESC LIMIT 20"
```

### Dashboard

Press `prefix+ctrl+p` in Herdr, or run the Herdr or Rex action, to open the dashboard
in the browser:

```sh
herdr plugin action invoke dashboard --plugin local.permission-evaluator
herdr plugin action invoke dashboard-stop --plugin local.permission-evaluator
rex do permission_dashboard
rex do permission_dashboard_stop
```

It reads `queue.db` live (every 3 s) and shows:

- **Health**: launchd sweep, open rows (flags pending > 2 min and claims whose runner died),
  active runners (pane locks), errors in the tails of `runner.log` / `enqueue.err.log`, policy hash,
  Herdr reachability (not running is fine when you use Rex).
- **Needs you**: escalations from the last 15 minutes, with a button that focuses the pane. Herdr
  panes are marked "still waiting" while blocked; Rex reports no agent status, so Rex blocks show
  "pane unknown". Also lists blocked Herdr panes the queue has no current ask for (no hook, hook
  failure). The tab title shows the waiting count.
- **Queue**, **last 24 hours** (counts, auto-approval rate, ask-to-approval p50/p90, hourly bars),
  **history** of the last 300 decisions including stale ones (filter, search, click for the full
  tool input and context), **live Herdr agents**, and **log tails**.

The background server listens on `127.0.0.1:7788` and exits after 5 minutes without requests.
It answers only requests addressed to that host, and its API requires a per-launch token kept in
`dashboard.token` in the state directory (0600), which the browser receives in the URL fragment, so
other local users and processes cannot read the queue through the port. A tab left open across a
server restart needs reopening (`prefix+ctrl+p` in Herdr, the `Permission Evaluator Dashboard` action in Rex). To run it in the foreground instead, use
`bun dashboard.js [--port N] [--no-open]`.

## Test

```sh
cd ~/configs/tools/permission-evaluator && bun test
```
