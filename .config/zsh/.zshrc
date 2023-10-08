#!/bin/zsh
export ZDOTDIR=$HOME/.config/zsh

# history
HISTFILE=~/.config/zsh/.histfile
HISTSIZE=1000
SAVEHIST=1000
setopt HIST_FIND_NO_DUPS
setopt HIST_IGNORE_ALL_DUPS
setopt INC_APPEND_HISTORY

bindkey -v
# End of lines configured by zsh-newuser-install
# The following lines were added by compinstall
zstyle :compinstall filename '/home/ducv/.zshrc'

autoload -Uz compinit
compinit
# End of lines added by compinstall

# completion
zstyle ':completion:*' menu select

# set aliases
source $HOME/.aliases

# load keybindings
source $ZDOTDIR/.keybindings

# load plugins
source $ZDOTDIR/.plugins

# fnm
export PATH="/home/ducv/.local/share/fnm:$PATH"
eval "`fnm env`"

# starship prompt
eval "$(starship init zsh)"
