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
  } >>"$debug_file"
fi

# Extract fields
message=$(echo "$input" | jq -r '.message // "Claude Code notification"')
notification_type=$(echo "$input" | jq -r '.notification_type // "unknown"')
input_title=$(echo "$input" | jq -r '.title // empty')

# Build agent indicator: prefer session summary title, fall back to project name + session suffix
session_id=$(echo "$input" | jq -r '.session_id // empty')
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')
cwd=$(echo "$input" | jq -r '.cwd // empty')

session_title=""
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  # grep is faster than jq for scanning large files; parse only the matched line
  session_title=$(grep '"type":"ai-title"' "$transcript_path" | tail -1 | jq -r '.aiTitle // empty' 2>/dev/null)
fi

# agent_label: prefer ai-title, fall back to "project #suffix"
project_name=$(basename "$cwd")
session_suffix="${session_id: -4}"
agent_label="${session_title:-${project_name}${session_suffix:+ #$session_suffix}}"

# type_label for message prefix; fallback_title used only when agent_label is unavailable
case "$notification_type" in
"idle_prompt")        type_label="Waiting" ;;
"permission_prompt")  type_label="Permission" ;;
"auth_success")       type_label="Auth" ;;
"elicitation_dialog") type_label="Input Needed" ;;
"elicitation_complete") type_label="Done" ;;
"elicitation_response") type_label="Response" ;;
*)                    type_label="$notification_type" ;;
esac
fallback_title="${input_title:-Claude Code ${type_label}}"

# Send macOS notification
if [ -n "$agent_label" ]; then
  formatted_message="[$type_label] $message"
  osascript -e "display notification \"$formatted_message\" with title \"$agent_label\" sound name \"$SOUND_NAME\""
else
  osascript -e "display notification \"$message\" with title \"$fallback_title\" sound name \"$SOUND_NAME\""
fi

# DEBUG: Send a second notification with debug info
if [ "$DEBUG_ENABLED" = true ]; then
  debug_msg="Type: $notification_type | Keys: $(echo "$input" | jq -r 'keys | join(", ")')"
  osascript -e "display notification \"$debug_msg\" with title \"Claude Code Debug\""
fi

exit 0
