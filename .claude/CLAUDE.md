# Sandbox Configuration

The following commands are excluded from sandbox mode via `excludedCommands` in `.claude/settings.json`, always run with these commands outside the sandbox when using Bash tool `dangerouslyDisableSandbox: true`:

- `glab`, `gh`

Example:

```
{
  "command": "glab ...",
  "dangerouslyDisableSandbox": true
}
```

# Bash Tool Usage

- Use `rg` instead of `grep`
- Use `fd` instead of `find`
