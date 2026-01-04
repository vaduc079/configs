#!/bin/bash

# Configuration
DEBUG_ENABLED=false
SOUND_NAME="Ping"

# Read JSON input from stdin
input=$(cat)

# DEBUG: Log the full JSON to a file for inspection
if [ "$DEBUG_ENABLED" = true ]; then
  debug_file=~/.claude/hooks/notification-debug.log
  {
    echo "=== Notification received at $(date) ==="
    echo "$input" | jq '.'
    echo ""
  } >> "$debug_file"
fi

# Extract fields
message=$(echo "$input" | jq -r '.message // "Claude Code notification"')
notification_type=$(echo "$input" | jq -r '.notification_type // "unknown"')

# Customize title based on type
case "$notification_type" in
  "idle_prompt")
    title="Claude Code Waiting"
    ;;
  "permission_prompt")
    title="Claude Code Permission"
    ;;
  *)
    title="Claude Code"
    ;;
esac

# Send macOS notification with actual message content
osascript -e "display notification \"$message\" with title \"$title\" sound name \"$SOUND_NAME\""

# DEBUG: Send a second notification with debug info
if [ "$DEBUG_ENABLED" = true ]; then
  debug_msg="Type: $notification_type | Keys: $(echo "$input" | jq -r 'keys | join(", ")')"
  osascript -e "display notification \"$debug_msg\" with title \"Claude Code Debug\""
fi

exit 0
