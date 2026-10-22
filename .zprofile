#!/bin/zsh

export EDITOR=nvim
export HOMEBREW_NO_ANALYTICS=1
# for shopback repositories
export SB_GIT_HOOKS_DIR=$HOME/.sb-git-hooks

export FZF_DEFAULT_OPTS=" \
 -m --highlight-line --pointer=''\
 --color=fg:#dcd7ba,bg:#1f1f28,hl:#c0a36e \
 --color=fg+:#dcd7ba,bg+:#2d4f67,hl+:#e6c384 \
 --color=info:#7e9cd8,prompt:#98bb6c,pointer:#e46876 \
 --color=marker:#98bb6c,spinner:#ffa066,header:#7e9cd8"
# Gruvbox
 # --color=bg:#282828,fg:#ebdbb2,hl:#d65d0e\
 # --color=bg+:#504945,fg+:#ebdbb2,hl+:#fabd2f\
 # --color=info:#83a598,border:#458588,prompt:#98971a\
 # --color=pointer:#FC4A34,marker:#fb4934,spinner:#fb4934,header:#cc241d"


typeset -U path PATH
# rancher desktop
[ -d "$HOME/.rd/bin" ] && path=($path $HOME/.rd/bin)
[ -d "$HOME/.local/bin" ] && path=($path $HOME/.local/bin)
[ -d "/opt/homebrew/opt/libpq/bin" ] && path=($path /opt/homebrew/opt/libpq/bin)
[ -d "$HOME/.opencode/bin" ] && path=($path $HOME/.opencode/bin)
export PATH

# static `brew shellenv` output, replace eval "$(brew shellenv)"; re-check after a major brew upgrade
export HOMEBREW_PREFIX=/opt/homebrew
export HOMEBREW_CELLAR=/opt/homebrew/Cellar
export HOMEBREW_REPOSITORY=/opt/homebrew
path=(/opt/homebrew/bin /opt/homebrew/sbin $path)
[ -z "${MANPATH-}" ] || export MANPATH=":${MANPATH#:}"
export INFOPATH="/opt/homebrew/share/info:${INFOPATH:-}"
# brew shell completion
FPATH=/opt/homebrew/share/zsh/site-functions:$FPATH

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/duc.vu/projects/apps/google-cloud-sdk/path.zsh.inc' ]; then . '/Users/duc.vu/projects/apps/google-cloud-sdk/path.zsh.inc'; fi

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
