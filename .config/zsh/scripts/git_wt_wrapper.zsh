git-wt() {
  local script_path="$ZDOTDIR/scripts/git-wt.sh"
  local arg
  local use_tmux=false
  local worktree_path

  for arg in "$@"; do
    if [[ $arg == "--tmux" ]]; then
      use_tmux=true
      break
    fi
  done

  if [[ $use_tmux == true ]]; then
    "$script_path" "$@"
    return
  fi

  worktree_path="$("$script_path" "$@")" || return
  [[ -n $worktree_path ]] || return

  cd "$worktree_path"
}
