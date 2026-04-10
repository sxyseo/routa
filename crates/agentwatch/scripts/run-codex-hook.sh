#!/usr/bin/env bash
set -euo pipefail

HOOK_EVENT="${1:-}"
if [ -z "$HOOK_EVENT" ]; then
  echo "usage: run-codex-hook.sh <event>" >&2
  exit 64
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if [ -n "${TMUX:-}" ]; then
  export TMUX_SESSION="${TMUX_SESSION:-$(tmux display-message -p '#{session_name}' 2>/dev/null || true)}"
  export TMUX_WINDOW="${TMUX_WINDOW:-$(tmux display-message -p '#{window_index}' 2>/dev/null || true)}"
  export TMUX_PANE="${TMUX_PANE:-$(tmux display-message -p '#{pane_id}' 2>/dev/null || true)}"
  export TMUX_PANE_TITLE="${TMUX_PANE_TITLE:-$(tmux display-message -p '#{pane_title}' 2>/dev/null || true)}"
fi

resolve_agentwatch_bin() {
  if [ -n "${AGENTWATCH_BIN:-}" ] && [ -x "${AGENTWATCH_BIN}" ]; then
    printf '%s\n' "${AGENTWATCH_BIN}"
    return 0
  fi

  if [ -x "$REPO_ROOT/target/debug/agentwatch" ]; then
    printf '%s\n' "$REPO_ROOT/target/debug/agentwatch"
    return 0
  fi

  if [ -x "$REPO_ROOT/target/release/agentwatch" ]; then
    printf '%s\n' "$REPO_ROOT/target/release/agentwatch"
    return 0
  fi

  if command -v agentwatch >/dev/null 2>&1; then
    command -v agentwatch
    return 0
  fi

  return 1
}

AGENTWATCH_BIN="$(resolve_agentwatch_bin || true)"
if [ -z "$AGENTWATCH_BIN" ]; then
  cat >/dev/null 2>&1 || true
  exit 0
fi

exec "$AGENTWATCH_BIN" --repo "$REPO_ROOT" hook codex "$HOOK_EVENT"
