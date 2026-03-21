#!/bin/bash

set -euo pipefail

TYPECHECK_LOG=$(mktemp)

cleanup() {
  rm -f "$TYPECHECK_LOG"
}
trap cleanup EXIT

run_typecheck() {
  set +e
  npx tsc --noEmit 2>&1 | tee "$TYPECHECK_LOG"
  local exit_code=${PIPESTATUS[0]}
  set -e
  return "$exit_code"
}

if run_typecheck; then
  echo "ts_typecheck_pass: ok"
  exit 0
fi

if grep -q "\.next/types/.*Cannot find module.*src/app/.*page\.js" "$TYPECHECK_LOG"; then
  echo "Detected stale .next types. Cleaning and retrying..."
  rm -rf .next
  if run_typecheck; then
    echo "ts_typecheck_pass: ok"
    exit 0
  fi
fi

exit 1
