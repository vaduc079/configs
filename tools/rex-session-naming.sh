#!/bin/sh
# SessionStart hook for Claude Code, Codex and pi: tells the agent when to name the Rex session.
# Prints nothing outside Rex.
[ -n "$REX_BLOCK" ] || exit 0
cat <<'EOF'
Rex session name:
- Once the task is clear (before your first reply ends), check the label: `rex session inspect --json | jq -r .label`.
- Only if it is Rex's two-word default, like `quiet-meadow`, run `rex session rename <label>`. Use 3-5 lowercase hyphenated words naming the task, such as `fix-login-redirect`.
- Any other label was set on purpose: leave it.
- Never rename without checking first. Don't load the Rex skill for this.
EOF
