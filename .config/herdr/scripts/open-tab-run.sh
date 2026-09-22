#!/usr/bin/env zsh

set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

main() {
  (( $# > 0 )) || fail "Usage: $0 <command> [args...]"

  local herdr_bin="${HERDR_BIN_PATH:-$HOME/.local/bin/herdr}"
  local workspace_id="${HERDR_ACTIVE_WORKSPACE_ID:-${HERDR_WORKSPACE_ID:-}}"
  local cwd="${HERDR_ACTIVE_PANE_CWD:-$PWD}"
  local label="${1:t}"
  local created pane_id tab_id wrapped

  [[ -n "$workspace_id" ]] || fail "No active herdr workspace found"

  created="$("$herdr_bin" tab create --workspace "$workspace_id" --cwd "$cwd" --label "$label" --focus)"
  pane_id="$(print -r -- "$created" | jq -r '.result.root_pane.pane_id')"
  tab_id="$(print -r -- "$created" | jq -r '.result.tab.tab_id')"

  wrapped="${(j: :)${(q)@}}; ${(q)herdr_bin} tab close ${(q)tab_id}"
  "$herdr_bin" pane run "$pane_id" "$wrapped"
}

main "$@"
