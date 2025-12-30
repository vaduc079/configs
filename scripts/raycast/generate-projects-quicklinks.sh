#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Generate Quicklinks JSON
# @raycast.mode silent
# @raycast.packageName Raycast Tools
# @raycast.icon 🔗

# Optional parameters:
# @raycast.argument1 { "type": "text", "placeholder": "root folder", "optional": true }
# @raycast.argument2 { "type": "text", "placeholder": "open with", "optional": true }
# @raycast.argument3 { "type": "text", "placeholder": "prefix", "optional": true }

# Documentation:
# @raycast.description Generate a JSON file for Import Quicklinks from a list of folders in the given directory.
# @raycast.author Duc Vu
# @raycast.authorURL https://github.com/vaduc079

set -euo pipefail

BASE_DIR="${1:-$HOME/projects}"
OUTPUT_FILE="$BASE_DIR/raycast-quicklinks.json"
OPEN_WITH="${2:-Cursor}"
PREFIX="$3"

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '%s' "$value"
}

if [[ ! -d "$BASE_DIR" ]]; then
  echo "Directory not found: $BASE_DIR" >&2
  exit 1
fi

shopt -s nullglob
directories=()
for entry in "$BASE_DIR"/*/; do
  directories+=("${entry%/}")
done
shopt -u nullglob

{
  echo "["
  first=1
  for dir in "${directories[@]}"; do
    if (( first )); then
      first=0
    else
      printf ',\n'
    fi

    base_name=${dir##*/}
    if [[ -n "$PREFIX" ]]; then
      name_value="${PREFIX}/${base_name}"
    else
      name_value="${base_name}"
    fi

    escaped_name=$(json_escape "$name_value")
    escaped_link=$(json_escape "$dir")

    printf '  {\n'
    printf '    "name": "%s",\n' "$escaped_name"
    printf '    "openWith": "%s",\n' "$OPEN_WITH"
    printf '    "link": "%s"\n' "$escaped_link"
    printf '  }'
  done
  echo
  echo "]"
} >"$OUTPUT_FILE"

echo "Written Raycast JSON to $OUTPUT_FILE"
