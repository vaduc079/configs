#!/usr/bin/env zsh

set -euo pipefail
setopt null_glob

fail() {
  echo "$1" >&2
  exit 1
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

  (( ${#repo_labels} > 0 )) || fail "No Git repositories found within two levels of $root"

  if (( ${#repo_labels} == 1 )); then
    selected="${repo_labels[1]}"
  else
    command -v fzf >/dev/null 2>&1 || fail "fzf not found"
    selected="$(printf '%s\n' "${repo_labels[@]}" | fzf --prompt='Git repository: ' --reverse)" || exit 0
    [[ -n "$selected" ]] || exit 0
  fi

  if [[ "$selected" == "." ]]; then
    selected_repo="$root"
  else
    selected_repo="$root/$selected"
  fi

  cd -- "$selected_repo"
  MISE_OFFLINE=1 exec mise exec node -- hunk diff --fast
}

main "$@"
