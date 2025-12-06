#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Base64 Encode
# @raycast.mode silent
# @raycast.packageName Developer Utilities
#
# Optional parameters:
# @raycast.icon 🔐
# @raycast.needsConfirmation false
# @raycast.argument1 { "type": "text", "placeholder": "text", "optional": true }
#
# Documentation:
# @raycast.description Encode any text data by using base64
# @raycast.author Duc Vu
# @raycast.authorURL https://github.com/vaduc079

if [ -z "$1" ]; then
  # No argument provided, use clipboard content
  input=$(pbpaste)
else
  input="$1"
fi

echo -n "$input" | base64 | pbcopy
echo "Copied to clipboard"
