#!/usr/bin/env bash

set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/pane-actions.sh"

tests_run=0

assert_equal() {
  local expected=$1
  local actual=$2
  local description=$3

  tests_run=$((tests_run + 1))
  if [[ $actual == "$expected" ]]; then
    printf 'ok %d - %s\n' "$tests_run" "$description"
    return
  fi

  printf 'not ok %d - %s\n' "$tests_run" "$description"
  printf '  expected: %s\n' "$expected"
  printf '  actual:   %s\n' "$actual"
  exit 1
}

assert_succeeds() {
  local description=$1
  shift

  tests_run=$((tests_run + 1))
  if "$@"; then
    printf 'ok %d - %s\n' "$tests_run" "$description"
    return
  fi

  printf 'not ok %d - %s\n' "$tests_run" "$description"
  exit 1
}

assert_fails() {
  local description=$1
  shift

  tests_run=$((tests_run + 1))
  if "$@" >/dev/null 2>&1; then
    printf 'not ok %d - %s\n' "$tests_run" "$description"
    exit 1
  fi

  printf 'ok %d - %s\n' "$tests_run" "$description"
}

assert_equal down "$(split_direction 80 50 2)" 'splits a visually tall pane downward'
assert_equal right "$(split_direction 120 40 2)" 'splits a visually wide pane to the right'

assert_equal 2 "$(cell_height_width_ratio)" 'uses two when no override is configured'
assert_equal 1.75 "$(cell_height_width_ratio 1.75)" 'accepts a positive numeric override'
assert_fails 'rejects a nonnumeric ratio' cell_height_width_ratio wide
assert_fails 'rejects a zero ratio' cell_height_width_ratio 0
assert_fails 'rejects an infinite ratio' cell_height_width_ratio Infinity
assert_fails 'rejects an overflowing ratio' cell_height_width_ratio 1e999

for process_name in vim nvim nvimdiff fzf lumen lazygit; do
  assert_succeeds "recognizes $process_name as controlling navigation" \
    process_controls_navigation "$process_name"
done

assert_fails 'ignores unrelated foreground processes' \
  process_controls_navigation zsh codex

assert_fails 'propagates a failed Herdr command' \
  env HERDR_BIN_PATH=false HERDR_PANE_ID=pane-1 \
  bash "$SCRIPT_DIR/pane-actions.sh" navigate left

TEST_CALLS=$(mktemp "${TMPDIR:-/tmp}/smart-pane-test.XXXXXX")
trap 'rm -f "$TEST_CALLS"' EXIT

mock_process_name=zsh

run_herdr() {
  case "$*" in
    'pane layout --pane pane-1')
      printf '%s' '{"result":{"layout":{"panes":[{"pane_id":"pane-1","rect":{"width":80,"height":50}}]}}}'
      ;;
    'pane process-info --pane pane-1')
      printf '{"result":{"process_info":{"foreground_processes":[{"name":"%s"}]}}}' \
        "$mock_process_name"
      ;;
    *)
      printf '%s\n' "$*" >>"$TEST_CALLS"
      ;;
  esac
}

HERDR_PANE_ID=pane-1 smart_split
assert_equal 'pane split pane-1 --direction down --focus' "$(tail -n 1 "$TEST_CALLS")" \
  'smart split invokes Herdr with the visual-axis direction'

mock_process_name=nvim
HERDR_PANE_ID=pane-1 navigate left
assert_equal 'pane send-keys pane-1 ctrl+h' "$(tail -n 1 "$TEST_CALLS")" \
  'navigation is forwarded to a controlled process'

mock_process_name=zsh
HERDR_PANE_ID=pane-1 navigate right
assert_equal 'pane focus --direction right --pane pane-1' "$(tail -n 1 "$TEST_CALLS")" \
  'navigation focuses an adjacent pane for other processes'

printf '1..%d\n' "$tests_run"
