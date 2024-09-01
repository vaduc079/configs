#!/bin/zsh
export ZDOTDIR=$HOME/.config/zsh

# history
HISTFILE=~/.config/zsh/.histfile
HISTSIZE=1000
SAVEHIST=1000
setopt HIST_FIND_NO_DUPS
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_SPACE
setopt INC_APPEND_HISTORY

bindkey -v
# End of lines configured by zsh-newuser-install
# The following lines were added by compinstall
zstyle :compinstall filename '$HOME/.zshrc'

# brew shell completion
if type brew &>/dev/null
then
  FPATH="$(brew --prefix)/share/zsh/site-functions:${FPATH}"
fi

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

# autocomplete
autoload -U +X bashcompinit && bashcompinit
# complete -o nospace -C /usr/bin/terraform terraform
# complete -C '/usr/bin/aws_completer' aws

# let gpg know where to read input from
export GPG_TTY=$(tty)

# use mise tools without prefix
eval "$(/opt/homebrew/bin/mise activate zsh)"

# starship prompt
eval "$(starship init zsh)"
