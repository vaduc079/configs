#!/bin/zsh
export ZDOTDIR=$HOME/.config/zsh

# For gnome-keyring and gcr-ssh-agent
export SSH_AUTH_SOCK=$XDG_RUNTIME_DIR/gcr/ssh

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

# autocomplete
autoload -U +X bashcompinit && bashcompinit
complete -o nospace -C /usr/bin/terraform terraform
complete -C '/usr/bin/aws_completer' aws

# fnm
FNM_PATH="/home/ducva/.local/share/fnm"
if [ -d "$FNM_PATH" ]; then
  export PATH="/home/ducva/.local/share/fnm:$PATH"
  eval "`fnm env --use-on-cd`"
fi

# starship prompt
eval "$(starship init zsh)"
