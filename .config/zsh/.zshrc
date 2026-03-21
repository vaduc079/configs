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

# load plugins
source $ZDOTDIR/.plugins

# autocomplete
autoload -U +X bashcompinit && bashcompinit
# complete -o nospace -C /usr/bin/terraform terraform
complete -C '/usr/local/bin/aws_completer' aws

##################
# custom scripts #
##################
source $ZDOTDIR/scripts/yazi_wrapper.sh

# let gpg know where to read input from
export GPG_TTY=$(tty)

# starship prompt
eval "$(starship init zsh)"

eval "$(zoxide init zsh)"

eval "$(/opt/homebrew/bin/mise activate zsh)"
