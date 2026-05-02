#!/usr/bin/env bash

TMUX_EXECUTABLE="${TMUX_EXECUTABLE:-/opt/homebrew/bin/tmux}"

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SELECT_DIRECTORY_SCRIPT="$SCRIPT_DIR/select-directory-run-command.sh"

[[ -x "$TMUX_EXECUTABLE" ]] || fail "tmux not found or not executable: $TMUX_EXECUTABLE"

if [[ $# -eq 0 ]]; then
  "$SELECT_DIRECTORY_SCRIPT" "$0"
  exit $?
fi

selected=$1

if [[ -z $selected ]]; then
  exit 0
fi

selected_name=$(basename "$selected" | tr . _)
tmux_running=$(pgrep -x tmux || true)

if [[ -z $TMUX ]] && [[ -z $tmux_running ]]; then
  "$TMUX_EXECUTABLE" new-session -s "$selected_name" -c "$selected"
  exit 0
fi

if ! "$TMUX_EXECUTABLE" has-session -t="$selected_name" 2>/dev/null; then
  "$TMUX_EXECUTABLE" new-session -ds "$selected_name" -c "$selected"
fi

"$TMUX_EXECUTABLE" switch-client -t "$selected_name"
