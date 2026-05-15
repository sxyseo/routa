# ADR 0008: Auto Merge Strategy for Kanban Done Stage

- Status: proposed
- Date: 2026-04-19
- Derived from: evaluation of whether Kanban workflow needs a dedicated auto-merge-and-push stage

## Context

The current Kanban workflow defines 6 standard column stages (`backlog`, `todo`, `dev`, `review`, `blocked`, `done`). At the `done` stage, the **PR Publisher** specialist creates a pull request and pushes it to the remote repository, but explicitly refrains from merging:

> "Do NOT auto-merge the PR. Create it and leave it for human review." — `pr-publisher.yaml:114-118`

Merge decisions remain a human responsibility. The system detects merge events via webhook/polling. The question is whether to introduce automated merge capabilities into the Kanban workflow.

### Current Architecture

- **Delivery rules** (`KanbanDeliveryRules`) enforce: committed changes, clean worktree, PR-ready state
- **Done stage automation** has two steps: PR Publisher (DEVELOPER) + Done Reporter (GATE)
- **`KanbanColumnStage`** type is shared across TypeScript; no Rust counterpart currently exists
- ADR 0007 establishes delivery rules as **column policy**, not route-specific conditionals

## Decision

**Do not add a new Kanban column stage for auto-merge. Instead, add an optional auto-merge step within the existing `done` stage.**

### Rationale

#### 1. Security Risks of Automatic Merging

- **Merge conflicts**: Auto-merge cannot resolve conflicts on `main`; human intervention is required for conflict resolution
- **CI/CD gate bypass**: Branch protection typically requires CI checks to pass before merge; automated merging could bypass these safeguards
- **Rollback cost**: Reverting a merged commit on `main` is significantly more expensive than closing/revising a PR
- **Multi-repository coordination**: Ordered merging of cross-repo PRs cannot be automated reliably

#### 2. Existing Mechanisms Are Sufficient

- `KanbanDeliveryRules` already provides configurable per-column policies — extendable with `autoMergeAfterPR`
- `RECOMMENDED_AUTOMATION_BY_STAGE` supports multi-step orchestration via the `steps` array
- Adding an Auto Merge specialist step after PR Publisher requires no structural changes

#### 3. Architectural Simplicity

- The 6-stage model covers the full workflow lifecycle; a new stage increases maintenance burden
- `KanbanColumnStage` type changes cascade to all consumers (UI, MCP tools, specialist prompts)
- Optional configuration is more flexible than a mandatory new stage

## Alternatives Considered

### Option A: Optional Auto Merge Step in Done Stage (Recommended)

- Add `autoMergeAfterPR: boolean` to `KanbanDeliveryRules`
- Add Auto Merge specialist step after PR Publisher in the done stage steps array
- Pre-merge checks: CI status, conflict detection, branch protection rule compliance
- Configurable merge strategy: merge commit / squash / rebase
- **Impact**: `boards.ts` + `task-delivery-readiness.ts` + `kanban.ts` types + new specialist + 1 ADR

### Option B: Dedicated Merge Stage

- New `KanbanColumnStage = "merge"` after `done`
- Finer-grained control but increased workflow complexity
- **Impact**: `kanban.ts` type enum + `boards.ts` + Rust crates (if synced) + UI column definitions + specialist prompts

### Option C: Status Quo

- Merge remains a manual operation via GitHub/GitLab UI
- System detects merge events via webhook
- **Impact**: Zero implementation cost, no change to automation level

## Consequences

- The recommended Option A keeps the 6-stage model intact while providing an opt-in auto-merge capability
- Teams that trust their CI pipeline can enable auto-merge; teams that require human review can keep the current behavior
- `KanbanDeliveryRules` extension follows the column-policy pattern established in ADR 0007
- PR Publisher's responsibility boundary remains unchanged (create PR, do not merge); the new Auto Merge specialist handles merging as a separate, optional step

## Affected Modules

| Module | File | Impact |
|--------|------|--------|
| Type definitions | `src/core/models/kanban.ts` | Extend `KanbanDeliveryRules` with `autoMergeAfterPR` |
| Default config | `src/core/kanban/boards.ts` | Add optional Auto Merge step to done stage |
| Delivery rules | `src/core/kanban/task-delivery-readiness.ts` | Extend rule evaluation logic |
| Specialist | `resources/specialists/workflows/kanban/` | New `auto-merger` specialist YAML |
| PR Publisher | `resources/specialists/workflows/kanban/pr-publisher.yaml` | No change required |
| ADR | `docs/adr/` | This document |

## Code References

- `src/core/models/kanban.ts:3` — `KanbanColumnStage` type (6 stages, no change needed for Option A)
- `src/core/models/kanban.ts:26-33` — `KanbanDeliveryRules` interface (extension point)
- `src/core/kanban/boards.ts:91-114` — Done stage automation config (steps array, insertion point)
- `src/core/kanban/task-delivery-readiness.ts` — Rule evaluation logic
- `resources/specialists/workflows/kanban/pr-publisher.yaml:114-118` — Current merge policy
- `docs/adr/0007-kanban-delivery-transition-policies.md` — Column policy design pattern
