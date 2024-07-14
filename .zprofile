#!/bin/zsh

export EDITOR=nvim
export XMODIFIERS=@im=fcitx
export QT_IM_MODULE=fcitx
# Fix firefox flickering with fcitx5, set until fcitx5 v5.1.10
# Might want to remove gtk-im-module set in .config/gtk-4.0/settings.ini too
export GTK_IM_MODULE=fcitx

# typeset -U path PATH
# [ -d "$HOME/.local/bin" ] && path=($path $HOME/.local/bin)
# export PATH
