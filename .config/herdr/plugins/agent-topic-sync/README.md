# Workspace Topic Sync

Renames a Herdr workspace once from the first usable agent topic in that
workspace.

The plugin prefers explicit pane metadata in this order:

1. `title`
2. `custom_status`
3. latest user prompt from a reported Codex or Claude session id

After a workspace receives an automatic title, the plugin records that
workspace in its state and does not rename it again. Manual renames are left
alone. Closed workspaces are pruned from state on the next run.

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
