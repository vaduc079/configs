#!/usr/bin/env zsh

set -euo pipefail

readonly DEFAULT_WEZTERM_EXECUTABLE="/opt/homebrew/bin/wezterm"
readonly DEFAULT_EDITOR_COMMAND="nvim"

usage() {
  echo "Usage: wezterm-open-nvim <directory>" >&2
}

fail() {
  echo "$1" >&2
  exit 1
}

expand_input_path() {
  local input_path="$1"

  if [[ "$input_path" == "~" ]]; then
    print -r -- "$HOME"
    return
  fi

  if [[ "$input_path" == "~/"* ]]; then
    print -r -- "$HOME/${input_path#~/}"
    return
  fi

  if [[ "$input_path" == /* ]]; then
    print -r -- "$input_path"
    return
  fi

  print -r -- "$PWD/$input_path"
}

normalize_directory_path() {
  local input_path="$1"
  local expanded_path

  expanded_path="$(expand_input_path "$input_path")"
  [[ -d "$expanded_path" ]] || fail "Directory not found: $input_path"

  (
    cd -- "$expanded_path" &&
      pwd -P
  )
}

spawn_nvim() {
  local target_path="$1"
  local shell_executable="${SHELL:-/bin/zsh}"
  local shell_name="${shell_executable:t}"
  local shell_flag="-c"

  if [[ "$shell_name" == "zsh" || "$shell_name" == "bash" ]]; then
    shell_flag="-lic"
  fi

  "$DEFAULT_WEZTERM_EXECUTABLE" cli spawn \
    --cwd "$target_path" \
    -- \
    "$shell_executable" \
    "$shell_flag" \
    "exec '$DEFAULT_EDITOR_COMMAND'"
}

main() {
  local input_path="${1:-}"
  local target_path

  [[ $# -eq 1 ]] || {
    usage
    exit 1
  }

  [[ -n "$input_path" ]] || {
    usage
    exit 1
  }

  [[ -x "$DEFAULT_WEZTERM_EXECUTABLE" ]] || {
    fail "WezTerm executable not found at $DEFAULT_WEZTERM_EXECUTABLE"
  }

  target_path="$(normalize_directory_path "$input_path")"
  spawn_nvim "$target_path"
  # open -a WezTerm >/dev/null 2>&1 || true
}

main "$@"
