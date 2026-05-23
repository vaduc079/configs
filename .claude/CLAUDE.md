# Sandbox Configuration

- For the commands excluded from sandbox mode via `excludedCommands` in `.claude/settings.json`, always run them unsandboxed when using Bash tool with `dangerouslyDisableSandbox: true`. Example:

  ```
  {
    "command": "glab ...",
    "dangerouslyDisableSandbox": true
  }
  ```

- Never carry `dangerouslyDisableSandbox: true` over from a preceding command. Each Bash call needs its own fresh justification. Before setting `dangerouslyDisableSandbox: true`, ask: does this command need it?

# Bash Tool Usage

- Use `rg` instead of `grep`
- Use `fd` instead of `find`

# Important Notes

All your operations regarding send messages, add comments, create tickets, etc. with Jira, Confluence, and GitLab must add: `🤖 Operated by AI Agent` at the end.
