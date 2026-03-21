#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Smart Pre-Push Check Script
# ═══════════════════════════════════════════════════════════════════════════════
#
# Runs entrix-backed pre-push fitness checks before push. On failure:
#   - In AI agent environment → Output clear error message for AI to fix
#   - In human environment → Optionally auto-fix with claude -p
#
# Usage:
#   ./scripts/smart-check.sh           # Run checks
#   ./scripts/smart-check.sh --fix     # Run checks, auto-fix on failure (human mode)
#
# Environment variables for AI detection:
#   CLAUDE_CODE=1, ANTHROPIC_AGENT=1, AUGMENT_AGENT=1, CURSOR_AGENT=1,
#   GITHUB_ACTIONS=1, CI=1, ROUTA_AGENT=1
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# ─── AI Agent Detection ─────────────────────────────────────────────────────

is_ai_agent() {
  # Check common AI agent environment variables
  # Note: CLAUDE_CODE_SSE_PORT is set by Augment but doesn't mean we're in AI mode
  # We need to check for the actual CLAUDE_CODE variable (without suffix)
  if [[ "$CLAUDE_CODE" == "1" ]] || \
     [[ -n "$ANTHROPIC_AGENT" ]] || \
     [[ -n "$AUGMENT_AGENT" ]] || \
     [[ -n "$CURSOR_AGENT" ]] || \
     [[ -n "$ROUTA_AGENT" ]] || \
     [[ -n "$AIDER_AGENT" ]] || \
     [[ -n "$COPILOT_AGENT" ]] || \
     [[ -n "$WINDSURF_AGENT" ]] || \
     [[ -n "$CLINE_AGENT" ]]; then
    return 0
  fi

  # Check if running in CI (GitHub Actions, etc.)
  if [[ -n "$GITHUB_ACTIONS" ]] || [[ -n "$CI" ]]; then
    return 0
  fi

  # Check if parent process is an AI agent (heuristic)
  # Claude Code spawns processes with specific patterns
  if [[ -n "$CLAUDE_CONFIG_DIR" ]] || [[ -n "$MCP_SERVER_NAME" ]]; then
    return 0
  fi

  return 1
}

# ─── Temp Files for Output Capture ──────────────────────────────────────────

FITNESS_LOG=$(mktemp)
REVIEW_LOG=$(mktemp)

cleanup() {
  rm -f "$FITNESS_LOG" "$REVIEW_LOG"
}
trap cleanup EXIT

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  local auto_fix=false
  local fail_fast=true  # Default to fail-fast mode

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --fix) auto_fix=true; shift ;;
      --no-fail-fast) fail_fast=false; shift ;;
      *) shift ;;
    esac
  done

  local fitness_exit=0

  echo "[fitness] Running pre-push fitness metrics..."
  echo ""
  set +e
  PYTHONPATH=tools/entrix python3 -m entrix.cli run \
    --parallel \
    --min-score 0 \
    --metric eslint_pass \
    --metric ts_typecheck_pass \
    --metric ts_test_pass \
    --metric markdown_external_links 2>&1 | tee "$FITNESS_LOG"
  fitness_exit=${PIPESTATUS[0]}
  set -e
  echo ""

  if [[ $fitness_exit -ne 0 ]]; then
    if [[ "$fail_fast" == true ]]; then
      handle_failure "$auto_fix" "fitness"
      exit 1
    fi
  else
    maybe_warn_human_review
    echo ""
    echo "All checks passed! Ready to push."
    exit 0
  fi

  handle_failure "$auto_fix" "fitness"
  exit 1
}

# ─── Review Trigger Warning ─────────────────────────────────────────────────
maybe_warn_human_review() {
  local review_base="HEAD~1"
  local review_json
  local review_status=0

  if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    review_base='@{upstream}'
  fi

  echo "[review] Evaluating human review triggers..."
  echo ""

  set +e
  review_json=$(PYTHONPATH=tools/entrix python3 -m entrix.cli review-trigger --base "$review_base" --json --fail-on-trigger 2>&1)
  review_status=$?
  set -e
  printf '%s\n' "$review_json" > "$REVIEW_LOG"

  if [[ $review_status -ne 0 ]] && [[ $review_status -ne 3 ]]; then
    echo "Unable to evaluate review triggers. Continuing without review gate."
    echo ""
    return 0
  fi

  if [[ $review_status -eq 0 ]]; then
    echo "No review trigger matched."
    echo ""
    return 0
  fi

  REVIEW_JSON="$review_json" python3 <<'PY'
import json
import os

report = json.loads(os.environ["REVIEW_JSON"])
print("Human review required before push:")
for trigger in report.get("triggers", []):
    print(f"- [{trigger['severity']}] {trigger['name']}")
    for reason in trigger.get("reasons", []):
        print(f"  - {reason}")
PY
  echo ""

  if [[ "$ROUTA_ALLOW_REVIEW_TRIGGER_PUSH" == "1" ]]; then
    echo "ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 set, bypassing review gate."
    echo ""
    return 0
  fi

  if is_ai_agent; then
    echo "Review-trigger matched. Human review is required before push."
    echo "After review, rerun push with ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 if you intentionally want to bypass this gate."
    exit 1
  fi

  if [[ ! -t 0 ]]; then
    echo "Review-trigger matched in a non-interactive push."
    echo "Complete human review first, then rerun with ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 to confirm."
    exit 1
  fi

  echo "These changes need human review. Confirm review is complete and continue push? [y/N]"
  read -r -t 30 response || response="n"
  if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo "Push aborted. Complete review, then push again."
    exit 1
  fi

  echo "Human review acknowledged. Continuing push."
  echo ""
}

# ─── Failure Handler ─────────────────────────────────────────────────────────
handle_failure() {
  local auto_fix="$1"
  local failed_step="$2"

  echo ""
  echo "==============================================================="
  case "$failed_step" in
    fitness) echo "  Pre-push fitness checks failed!" ;;
    *)       echo "  Pre-push checks failed!" ;;
  esac
  echo "==============================================================="
  echo ""

  # Check if we're in an AI agent environment
  if is_ai_agent; then
    echo "Running in AI agent environment."
    echo "Please fix the errors shown above."
    exit 1
  fi

  # Check if claude CLI is available
  if ! command -v claude &> /dev/null; then
    echo "Claude CLI not found. Please fix errors manually."
    exit 1
  fi

  if [[ "$auto_fix" == true ]]; then
    echo "Auto-fix mode enabled. Starting Claude..."
  else
    echo "Would you like Claude to fix these issues? [y/N]"
    read -r -t 30 response || response="n"
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
      echo "Aborted. Please fix errors manually."
      exit 1
    fi
  fi

  local fitness_tail
  fitness_tail=$(tail -100 "$FITNESS_LOG")

  local fix_prompt="Pre-push fitness checks failed. Please fix the following issues:\n\n"
  fix_prompt+="## Fitness Output\n\`\`\`\n${fitness_tail}\n\`\`\`\n\n"
  fix_prompt+="After fixing all issues, rerun the entrix-backed pre-push checks and verify they pass."

  echo "Starting Claude to fix issues..."
  echo ""

  claude -p "$fix_prompt"

  echo ""
  echo "Claude has attempted to fix the issues."
  echo "Please review the changes and run 'git push' again."
  exit 1
}

main "$@"
