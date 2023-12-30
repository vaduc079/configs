#!/bin/bash

# Capture the current clipboard
BEFORE="$(xclip -o -selection clipboard)"

rofi -modi "clipboard:greenclip print" -show clipboard -config ~/.config/rofi/rofidmenu.rasi
# sleep 0.1

# Capture the selection
TEXT="$(xclip -o -selection clipboard)"

# Only attempt to paste if there has been selection
if [ "${TEXT}" != "${BEFORE}" ]; then
	# xdotool type "$TEXT"
	xdotool key --clearmodifiers "ctrl+v"
fi
