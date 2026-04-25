#!/usr/bin/env zsh

set -euo pipefail

readonly TMUX_BIN="/opt/homebrew/bin/tmux"
readonly SESSION_PREFIX="duc-vu"

session_exists() {
  local session_name="$1"

  "$TMUX_BIN" has-session -t "$session_name" >/dev/null 2>&1
}

find_available_session_name() {
  local index=0
  local candidate_name=""

  while true; do
    candidate_name="${SESSION_PREFIX}-${index}"

    if ! session_exists "$candidate_name"; then
      print -r -- "$candidate_name"
      return
    fi

    ((index += 1))
  done
}

main() {
  local session_name

  [[ -x "$TMUX_BIN" ]] || {
    echo "tmux is not installed at $TMUX_BIN" >&2
    exit 1
  }

  session_name="$(find_available_session_name)"
  exec "$TMUX_BIN" new-session -s "$session_name"
}

main "$@"
