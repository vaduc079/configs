#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Base64 Decode
# @raycast.mode silent
# @raycast.packageName Developer Utilities
#
# Optional parameters:
# @raycast.icon 🔓
# @raycast.needsConfirmation false
# @raycast.argument1 { "type": "text", "placeholder": "base64 text", "optional": true }
#
# Documentation:
# @raycast.description Decode base64 encoded text
# @raycast.author Duc Vu
# @raycast.authorURL https://github.com/vaduc079

if [ -z "$1" ]; then
  # No argument provided, use clipboard content
  input=$(pbpaste)
else
  input="$1"
fi

echo "$input" | base64 --decode | pbcopy
echo "Copied to clipboard"
