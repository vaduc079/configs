#!/usr/bin/env bash

# Claude Code statusline script
# Outputs a single-line status display for the Agent project

input=$(cat)
# echo "$input" >~/configs/.claude/statusline.json

# --- Config ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/statusline.conf"
[ -f "$CONFIG_FILE" ] && source "$CONFIG_FILE"

# Defaults (if config missing)
SHOW_MODEL=${SHOW_MODEL:-true}
SHOW_DIR=${SHOW_DIR:-true}
SHOW_BRANCH=${SHOW_BRANCH:-true}
SHOW_CONTEXT=${SHOW_CONTEXT:-true}
SHOW_COST=${SHOW_COST:-true}
SHOW_DURATION=${SHOW_DURATION:-true}
SHOW_RATE_LIMITS=${SHOW_RATE_LIMITS:-true}
ICON_FOLDER=${ICON_FOLDER:-"📁"}
ICON_BRANCH=${ICON_BRANCH:-"🌱"}
ICON_CONTEXT=${ICON_CONTEXT:-""}
ICON_TIME=${ICON_TIME:-"🕒"}
COLOR_MODEL=${COLOR_MODEL:-'\033[36m'}
COLOR_COST=${COLOR_COST:-'\033[33m'}
COLOR_BAR_OK=${COLOR_BAR_OK:-'\033[32m'}
COLOR_BAR_WARN=${COLOR_BAR_WARN:-'\033[33m'}
COLOR_BAR_CRIT=${COLOR_BAR_CRIT:-'\033[31m'}
COLOR_RESET=${COLOR_RESET:-'\033[0m'}

# --- Model + Directory + Git Branch ---

model_name=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
dir_basename=$(basename "$cwd")

# Git branch with caching (5-second TTL, keyed by directory hash)
dir_hash=$(echo "$cwd" | md5 | cut -c1-8)
CACHE_FILE="/tmp/statusline-git-cache-${dir_hash}"
git_branch=""

if [ -n "$cwd" ]; then
  now=$(date +%s)
  cache_valid=false

  if [ -f "$CACHE_FILE" ]; then
    cache_time=$(head -1 "$CACHE_FILE" 2>/dev/null)
    cache_dir=$(sed -n '2p' "$CACHE_FILE" 2>/dev/null)
    cache_branch=$(sed -n '3p' "$CACHE_FILE" 2>/dev/null)

    if [ -n "$cache_time" ] && [ -n "$cache_dir" ] && [ "$cache_dir" = "$cwd" ]; then
      age=$((now - cache_time))
      if [ "$age" -lt 5 ]; then
        git_branch="$cache_branch"
        cache_valid=true
      fi
    fi
  fi

  if [ "$cache_valid" = false ]; then
    git_branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null || echo "")
    printf '%s\n%s\n%s\n' "$now" "$cwd" "$git_branch" >"$CACHE_FILE"
  fi
fi

# Build info segment from enabled sub-sections
info=""
if [ "$SHOW_MODEL" = true ]; then
  info=$(printf "${COLOR_MODEL}[%s]${COLOR_RESET}" "$model_name")
fi
if [ "$SHOW_DIR" = true ]; then
  info="$info ${ICON_FOLDER} ${dir_basename}"
fi
if [ "$SHOW_BRANCH" = true ] && [ -n "$git_branch" ]; then
  info="$info | ${ICON_BRANCH} ${git_branch}"
fi
info="${info# }" # trim leading space

# --- Context window progress bar ---

bar_part=""
if [ "$SHOW_CONTEXT" = true ]; then
  used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

  if [ -n "$used_pct" ]; then
    pct_int=$(printf '%.0f' "$used_pct")
    filled=$((pct_int * 10 / 100))
    [ "$filled" -gt 10 ] && filled=10
    empty=$((10 - filled))

    bar=""
    for ((i = 0; i < filled; i++)); do bar="${bar}█"; done
    for ((i = 0; i < empty; i++)); do bar="${bar}░"; done

    if [ "$pct_int" -ge 90 ]; then
      bar_colored=$(printf "${COLOR_BAR_CRIT}%s${COLOR_RESET}" "$bar")
    elif [ "$pct_int" -ge 70 ]; then
      bar_colored=$(printf "${COLOR_BAR_WARN}%s${COLOR_RESET}" "$bar")
    else
      bar_colored=$(printf "${COLOR_BAR_OK}%s${COLOR_RESET}" "$bar")
    fi

    # Calculate current token usage from current_usage object
    current_input=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // 0')
    cache_creation=$(echo "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
    cache_read=$(echo "$input" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
    current_tokens=$((current_input + cache_creation + cache_read))

    # Format token count (e.g., 72.6k or 205k)
    if [ "$current_tokens" -ge 1000 ]; then
      tokens_display=$(awk -v t="$current_tokens" 'BEGIN {printf "%.1fk", t/1000}' | sed 's/\.0k/k/')
    else
      tokens_display="${current_tokens}"
    fi

    # Color code the token display based on thresholds
    tokens_colored=""
    if [ "$current_tokens" -gt 200000 ]; then
      tokens_colored=$(printf "${COLOR_BAR_CRIT}%s${COLOR_RESET}" "$tokens_display")
    elif [ "$current_tokens" -ge 140000 ]; then
      tokens_colored=$(printf "${COLOR_BAR_WARN}%s${COLOR_RESET}" "$tokens_display")
    else
      tokens_colored="$tokens_display"
    fi

    bar_part=$(printf "%s %s %d%% (%s)" "$ICON_CONTEXT" "$bar_colored" "$pct_int" "$tokens_colored")
  else
    bar_part=$(printf "%s ${COLOR_BAR_OK}░░░░░░░░░░${COLOR_RESET} 0%%" "$ICON_CONTEXT")
  fi
fi

# --- Cost ---

cost_part=""
if [ "$SHOW_COST" = true ]; then
  cost_usd=$(echo "$input" | jq -r '.cost.total_cost_usd // empty')
  if [ -n "$cost_usd" ]; then
    cost=$(echo "$cost_usd" | awk '{printf "%.2f", $1}')
  else
    cost="0.00"
  fi
  cost_part=$(printf "${COLOR_COST}\$%s${COLOR_RESET}" "$cost")
fi

# --- Session duration ---

duration_part=""
if [ "$SHOW_DURATION" = true ]; then
  transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')
  duration_str="-"
  if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    file_mtime=$(stat -f %B "$transcript_path" 2>/dev/null || echo "0")
    if [ "$file_mtime" -eq 0 ] 2>/dev/null; then
      file_mtime=$(stat -f %m "$transcript_path" 2>/dev/null || stat -c %Y "$transcript_path" 2>/dev/null || echo "")
    fi
    if [ -n "$file_mtime" ] && [ "$file_mtime" -gt 0 ]; then
      now_ts=$(date +%s)
      elapsed=$((now_ts - file_mtime))
      minutes=$((elapsed / 60))
      hours=$((minutes / 60))
      days=$((hours / 24))
      if [ "$days" -ge 1 ]; then
        remaining_hours=$((hours % 24))
        duration_str=$(printf "%dd %dh" "$days" "$remaining_hours")
      elif [ "$hours" -ge 1 ]; then
        remaining_mins=$((minutes % 60))
        duration_str=$(printf "%dh %dm" "$hours" "$remaining_mins")
      else
        duration_str=$(printf "%dm" "$minutes")
      fi
    fi
  fi
  duration_part="${ICON_TIME} ${duration_str}"
fi

# --- Rate limits ---

rate_part=""
if [ "$SHOW_RATE_LIMITS" = true ]; then
  five_hour_used=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
  seven_day_used=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

  if [ -n "$five_hour_used" ] && [ -n "$seven_day_used" ]; then
    five_left=$(awk -v u="$five_hour_used" 'BEGIN {printf "%.0f", 100 - u}')
    seven_left=$(awk -v u="$seven_day_used" 'BEGIN {printf "%.0f", 100 - u}')
    rate_part=$(printf "5h • %s%% - 7d • %s%%" "$five_left" "$seven_left")
  fi
fi

# --- Assemble output from enabled parts ---

parts=()
[ -n "$info" ] && parts+=("$info")
[ -n "$bar_part" ] && parts+=("$bar_part")
[ -n "$cost_part" ] && parts+=("$cost_part")
[ -n "$duration_part" ] && parts+=("$duration_part")
[ -n "$rate_part" ] && parts+=("$rate_part")

output="${parts[0]}"
for part in "${parts[@]:1}"; do output="$output | $part"; done
printf "%b\n" "$output"
