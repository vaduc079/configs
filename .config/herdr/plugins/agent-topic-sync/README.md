# Workspace Topic Sync

Renames Herdr workspaces from Herdr agent topic metadata.

The plugin prefers explicit pane metadata in this order:

1. `title`
2. `custom_status`
3. latest user prompt from a reported Codex or Claude session id

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
