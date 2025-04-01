#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Toggle Night Shift
# @raycast.mode silent
# @raycast.packageName System
#
# Optional parameters:
# @raycast.icon 🌙
# @raycast.needsConfirmation false
#
# Documentation:
# @raycast.description Toggle macOS Night Shift, needs to have Night Shift set up in Shortcuts
# @raycast.author Duc Vu
# @raycast.authorURL https://github.com/vaduc079

# Check current Night Shift status
is_enabled=$(/usr/libexec/corebrightnessdiag nightshift | grep -c "    BlueReductionEnabled = 1")

if [ "$is_enabled" -eq 1 ]; then
  shortcuts run 'Night Shift' -i off
  echo "Night Shift turned off"
else
  shortcuts run 'Night Shift'
  echo "Night Shift turned on"
fi
