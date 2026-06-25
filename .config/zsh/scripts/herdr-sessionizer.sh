#!/usr/bin/env zsh

set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

find_herdr_bin() {
  if [[ -n "${HERDR_BIN:-}" ]]; then
    print -r -- "$HERDR_BIN"
    return
  fi

  print -r -- "$HOME/.local/bin/herdr"
}

find_workspace_id_by_label() {
  local herdr_bin="$1"
  local workspace_label="$2"

  "$herdr_bin" workspace list |
    jq -r --arg label "$workspace_label" '
      .result.workspaces[]
      | select(.label == $label)
      | .workspace_id
    ' |
    head -n 1
}

open_workspace() {
  local selected_path="$1"
  local workspace_label
  local existing_workspace_id
  local herdr_bin

  [[ -d "$selected_path" ]] || fail "Directory not found: $selected_path"

  workspace_label="$(basename "$selected_path" | tr . _)"
  herdr_bin="$(find_herdr_bin)"
  [[ -x "$herdr_bin" ]] || fail "herdr not found or not executable: ${herdr_bin:-herdr}"
  command -v jq >/dev/null 2>&1 || fail "jq not found"

  existing_workspace_id="$(find_workspace_id_by_label "$herdr_bin" "$workspace_label")"
  if [[ -n "$existing_workspace_id" ]]; then
    "$herdr_bin" workspace focus "$existing_workspace_id"
    return
  fi

  "$herdr_bin" workspace create \
    --cwd "$selected_path" \
    --label "$workspace_label" \
    --focus
}

main() {
  local script_dir
  local script_path
  local select_directory_script

  script_path="${${(%):-%x}:A}"
  script_dir="$(cd -- "$(dirname -- "$script_path")" && pwd)"
  select_directory_script="$script_dir/select-directory-run-command.sh"

  [[ -x "$select_directory_script" ]] || fail "Directory picker is not executable: $select_directory_script"

  "$select_directory_script" "$script_path" "$@"
}

if [[ $# -eq 0 ]]; then
  main "$@"
else
  open_workspace "$1"
fi
