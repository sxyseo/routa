---
title: "JIT Context stays empty for repo-root-only requests even when history sessions exist"
date: "2026-04-21"
kind: issue
status: open
severity: medium
area: "kanban"
tags: ["jit-context", "task-adaptive-harness", "feature-explorer", "history-session", "kanban"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
  - "docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
github_issue: 517
github_state: open
github_url: "https://github.com/phodal/routa/issues/517"
---

# JIT Context stays empty for repo-root-only requests even when history sessions exist

## What Happened

`JIT Context` can render as empty even in `/Users/phodal/ai/routa-js`, where local Codex history clearly contains matching transcripts and recoverable context.

Real probes against the current repository showed:

- `~/.codex/sessions` currently contains `1767` transcript files.
- `collectMatchingTranscriptSessions("/Users/phodal/ai/routa-js")` returns `200` matched transcripts for this repo.
- `assembleTaskAdaptiveHarness("/Users/phodal/ai/routa-js", { taskLabel: "Repo-root only", taskType: "analysis" })` returns:
  - `selectedFiles: []`
  - `matchedSessionIds: []`
  - warning: `No task-adaptive files could be resolved from the current request.`

At the same time, probing a concrete Kanban file shows that the data is present:

- `assembleTaskAdaptiveHarness(..., { filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"] })` returns:
  - `5` matched sessions
  - high-signal failure messages such as missing file/path reads
  - repeated read hotspot for `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `Feature Explorer` maps that same file to:
  - page route: `/workspace/:workspaceId/kanban`
  - feature: `kanban-workflow`
  - file stats: `changes=5`, `sessions=5`, `updatedAt=2026-04-21T09:15:36`

This means the empty state is not caused by a lack of history. It is caused by the current request shape not being strong enough to resolve candidate files/features.

## Expected Behavior

When `JIT Context` receives only repo/workspace context, it should still recover useful history-session context by deriving one or more of:

- candidate files from the current card/task surface
- candidate features from `Feature Explorer`
- recent/high-signal history sessions for the current repo

The empty state should be reserved for truly history-free cards, not for repo-root-only requests with abundant local transcript evidence.

## Reproduction Context

- Environment: web
- Trigger: open Kanban card detail and request `JIT Context` for a card that does not pass strong `filePaths`, `featureId`, or `historySessionIds`

Local diagnostic commands run against `/Users/phodal/ai/routa-js`:

1. Count local transcript files under `~/.codex/sessions`
2. Call `collectMatchingTranscriptSessions(repoRoot)`
3. Call `assembleTaskAdaptiveHarness(repoRoot, { taskLabel, taskType })`
4. Call `assembleTaskAdaptiveHarness(repoRoot, { filePaths: [...] })`
5. Call `Feature Explorer` helpers to map the same file to feature/page/session stats

## Why This Might Happen

- `Task-Adaptive Harness` currently requires one of `filePaths`, `featureId`, or `historySessionIds` to recover `selectedFiles`; repo-root-only requests do not infer a starting surface.
- `JIT Context` is wired to `task-adaptive` retrieval, but not yet to `Feature Explorer` feature/page/file attribution as a fallback discovery step.
- The current empty-state logic treats “no selected files resolved” as “no context”, even when `collectMatchingTranscriptSessions(repoRoot)` already proves repo-scoped history exists.
- Current UI/task wiring may not always pass the strongest possible history inputs from the card, especially for cards with weak or incomplete lane/session metadata.

## Refined Direction

Use a task-level `contextSearchSpec` as the first-pass retrieval contract for `JIT Context`.

Instead of waiting for later implementation traces to recover files, backlog refinement should write structured retrieval hints directly onto the card/task, for example:

- `query`
- `featureCandidates`
- `relatedFiles`
- `routeCandidates`
- `apiCandidates`
- `moduleHints`
- `symptomHints`

That gives `Task-Adaptive Harness` a just-in-time seed even before the first implementation session has produced transcript evidence.

## Planned Wiring

1. `backlog refiner` should emit `contextSearchSpec` while creating or refining cards
2. task persistence should store `contextSearchSpec` across web/desktop backends
3. `buildKanbanTaskAdaptiveHarnessOptions()` should forward:
   - `relatedFiles -> filePaths`
   - `featureCandidates -> featureIds`
4. `Task-Adaptive Harness` should merge `featureIds + filePaths + historySessionIds`
5. `JIT Context` should consume those hints on first open, then later refine using real session traces

## Progress Notes

- 2026-04-21: validated that repo-root-only requests stay empty while file-scoped requests immediately recover sessions and friction signals
- 2026-04-21: confirmed `Feature Explorer` can already map files to `feature/page/session` evidence and should be treated as the structural fallback
- 2026-04-21: implementation started for task-level `contextSearchSpec` persistence and Kanban/tooling propagation
- 2026-04-21: `Task-Adaptive Harness` now seeds file/feature inference from `query`, `routeCandidates`, `apiCandidates`, `moduleHints`, and `symptomHints` via the feature surface index
- 2026-04-21: Kanban task-adaptive wiring now falls back to the card title as an implicit query when older cards do not yet have an explicit `contextSearchSpec.query`
- 2026-04-21: re-validated against `http://localhost:3001/api/harness/task-adaptive` that repo-root-only requests are still empty, even after the hint-backed retrieval work shipped
- 2026-04-21: confirmed the contrast case: when `featureIds/routeCandidates/moduleHints` are present, the same repository returns high-confidence matches, recovered files, reusable friction profiles, and relevant history sessions
- 2026-04-21: verified that the current Kanban/JIT product path is usable for hint-backed cards, but the original repo-root-only fallback gap remains unresolved and keeps this issue open

## Relevant Files

- `src/core/harness/task-adaptive.ts`
- `src/core/harness/transcript-sessions.ts`
- `src/app/api/feature-explorer/shared.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-task-adaptive.ts`
- `src/core/kanban/task-adaptive.ts`

## Observations

- For `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`, recovered sessions include current JIT/Task-Adaptive Harness work from `2026-04-21`.
- Recovered failure signals are useful product data, not just debug noise. Examples include:
  - wrong path reads
  - shell glob failures around `[]` paths
  - repeated attempts to read the same file
- `Feature Explorer` already exposes context categories that `JIT Context` does not yet surface:
  - feature links
  - page links
  - file stats
  - file signals with prompt/tool/diagnostics summaries
  - top features by session count

## References

- `docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md`
- `docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md`
