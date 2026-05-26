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
[ -d "$HOME/.local/bin" ] && path=($path $HOME/.local/bin)
[ -d "/opt/homebrew/opt/libpq/bin" ] && path=($path /opt/homebrew/opt/libpq/bin)
export PATH

# brew shell completion
if type brew &>/dev/null; then
  FPATH="$(brew --prefix)/share/zsh/site-functions:${FPATH}"
fi


eval "$(/opt/homebrew/bin/brew shellenv)"

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/duc.vu/projects/apps/google-cloud-sdk/path.zsh.inc' ]; then . '/Users/duc.vu/projects/apps/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/Users/duc.vu/projects/apps/google-cloud-sdk/completion.zsh.inc' ]; then . '/Users/duc.vu/projects/apps/google-cloud-sdk/completion.zsh.inc'; fi

# bun completions
[ -s "/Users/duc.vu/.bun/_bun" ] && source "/Users/duc.vu/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
