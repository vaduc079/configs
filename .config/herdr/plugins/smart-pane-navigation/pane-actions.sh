#!/usr/bin/env bash

DEFAULT_CELL_HEIGHT_WIDTH_RATIO=2
CONTROLLED_PROCESS_PATTERN='^g?\.?(view|l?n?vim?x?|fzf|lumen|lazygit)(diff)?(-wrapped)?$'

fail() {
  printf '%s\n' "$*" >&2
  return 1
}

trim_whitespace() {
  local value=$1

  value="${value##+([[:space:]])}"
  value="${value%%+([[:space:]])}"
  printf '%s' "$value"
}

run_herdr() {
  local herdr=${HERDR_BIN_PATH:-herdr}
  local temp_dir output_file error_file status output detail

  temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/herdr-smart-pane.XXXXXX") || return 1
  output_file="$temp_dir/stdout"
  error_file="$temp_dir/stderr"

  if "$herdr" "$@" >"$output_file" 2>"$error_file"; then
    output=$(<"$output_file")
    rm -rf "$temp_dir"
    trim_whitespace "$output"
    return
  else
    status=$?
  fi

  detail=$(<"$error_file")
  if [[ -z $detail ]]; then
    detail=$(<"$output_file")
  fi
  rm -rf "$temp_dir"

  detail=$(trim_whitespace "$detail")
  if [[ -n $detail ]]; then
    fail "$herdr $* failed: $detail"
  else
    fail "$herdr $* failed"
  fi
  return "$status"
}

herdr_json() {
  local output

  output=$(run_herdr "$@") || return
  if [[ -z $output ]]; then
    fail "herdr $* returned no output"
    return
  fi

  if ! jq empty >/dev/null 2>&1 <<<"$output"; then
    fail "invalid JSON returned by herdr $*"
    return
  fi

  printf '%s' "$output"
}

split_direction() {
  local width=$1
  local height=$2
  local cell_height_width_ratio=$3

  jq -nr \
    --arg width "$width" \
    --arg height "$height" \
    --arg ratio "$cell_height_width_ratio" \
    'if (($height | tonumber) * ($ratio | tonumber)) > ($width | tonumber)
     then "down"
     else "right"
     end'
}

cell_height_width_ratio() {
  local value=${1-}
  local ratio

  if [[ -z $value ]]; then
    printf '%s' "$DEFAULT_CELL_HEIGHT_WIDTH_RATIO"
    return
  fi

  if ! ratio=$(jq -enr --arg value "$value" '
    $value | tonumber | select((isinfinite | not) and . > 0)
  '); then
    fail "invalid HERDR_SMART_SPLIT_CELL_RATIO: $value"
    return
  fi

  printf '%s' "$ratio"
}

process_controls_navigation() {
  local name

  for name in "$@"; do
    if grep -Eiq "$CONTROLLED_PROCESS_PATTERN" <<<"$name"; then
      return 0
    fi
  done

  return 1
}

required_pane_id() {
  local pane_id

  pane_id=$(trim_whitespace "${HERDR_PANE_ID-}")
  if [[ -z $pane_id ]]; then
    fail "HERDR_PANE_ID is unavailable"
    return
  fi

  printf '%s' "$pane_id"
}

find_pane() {
  local layout=$1
  local pane_id=$2
  local pane

  pane=$(jq -cer --arg pane_id "$pane_id" \
    '.panes[]? | select(.pane_id == $pane_id)' <<<"$layout") || true

  if [[ -z $pane ]]; then
    fail "layout for Herdr pane $pane_id not found"
    return
  fi

  printf '%s' "$pane"
}

smart_split() {
  local pane_id response layout pane dimensions width height ratio direction

  pane_id=$(required_pane_id) || return
  response=$(herdr_json pane layout --pane "$pane_id") || return
  layout=$(jq -c '.result.layout' <<<"$response") || return
  pane=$(find_pane "$layout" "$pane_id") || return

  if ! dimensions=$(jq -er '[.rect.width, .rect.height] | map(tonumber) | @tsv' <<<"$pane"); then
    fail "layout for Herdr pane $pane_id has invalid dimensions"
    return
  fi
  IFS=$'\t' read -r width height <<<"$dimensions"

  ratio=$(cell_height_width_ratio "${HERDR_SMART_SPLIT_CELL_RATIO-}") || return
  direction=$(split_direction "$width" "$height" "$ratio") || return
  run_herdr pane split "$pane_id" --direction "$direction" --focus >/dev/null
}

navigate() {
  local direction=$1
  local key pane_id response
  local process_names=()

  case "$direction" in
    left) key='ctrl+h' ;;
    down) key='ctrl+j' ;;
    up) key='ctrl+k' ;;
    right) key='ctrl+l' ;;
    *)
      fail "invalid navigation direction: ${direction:-<empty>}"
      return
      ;;
  esac

  pane_id=$(required_pane_id) || return
  response=$(herdr_json pane process-info --pane "$pane_id") || return

  while IFS= read -r name; do
    process_names+=("$name")
  done < <(jq -r '.result.process_info.foreground_processes[]?.name // ""' <<<"$response")

  if process_controls_navigation "${process_names[@]}"; then
    run_herdr pane send-keys "$pane_id" "$key" >/dev/null
    return
  fi

  run_herdr pane focus --direction "$direction" --pane "$pane_id" >/dev/null
}

main() {
  local action=${1-}
  local direction=${2-}

  case "$action" in
    smart-split) smart_split ;;
    navigate) navigate "$direction" ;;
    *) fail 'usage: pane-actions.sh <smart-split|navigate DIRECTION>' ;;
  esac
}

shopt -s extglob

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
