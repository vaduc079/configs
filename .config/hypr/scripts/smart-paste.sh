#!/bin/sh

# Get the focused app_id
class=$(hyprctl activewindow -j | jq -r '.class')

# Check if the app_id matches "foot" or "footclient" and perform actions accordingly
if [ "$class" = "foot" ] || [ "$class" = "footclient" ]; then
	wtype -M shift -M ctrl v
else
	wtype -M ctrl v
fi
