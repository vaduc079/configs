#!/bin/zsh
export ZDOTDIR=$HOME/.config/zsh
export HOMEBREW_NO_AUTO_UPDATE=1

# history
HISTFILE=~/.config/zsh/.histfile
HISTSIZE=1000
SAVEHIST=1000
setopt HIST_FIND_NO_DUPS
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_SPACE
setopt INC_APPEND_HISTORY

bindkey -v

# The following lines were added by compinstall
zstyle :compinstall filename '$HOME/.zshrc'

# completion
zstyle ':completion:*' menu select

# load local env
source $ZDOTDIR/.shenv

# set aliases
source $HOME/.aliases
source $HOME/.aliases.sb

# load keybindings
source $ZDOTDIR/.keybindings

# generated scripts are cached here and regenerated when the tool's binary is newer
ZSH_CACHE_DIR=${XDG_CACHE_HOME:-$HOME/.cache}/zsh

# usage: _cached_init starship init zsh
_cached_init() {
  local cache=$ZSH_CACHE_DIR/$1.zsh bin=${commands[$1]}
  [[ -n $bin ]] || return
  [[ -s $cache && $cache -nt $bin ]] || { mkdir -p ${cache:h}; "$@" >| $cache }
  source $cache
}

# rex completion on fpath, must come before compinit
if (( $+commands[rex] )); then
  [[ -s $ZSH_CACHE_DIR/completions/_rex && $ZSH_CACHE_DIR/completions/_rex -nt $commands[rex] ]] ||
    { mkdir -p $ZSH_CACHE_DIR/completions; rex completion zsh >| $ZSH_CACHE_DIR/completions/_rex }
  fpath=($ZSH_CACHE_DIR/completions $fpath)
fi

# load plugins
source $ZDOTDIR/.plugins

# The next line enables shell command completion for gcloud.
if [ -f '/Users/duc.vu/projects/apps/google-cloud-sdk/completion.zsh.inc' ]; then . '/Users/duc.vu/projects/apps/google-cloud-sdk/completion.zsh.inc'; fi

# autocomplete
autoload -U +X bashcompinit && bashcompinit
# complete -o nospace -C /usr/bin/terraform terraform
complete -C '/usr/local/bin/aws_completer' aws

##################
# custom scripts #
##################
source $ZDOTDIR/scripts/local_env_toggle.sh
source $ZDOTDIR/scripts/yazi_wrapper.sh
source $ZDOTDIR/scripts/git_wt_wrapper.zsh

# let gpg know where to read input from
[[ -n $TTY ]] && export GPG_TTY=$TTY

# starship prompt
# eval "$(starship init zsh)"

# native zsh prompt
source $ZDOTDIR/scripts/prompt.zsh

_cached_init zoxide init zsh

eval "$(/opt/homebrew/bin/mise activate zsh)"

# bun completions
[ -s "/Users/duc.vu/.bun/_bun" ] && source "/Users/duc.vu/.bun/_bun"
