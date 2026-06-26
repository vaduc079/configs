# Workspace Topic Sync

Renames a Herdr workspace from the first agent topic in that workspace.

The plugin prefers explicit pane metadata in this order:

1. `title`
2. `custom_status`
3. latest user prompt from a reported Codex or Claude session id

After a workspace picks its first agent, the plugin keeps following that agent
and refreshes the workspace title from the same source on every run. This lets
delayed metadata, such as Claude's `ai-title`, replace the initial prompt once
it appears. When the selected agent leaves the workspace, the plugin picks the
next agent. Closed workspaces are pruned from state on the next run.

Selected agents are stored in `selected-agents.json` under Herdr's plugin state
directory.

It intentionally ignores existing generated labels such as `codex: ...` so it
does not feed generated output back into the next rename.

## Install

```sh
herdr plugin link ~/.config/herdr/plugins/agent-topic-sync
```

For local development from this repo:

```sh
herdr plugin link ~/configs/.config/herdr/plugins/agent-topic-sync
```

## Manual Refresh

```sh
herdr plugin action invoke local.agent-topic-sync.refresh
```
