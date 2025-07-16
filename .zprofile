#!/bin/zsh

export EDITOR=nvim
export HOMEBREW_NO_ANALYTICS=1
# for shopback repositories
export SB_GIT_HOOKS_DIR=$HOME/.sb-git-hooks

export FZF_DEFAULT_OPTS=" \
 -m --highlight-line --pointer=''\
 --color=bg:#282828,fg:#ebdbb2,hl:#d65d0e\
 --color=bg+:#504945,fg+:#ebdbb2,hl+:#fabd2f\
 --color=info:#83a598,border:#458588,prompt:#98971a\
 --color=pointer:#FC4A34,marker:#fb4934,spinner:#fb4934,header:#cc241d"


typeset -U path PATH
# rancher desktop
[ -d "$HOME/.rd/bin" ] && path=($path $HOME/.rd/bin)
export PATH

eval "$(/opt/homebrew/bin/brew shellenv)"
