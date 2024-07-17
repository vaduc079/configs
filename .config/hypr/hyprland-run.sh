#!/bin/sh

set -a
# Import environment.d variables by calling the systemd generator
eval "$(/usr/lib/systemd/user-environment-generators/30-systemd-environment-d-generator)"

# Source .zprofile here because greetd doesn't start a login shell
if [ -f $HOME/.zprofile ]; then
  . $HOME/.zprofile
fi

set +a

Hyprland $@
