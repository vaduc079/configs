#!/bin/sh
# SessionStart hook for Claude Code, Codex and pi: tells the agent when to name the Rex session.
# Prints nothing outside Rex.
[ -n "$REX_BLOCK" ] || exit 0
cat <<'EOF'
Rex session name: rename it (`rex session rename <label>`) only while it still has Rex's two-word default label, like `quiet-meadow`. Never replace any other label. Don't wait for the user to ask, and don't load the Rex skill for this. Name it once the task is clear: right away if the first message says it, otherwise before your first reply ends. Use 3-5 lowercase hyphenated words naming the task, such as `fix-login-redirect`.
EOF
