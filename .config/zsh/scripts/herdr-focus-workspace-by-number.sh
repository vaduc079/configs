#!/usr/bin/env zsh

set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

workspace_number="${1:-}"
[[ "$workspace_number" =~ '^[1-9]$' ]] || fail "Usage: $0 <workspace-number: 1..9>"

herdr_bin="${HERDR_BIN_PATH:-${HERDR_BIN:-$HOME/.local/bin/herdr}}"
[[ -x "$herdr_bin" ]] || fail "herdr not found or not executable: ${herdr_bin:-herdr}"
command -v jq >/dev/null 2>&1 || fail "jq not found"

workspace_id="$(
  "$herdr_bin" workspace list |
    jq -r --argjson number "$workspace_number" '
      .result.workspaces[]
      | select(.number == $number)
      | .workspace_id
    ' |
    head -n 1
)"

[[ -n "$workspace_id" && "$workspace_id" != "null" ]] || exit 0

"$herdr_bin" workspace focus "$workspace_id"
