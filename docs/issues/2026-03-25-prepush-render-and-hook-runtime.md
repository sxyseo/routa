---
title: Pre-push Hook Output Is Buffered, Opaque, and Hard to Extend
date: "2026-03-25"
status: open
severity: medium
area: dx
tags: [git-hooks, pre-push, entrix, renderer, scripts]
reported_by: Codex
---

## What Happened

`git push` currently enters the `pre-push` hook and prints a single start line before
running local fitness checks through `entrix`. When lint, typecheck, or tests take time,
the terminal often appears stalled. On failure, users only receive a compact tail of the
captured output plus an interactive fix prompt.

## Why It Matters

- The current experience makes normal test latency look like a hung hook.
- Buffered output hides which metric is active and whether progress is being made.
- Failure summaries are compact but lose useful context when a command emits longer logs.
- Hook orchestration is spread across shell scripts, which makes it harder to evolve into a
  richer renderer, better progress UI, or reusable package-level tooling.
- `scripts/` is already crowded, so more hook logic in ad-hoc shell scripts increases
  discoverability and maintenance cost.

## Evidence

- `.husky/pre-push`
- `scripts/smart-check.sh`
- `tools/entrix/entrix/runners/shell.py`

## Desired Outcome

Pre-push checks should expose active phases and live progress clearly, preserve enough
failure context to diagnose issues quickly, and move toward a reusable hook runtime that
can be extended without adding more one-off shell scripts.

## Design direction (proposed)

Hook Runtime should be positioned as a **Local Fitness Gate Runtime**:

- Trigger layer: Husky / Git hooks only trigger execution.
- Runtime layer: `tools/hook-runtime` manages phase orchestration, metric parallelism,
  rendering, failure routing, and review handoff.
- Policy layer: Entrix defines the actual fitness/review rules.

This keeps hook behavior reusable across contexts (pre-push today, pre-commit and other local
entry points later), and prevents policy logic from being hardcoded in hook scripts.

## Concrete design constraints

- Keep hook scripts thin: only call the runtime command.
- Runtime should support machine-readable output (`jsonl`) for agent/CI consumers.
- Runtime should preserve failure context with output tails and summary metadata.
- Runtime should make phase behavior explicit (`submodule`, `fitness`, `review`) with clear
  routing semantics.
- Runtime should be evolvable into a package-style foundation for future non-hook callers
  (local CLI/task runner / IDE action).

## Alignment with `tools/hook-runtime/README.md`

- `hooks` entrypoint and phase model now documented in a dedicated README.
- `pre-push` flow defined as the current baseline behavior.
- Failure routing and review handoff are explicitly documented as runtime responsibilities.
