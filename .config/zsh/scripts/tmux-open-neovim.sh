#!/usr/bin/env zsh

set -euo pipefail

readonly DEFAULT_EDITOR_COMMAND="nvim"

usage() {
  echo "Usage: tmux-open-neovim <directory>" >&2
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

open_in_tmux() {
  local target_path="$1"

  tmux new-window \
    -c "$target_path" \
    "$DEFAULT_EDITOR_COMMAND"
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

  command -v tmux >/dev/null 2>&1 || fail "tmux is not installed"
  [[ -n "${TMUX:-}" ]] || fail "tmux-open-neovim must be run from inside an active tmux session"

  target_path="$(normalize_directory_path "$input_path")"
  open_in_tmux "$target_path"
}

main "$@"
