#!/usr/bin/env zsh

set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

herdr_bin="${HERDR_BIN_PATH:-${HERDR_BIN:-$HOME/.local/bin/herdr}}"

[[ -x "$herdr_bin" ]] || fail "herdr not found or not executable: ${herdr_bin:-herdr}"
command -v jq >/dev/null 2>&1 || fail "jq not found"

layout_json="$("$herdr_bin" pane layout --current)"
pane_info="$(
  jq -r '
    .result.layout as $layout
    | $layout.focused_pane_id as $pane
    | $layout.panes[]?
    | select(.pane_id == $pane)
    | [$pane, .rect.width, .rect.height]
    | @tsv
  ' <<<"$layout_json"
)"

[[ -n "$pane_info" ]] || fail "layout for current Herdr pane not found"

current_pane="${pane_info%%$'\t'*}"
pane_size="${pane_info#*$'\t'}"
pane_width="${pane_size%%$'\t'*}"
pane_height="${pane_size##*$'\t'}"
cell_height_width_ratio="${HERDR_SMART_SPLIT_CELL_RATIO:-2.0}"
pixel_adjusted_height="$(( pane_height * cell_height_width_ratio ))"

if (( pixel_adjusted_height > pane_width )); then
  split_direction="down"
else
  split_direction="right"
fi

exec "$herdr_bin" pane split "$current_pane" --direction "$split_direction" --focus
