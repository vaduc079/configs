#!/usr/bin/env zsh

set -euo pipefail

readonly ghostty_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/ghostty"
readonly active_keybinds="$ghostty_config_dir/keybinds/active.ghostty"
readonly herdr_keybinds="$ghostty_config_dir/keybinds/herdr.ghostty"
readonly herdr_bin="${HERDR_BIN_PATH:-$HOME/.local/bin/herdr}"

fail() {
  print -u2 -r -- "$1"
  exit 1
}

reload_ghostty_config() {
  /usr/bin/osascript \
    -e 'tell application "Ghostty"' \
    -e 'set targetTerminal to focused terminal of selected tab of front window' \
    -e 'perform action "reload_config" on targetTerminal' \
    -e 'end tell' >/dev/null
}

enable_herdr_keybinds() {
  ln -sfn "${herdr_keybinds:t}" "$active_keybinds"
  reload_ghostty_config
}

restore_default_keybinds() {
  local herdr_exit_status=$?

  rm -f -- "$active_keybinds"
  if ! reload_ghostty_config; then
    print -u2 -r -- "Failed to reload Ghostty's default keybindings"
  fi

  return "$herdr_exit_status"
}

main() {
  [[ -x "$herdr_bin" ]] || fail "Herdr not found or not executable: $herdr_bin"

  if [[ "${TERM_PROGRAM:-}" != "ghostty" ]]; then
    exec "$herdr_bin" "$@"
  fi

  [[ -f "$herdr_keybinds" ]] || fail "Herdr keybindings not found: $herdr_keybinds"

  trap restore_default_keybinds EXIT
  enable_herdr_keybinds
  "$herdr_bin" "$@"
}

main "$@"
