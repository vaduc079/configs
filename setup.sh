#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
debug_mode=false

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
    --debug)
      debug_mode=true
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
    esac

    shift
  done
}

run_stow() {
  local stow_flags=-v

  if [[ $debug_mode == true ]]; then
    stow_flags=-nv
  fi

  stow "$stow_flags" -d "$repo_root" -t "$HOME" .
}

ensure_symlink() {
  local source_path=$1
  local target_path=$2

  if [[ ! -e $source_path ]]; then
    printf 'missing source: %s\n' "$source_path" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$target_path")"
  ln -sfn "$source_path" "$target_path"
  printf 'linked %s -> %s\n' "$target_path" "$source_path"
}

main() {
  parse_args "$@"
  run_stow

  if [[ $debug_mode == true ]]; then
    printf 'debug mode: skipping custom symlink setup\n'
    return 0
  fi
}

main "$@"
