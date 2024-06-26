#!/bin/sh

# Session
export XDG_SESSION_TYPE=wayland
export XDG_SESSION_DESKTOP=sway
export XDG_CURRENT_DESKTOP=sway

set -a
# Import local user or openSUSEway environment variables
if [ -f $HOME/.config/sway/env ]; then
	. $HOME/.config/sway/env
else
	. /etc/sway/env
fi

# Import environment.d variables by calling the systemd generator
eval "$(/usr/lib/systemd/user-environment-generators/30-systemd-environment-d-generator)"

# Source .zprofile here because greetd doesn't start a login shell
if [ -f $HOME/.zprofile ]; then
	. $HOME/.zprofile
fi

set +a

# Set dependencies to run with proprietary drivers
if grep -qE "nvidia|fglrx" /proc/modules; then
	export WLR_NO_HARDWARE_CURSORS=1
	unsupported_gpu="--unsupported-gpu"
else
	unsupported_gpu=""
fi

# Start the Sway session
systemctl --user start sway-session.target

sway $unsupported_gpu $@
