#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Paste with Quotes and Commas
# @raycast.mode silent
# @raycast.packageName Text Processing
# @raycast.icon 📋

# Optional parameters:
# @raycast.argument1 { "type": "text", "placeholder": "Quote character (default: \")", "optional": true }

# Documentation:
# @raycast.description Paste clipboard content with quotes and trailing commas around each line
# @raycast.author Duc Vu
# @raycast.authorURL https://github.com/vaduc079

# Set default quote character if not provided
quote_char="${1:-\"}"

# Get clipboard content
clipboard_content=$(pbpaste)

# Exit if clipboard is empty
if [ -z "$clipboard_content" ]; then
  echo "Clipboard is empty"
  exit 1
fi

# Process each line to format with quotes and comma
formatted_content=""
lines=()
while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip empty lines
  if [[ -n "$line" ]]; then
    lines+=("${quote_char}${line}${quote_char}")
  fi
done <<<"$clipboard_content"

# Join lines with comma and newline, except for the last line
total_lines=${#lines[@]}
for ((i = 0; i < total_lines; i++)); do
  formatted_content+="${lines[i]}"
  if ((i < total_lines - 1)); then
    formatted_content+=$',\n'
  fi
done

# Copy formatted content to clipboard temporarily
echo -e "$formatted_content" | pbcopy

# Simulate CMD+V to paste
osascript -e 'tell application "System Events" to keystroke "v" using command down'
