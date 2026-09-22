#!/usr/bin/env zsh

set -euo pipefail
setopt null_glob

script_dir="${0:A:h}"

fail() {
  echo "$1" >&2
  echo "Press any key to exit..." >&2
  read -k 1 -s
  exit 1
}

run_hunk() {
  "$script_dir/open-tab-run.sh" hunk diff --fast --watch
}

main() {
  local root="${PWD:A}"
  local candidate
  local selected
  local selected_repo
  local -a candidates
  local -a repo_labels

  candidates=("$root" "$root"/*(/N) "$root"/*/*(/N))

  for candidate in "${candidates[@]}"; do
    [[ -e "$candidate/.git" ]] || continue

    if [[ "$candidate" == "$root" ]]; then
      repo_labels+=(".")
    else
      repo_labels+=("${candidate#$root/}")
    fi
  done

  if (( ${#repo_labels} == 0 )); then
    git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "No Git repositories found"
    run_hunk
    exit 0
  fi

  if (( ${#repo_labels} == 1 )); then
    selected="${repo_labels[1]}"
  else
    command -v fzf >/dev/null 2>&1 || fail "fzf not found"
    selected="$(printf '%s\n' "${repo_labels[@]}" | fzf --prompt='Open hunk: ' --reverse)" || exit 0
    [[ -n "$selected" ]] || exit 0
  fi

  if [[ "$selected" == "." ]]; then
    selected_repo="$root"
  else
    selected_repo="$root/$selected"
  fi

  cd -- "$selected_repo"
  run_hunk
}

main "$@"
