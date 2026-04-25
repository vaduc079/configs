#!/usr/bin/env zsh

set -euo pipefail

if [[ "${1:-}" != "--run" ]]; then
  exec env -i \
    HOME="$HOME" \
    PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    /bin/zsh -f "$0" --run "$@"
fi

shift

readonly FD_EXECUTABLE="/opt/homebrew/bin/fd"
readonly FZF_EXECUTABLE="/opt/homebrew/bin/fzf"
readonly DEFAULT_OPEN_NVIM_SCRIPT="${0:A:h}/wezterm-open-nvim.sh"
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
  echo "Usage: select-directory-open-nvim [open-nvim-script]" >&2
}

main() {
  local -a existing_roots exclude_args
  local search_root
  local exclude_dir
  local selected_path
  local open_nvim_script="${1:-$DEFAULT_OPEN_NVIM_SCRIPT}"

  [[ $# -le 1 ]] || {
    usage
    exit 1
  }

  [[ -x "$FD_EXECUTABLE" ]] || fail "fd not found at $FD_EXECUTABLE"
  [[ -x "$FZF_EXECUTABLE" ]] || fail "fzf not found at $FZF_EXECUTABLE"
  [[ -x "$open_nvim_script" ]] || fail "Open script not found or not executable: $open_nvim_script"

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
        --max-depth 3 \
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
        --prompt="Open in nvim> " \
        --select-1 \
        --exit-0
  )"

  [[ -n "$selected_path" ]] || exit 0

  "$open_nvim_script" "$selected_path"
}

main "$@"
