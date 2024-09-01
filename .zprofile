#!/bin/zsh

export EDITOR=nvim
export HOMEBREW_NO_ANALYTICS=1

typeset -U path PATH
# rancher desktop
[ -d "$HOME/.rd/bin" ] && path=($path $HOME/.rd/bin)
export PATH

eval "$(/opt/homebrew/bin/brew shellenv)"
