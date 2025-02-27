#!/bin/zsh

export EDITOR=nvim
export HOMEBREW_NO_ANALYTICS=1
# for shopback repositories
export SB_GIT_HOOKS_DIR=$HOME/.sb-git-hooks

typeset -U path PATH
# rancher desktop
[ -d "$HOME/.rd/bin" ] && path=($path $HOME/.rd/bin)
export PATH

eval "$(/opt/homebrew/bin/brew shellenv)"
