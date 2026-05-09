#!/usr/bin/env bash

TMUX_EXECUTABLE="${TMUX_EXECUTABLE:-/opt/homebrew/bin/tmux}"

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

[[ -x "$TMUX_EXECUTABLE" ]] || fail "tmux not found or not executable: $TMUX_EXECUTABLE"
[[ $# -eq 1 ]] || fail "usage: $(basename "$0") <worktree-name>"

worktree_name=$1
[[ -n $worktree_name ]] || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "not inside a git repository"

project_parent=$(dirname "$repo_root")
project_name=$(basename "$repo_root")
worktree_path="$project_parent/${project_name}-wt-${worktree_name}"
session_name=$(basename "$worktree_path" | tr . _)

[[ ! -e "$worktree_path" ]] || fail "worktree path already exists: $worktree_path"

branch_exists=false
if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$worktree_name"; then
  branch_exists=true
fi

if [[ $branch_exists == true ]]; then
  git -C "$repo_root" worktree add "$worktree_path" "$worktree_name" ||
    fail "failed to create worktree for existing branch: $worktree_name"
else
  git -C "$repo_root" worktree add -b "$worktree_name" "$worktree_path" ||
    fail "failed to create worktree and branch: $worktree_name"
fi

tmux_running=$(pgrep -x tmux || true)

if [[ -z $TMUX ]] && [[ -z $tmux_running ]]; then
  "$TMUX_EXECUTABLE" new-session -s "$session_name" -c "$worktree_path"
  exit 0
fi

if ! "$TMUX_EXECUTABLE" has-session -t="$session_name" 2>/dev/null; then
  "$TMUX_EXECUTABLE" new-session -ds "$session_name" -c "$worktree_path"
fi

if [[ -n $TMUX ]]; then
  "$TMUX_EXECUTABLE" switch-client -t "$session_name"
  exit 0
fi

"$TMUX_EXECUTABLE" attach-session -t "$session_name"
