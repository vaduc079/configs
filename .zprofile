#!/bin/zsh

export EDITOR=nvim

export XMODIFIERS=@im=fcitx
#export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx

typeset -U path PATH
[ -d "$HOME/.local/bin" ] && path=($path $HOME/.local/bin)
export PATH
