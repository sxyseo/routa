#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec node --import tsx "$ROOT_DIR/tools/hook-runtime/src/check-schedules-db.ts" "$@"
