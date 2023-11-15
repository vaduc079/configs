#!/bin/bash

is_url() {
	local url_regex="^(http|https):\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}([a-zA-Z0-9\/+=%&_\.~?\-]*)*$"

	if ! [[ $1 =~ $url_regex ]]; then
		show_notif 3000 "Not valid url: $1"
		exit 1
	fi
}

show_notif() {
	dunstify -t "$1" -r 7920 -u normal "$2"
}

url=$(xclip -o -selection clipboard)
is_url "$url"

show_notif 3000 "Open in MPV: $url"

if ! mpv "$url"; then
	show_notif 5000 "Error opening in MPV: $url"
fi
