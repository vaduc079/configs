#!/bin/sh

# Get the focused app_id
app_id=$(swaymsg -t get_tree |
	jq -r '.. | select(.type?) | select(.focused==true) | .app_id')

# Check if the app_id matches "foot" or "footclient" and perform actions accordingly
if [ "$app_id" = "foot" ] || [ "$app_id" = "footclient" ]; then
	wtype -M shift -M ctrl v
else
	wtype -M ctrl v
fi
