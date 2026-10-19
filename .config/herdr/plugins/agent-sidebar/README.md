# Agent Sidebar

Keeps the Herdr Agent sidebar focused as the number of agents grows:

- blocked and done agents first, then idle, unknown, and working agents
- bright terminal titles for blocked/done agents and dim titles for the rest
- one-shot snoozing for 1 hour, 3 hours, tomorrow at a configured time, or custom hours
- automatic unsnooze when the agent becomes blocked, becomes done, or reaches its deadline

A snooze is cleared permanently as soon as the agent reappears. Viewing a completed agent therefore
cannot make it unexpectedly disappear again.

## Install

```sh
herdr plugin link ~/.config/herdr/plugins/agent-sidebar
```

Herdr expires snoozes of up to 24 hours itself. Longer snoozes use a renewable 24-hour metadata
lease: one detached sleeper wakes 12 hours into the lease, refreshes it, starts a successor only
while more than 24 hours remain, and exits. There is no launchd job or permanent daemon. Herdr
event hooks handle agent detection, status changes, pane focus, closure, and moves immediately.

If a lease disappears during ordinary runtime, the snooze is permanently cleared rather than
reapplied. The startup hook is the only path that restores an unexpired lease after Herdr restarts.

## Configuration

Create the plugin config directory and optionally change the tomorrow preset:

```sh
config_dir=$(herdr plugin config-dir local.agent-sidebar)
cat >"$config_dir/config.json" <<'JSON'
{
  "tomorrow_time": "09:00"
}
JSON
```

The configured time uses the machine's local timezone. “Tomorrow” always means the next calendar
day, even when that is more than 24 hours away. Custom hours may be fractional.

## Actions

- `Snooze agent...` opens the duration picker for the selected agent pane.
- `Unsnooze agent` makes it visible immediately and permanently clears its snooze.
- `Refresh agent sidebar` reapplies metadata, ordering, and expired snoozes.

## Test

```sh
cd ~/.config/herdr/plugins/agent-sidebar
bun test
```

Before disabling or unlinking the plugin, remove its transient view, metadata, and active snoozes:

```sh
bun ~/.config/herdr/plugins/agent-sidebar/sidebar.js deactivate
herdr plugin unlink local.agent-sidebar
```
