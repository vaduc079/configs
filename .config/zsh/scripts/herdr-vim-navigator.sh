#!/usr/bin/env zsh

set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

direction="${1:-}"
herdr_bin="${HERDR_BIN_PATH:-${HERDR_BIN:-$HOME/.local/bin/herdr}}"

case "$direction" in
  left)
    key="ctrl+h"
    ;;
  down)
    key="ctrl+j"
    ;;
  up)
    key="ctrl+k"
    ;;
  right)
    key="ctrl+l"
    ;;
  *)
    fail "Usage: $0 <left|down|up|right>"
    ;;
esac

[[ -x "$herdr_bin" ]] || fail "herdr not found or not executable: ${herdr_bin:-herdr}"
command -v jq >/dev/null 2>&1 || fail "jq not found"

focus_herdr_pane() {
  exec "$herdr_bin" pane focus --direction "$direction" --current
}

current_pane="$(
  "$herdr_bin" pane current --current |
    jq -r '.result.pane.pane_id // empty'
)"

if [[ -z "$current_pane" ]]; then
  focus_herdr_pane
fi

# Keep parity with the tmux matcher in this repo, including fzf/lumen panes
# where Ctrl+h/j/k/l should be delivered to the application.
controlled_process_regex='^g?\.?(view|l?n?vim?x?|fzf|lumen)(diff)?(-wrapped)?$'

process_is_in_control="$(
  "$herdr_bin" pane process-info --pane "$current_pane" 2>/dev/null |
    jq -r --arg regex "$controlled_process_regex" '
      .result.process_info.foreground_processes[]?.name
      | ascii_downcase
      | select(test($regex))
    ' |
    head -n 1
)"

if [[ -n "$process_is_in_control" ]]; then
  exec "$herdr_bin" pane send-keys "$current_pane" "$key"
fi

focus_herdr_pane
