#!/usr/bin/env zsh

set -euo pipefail

readonly DEFAULT_WEZTERM_EXECUTABLE="/opt/homebrew/bin/wezterm"
readonly DEFAULT_EDITOR_COMMAND="nvim"

usage() {
  echo "Usage: wezterm-open-nvim <directory>" >&2
}

fail() {
  echo "$1" >&2
  exit 1
}

expand_input_path() {
  local input_path="$1"

  if [[ "$input_path" == "~" ]]; then
    print -r -- "$HOME"
    return
  fi

  if [[ "$input_path" == "~/"* ]]; then
    print -r -- "$HOME/${input_path#~/}"
    return
  fi

  if [[ "$input_path" == /* ]]; then
    print -r -- "$input_path"
    return
  fi

  print -r -- "$PWD/$input_path"
}

normalize_directory_path() {
  local input_path="$1"
  local expanded_path

  expanded_path="$(expand_input_path "$input_path")"
  [[ -d "$expanded_path" ]] || fail "Directory not found: $input_path"

  (
    cd -- "$expanded_path" &&
      pwd -P
  )
}

spawn_nvim() {
  local target_path="$1"
  local shell_executable="${SHELL:-/bin/zsh}"
  local shell_name="${shell_executable:t}"
  local shell_flag="-c"

  if [[ "$shell_name" == "zsh" || "$shell_name" == "bash" ]]; then
    shell_flag="-lic"
  fi

  "$DEFAULT_WEZTERM_EXECUTABLE" cli spawn \
    --cwd "$target_path" \
    -- \
    "$shell_executable" \
    "$shell_flag" \
    "exec '$DEFAULT_EDITOR_COMMAND'"
}

list_panes() {
  ruby -rjson -ruri -e '
    def normalize_path(raw_value)
      return nil unless raw_value.is_a?(String)

      trimmed_value = raw_value.strip
      return nil if trimmed_value.empty?

      path_value =
        if trimmed_value.start_with?("file:")
          URI(trimmed_value).path
        else
          trimmed_value
        end

      begin
        File.realpath(path_value)
      rescue StandardError
        File.expand_path(path_value)
      end
    rescue StandardError
      nil
    end

    pane_values = JSON.parse(STDIN.read)
    exit 0 unless pane_values.is_a?(Array)

    pane_values.each do |pane|
      next unless pane.is_a?(Hash)
      next unless pane["pane_id"].is_a?(Integer)

      pane_id = pane["pane_id"]
      pane_path = normalize_path(pane["cwd"]).to_s
      tty_name = pane["tty_name"].to_s

      puts [pane_id, pane_path, tty_name].join("\t")
    end
  '
}

get_foreground_command_basename() {
  local tty_name="$1"
  local tty_basename="${tty_name:t}"
  local ps_output
  local foreground_command

  [[ -n "$tty_basename" ]] || return 0

  if ! ps_output="$(ps -t "$tty_basename" -o state= -o comm= 2>/dev/null)"; then
    return 0
  fi

  foreground_command="$(
    printf '%s\n' "$ps_output" |
      awk '$1 ~ /\+/ { print $2; exit }'
  )"

  [[ -n "$foreground_command" ]] || return 0
  print -r -- "${foreground_command:t}"
}

find_reusable_pane_id() {
  local target_path="$1"
  local pane_list_json
  local pane_id
  local pane_path
  local tty_name
  local foreground_command

  if ! pane_list_json="$("$DEFAULT_WEZTERM_EXECUTABLE" cli list --format json 2>/dev/null)"; then
    return 0
  fi

  while IFS=$'\t' read -r pane_id pane_path tty_name; do
    [[ -n "$pane_path" ]] || continue
    [[ "$pane_path" == "$target_path" ]] || continue

    foreground_command="$(get_foreground_command_basename "$tty_name")"
    [[ "$foreground_command" == "$DEFAULT_EDITOR_COMMAND" ]] || continue

    print -r -- "$pane_id"
    return 0
  done < <(printf '%s' "$pane_list_json" | list_panes)
}

main() {
  local input_path="${1:-}"
  local target_path
  local pane_id

  [[ $# -eq 1 ]] || {
    usage
    exit 1
  }

  [[ -n "$input_path" ]] || {
    usage
    exit 1
  }

  [[ -x "$DEFAULT_WEZTERM_EXECUTABLE" ]] || {
    fail "WezTerm executable not found at $DEFAULT_WEZTERM_EXECUTABLE"
  }

  target_path="$(normalize_directory_path "$input_path")"
  pane_id="$(find_reusable_pane_id "$target_path")"

  if [[ -n "$pane_id" ]]; then
    "$DEFAULT_WEZTERM_EXECUTABLE" cli activate-pane --pane-id "$pane_id"
    open -a WezTerm >/dev/null 2>&1 || true
    return
  fi

  spawn_nvim "$target_path"
  open -a WezTerm >/dev/null 2>&1 || true
}

main "$@"
