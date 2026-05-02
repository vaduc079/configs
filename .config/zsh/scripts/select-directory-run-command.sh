#!/usr/bin/env zsh

set -euo pipefail

readonly FD_EXECUTABLE="/opt/homebrew/bin/fd"
readonly FZF_EXECUTABLE="/opt/homebrew/bin/fzf"
typeset -ra SEARCH_ROOTS=(
  "$HOME/projects/personal"
  "$HOME/projects/shopback"
  "$HOME/configs"
  "$HOME/.config/nvim"
)
typeset -ra EXCLUDE_DIRS=(
  .git
  node_modules
  dist
  build
  coverage
  .next
  .turbo
  .cache
  target
  codebases
  .worktrees
)

fail() {
  echo "$1" >&2
  exit 1
}

usage() {
  echo "Usage: select-directory-run-command [command [arg ...]]" >&2
}

command_exists() {
  local command_name="$1"

  command -v -- "$command_name" >/dev/null 2>&1
}

validate_command() {
  local executable_path="$1"
  local has_explicit_path=false

  [[ "$executable_path" == */* ]] && has_explicit_path=true

  if "$has_explicit_path"; then
    [[ -x "$executable_path" ]] || fail "Command not found or not executable: $executable_path"
    return
  fi

  command_exists "$executable_path" || fail "Command not found: $executable_path"
}

main() {
  local -a command_args existing_roots exclude_args
  local search_root
  local exclude_dir
  local selected_path

  command_args=("$@")

  [[ -x "$FD_EXECUTABLE" ]] || fail "fd not found at $FD_EXECUTABLE"
  [[ -x "$FZF_EXECUTABLE" ]] || fail "fzf not found at $FZF_EXECUTABLE"

  if [[ ${#command_args[@]} -gt 0 ]]; then
    validate_command "${command_args[1]}"
  fi

  for search_root in "${SEARCH_ROOTS[@]}"; do
    [[ -d "$search_root" ]] || continue
    existing_roots+=("$search_root")
  done

  [[ ${#existing_roots[@]} -gt 0 ]] || fail "No search roots found"

  for exclude_dir in "${EXCLUDE_DIRS[@]}"; do
    exclude_args+=(--exclude "$exclude_dir")
  done

  selected_path="$(
    {
      for search_root in "${existing_roots[@]}"; do
        print -r -- "$search_root"
      done

      "$FD_EXECUTABLE" \
        --type d \
        --type l \
        --max-depth 1 \
        --absolute-path \
        "${exclude_args[@]}" \
        . \
        "${existing_roots[@]}"
    } |
      while IFS= read -r path; do
        [[ -d "$path" ]] || continue
        print -r -- "$path"
      done |
      "$FZF_EXECUTABLE" \
        --prompt="Open directory> " \
        --select-1 \
        --exit-0
  )"

  [[ -n "$selected_path" ]] || exit 0

  [[ ${#command_args[@]} -gt 0 ]] || exit 0

  "${command_args[@]}" "$selected_path"
}

main "$@"
