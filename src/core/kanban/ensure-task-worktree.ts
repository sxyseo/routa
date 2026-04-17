/**
 * ensureTaskWorktree — single source of truth for creating a worktree
 * for a kanban task.
 *
 * Used by both the API route handler (`route.ts`) and the workflow
 * orchestrator (`workflow-orchestrator-singleton.ts`) to avoid logic
 * duplication and the associated drift risk.
 *
 * Responsibilities:
 *  1. Resolve branch name (honouring nextBranchOverride)
 *  2. Resolve base branch (honouring nextBaseBranchOverride, then
 *     dependency-aware selection from unfinished dependency branches)
 *  3. Create worktree via GitWorktreeService
 *  4. Retry with a timestamp suffix on branch-name collision
 *  5. Clear ephemeral override fields on the task after consumption
 *  6. Mark the task as BLOCKED on unrecoverable failure
 */

import type { Task } from "../models/task";
import { TaskStatus } from "../models/task";
import type { Codebase } from "../models/codebase";
import type { WorktreeStore } from "../db/pg-worktree-store";
import type { CodebaseStore } from "../db/pg-codebase-store";
import type { TaskStore } from "../store/task-store";
import { GitWorktreeService } from "../git/git-worktree-service";
import { buildKanbanWorktreeNaming } from "./worktree-naming";
import { GIT_DEFAULT_BRANCH } from "../git/git-defaults";
import {
  getDefaultWorkspaceWorktreeRoot,
  getEffectiveWorkspaceMetadata,
} from "../models/workspace";
import type { Workspace } from "../models/workspace";

export interface EnsureTaskWorktreeDeps {
  worktreeStore: WorktreeStore;
  codebaseStore: CodebaseStore;
  /** Task store — required for dependency-aware base branch resolution. */
  taskStore: TaskStore;
  /** Pre-resolved workspace (optional; used to compute worktreeRoot). */
  workspace?: Workspace | null;
  /** Fallback: compute worktreeRoot from workspaceId. */
  workspaceId: string;
}

export interface EnsureTaskWorktreeResult {
  ok: true;
  worktreeId: string;
}

export interface EnsureTaskWorktreeError {
  ok: false;
  errorMessage: string;
}

export type EnsureTaskWorktreeOutcome =
  | EnsureTaskWorktreeResult
  | EnsureTaskWorktreeError;

/**
 * Create a worktree for a task, consuming any ephemeral overrides
 * (`nextBranchOverride`, `nextBaseBranchOverride`) set on the task.
 *
 * On success the task's `worktreeId` is set and override fields are cleared.
 * On failure the task is marked BLOCKED and `lastSyncError` is set.
 */
export async function ensureTaskWorktree(
  task: Task,
  preferredCodebase: Codebase,
  deps: EnsureTaskWorktreeDeps,
): Promise<EnsureTaskWorktreeOutcome> {
  const worktreeService = new GitWorktreeService(
    deps.worktreeStore,
    deps.codebaseStore,
  );

  // 1. Resolve branch name — honour override if set
  const namingOverride = task.nextBranchOverride
    ? { branch: task.nextBranchOverride, label: task.nextBranchOverride }
    : undefined;
  const { branch, label } =
    namingOverride ?? buildKanbanWorktreeNaming(task.id, { title: task.title });

  // 2. Resolve base branch — dependency-aware
  const dependencyBase = await resolveDependencyBaseBranch(task, deps);
  const baseBranch =
    task.nextBaseBranchOverride
    ?? dependencyBase
    ?? preferredCodebase.branch
    ?? GIT_DEFAULT_BRANCH;

  // 3. Resolve worktree root
  const worktreeRoot = deps.workspace
    ? getEffectiveWorkspaceMetadata(deps.workspace).worktreeRoot
    : getDefaultWorkspaceWorktreeRoot(deps.workspaceId);

  // 4. Attempt creation
  try {
    const worktree = await worktreeService.createWorktree(preferredCodebase.id, {
      branch,
      baseBranch,
      label,
      worktreeRoot,
    });
    task.worktreeId = worktree.id;
    clearOverrides(task);
    return { ok: true, worktreeId: worktree.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // 5. Retry with timestamp suffix on branch-name collision
    if (message.includes("already in use")) {
      try {
        const retryBranch = `${branch}-${Date.now().toString(36)}`;
        const worktree = await worktreeService.createWorktree(
          preferredCodebase.id,
          {
            branch: retryBranch,
            baseBranch,
            label,
            worktreeRoot,
          },
        );
        task.worktreeId = worktree.id;
        clearOverrides(task);
        return { ok: true, worktreeId: worktree.id };
      } catch (retryError) {
        const retryMsg =
          retryError instanceof Error ? retryError.message : String(retryError);
        markBlocked(task, `Worktree creation failed after retry: ${retryMsg}`);
        clearOverrides(task);
        return { ok: false, errorMessage: task.lastSyncError! };
      }
    }

    // 6. Unrecoverable failure
    markBlocked(task, `Worktree creation failed: ${message}`);
    clearOverrides(task);
    return { ok: false, errorMessage: task.lastSyncError! };
  }
}

/**
 * Resolve a base branch from the task's declared dependencies.
 *
 * Strategy: walk `task.dependencies` in order and return the branch of the
 * **first** unfinished, un-merged dependency that has a worktree.
 *
 * Safeguards:
 *  - Circular dependencies: `visited` set prevents infinite loops.
 *  - Already-merged deps: skipped (their code is already on main).
 *  - No eligible deps: returns `undefined` → caller falls through to default.
 */
async function resolveDependencyBaseBranch(
  task: Task,
  deps: EnsureTaskWorktreeDeps,
  visited?: Set<string>,
): Promise<string | undefined> {
  if (!task.dependencies || task.dependencies.length === 0) {
    return undefined;
  }

  const seen = visited ?? new Set<string>();
  seen.add(task.id);

  for (const depId of task.dependencies) {
    // Circular dependency guard
    if (seen.has(depId)) {
      console.warn(
        `[ensureTaskWorktree] Circular dependency detected: ${task.id} → ${depId}. Skipping.`,
      );
      continue;
    }

    const depTask = await deps.taskStore.get(depId);
    if (!depTask) continue;

    // If dependency's PR is already merged, its code is on main — skip
    if (depTask.pullRequestMergedAt) continue;

    // If dependency has a worktree with a branch, use it as base
    if (depTask.worktreeId) {
      const depWorktree = await deps.worktreeStore.get(depTask.worktreeId);
      if (depWorktree?.branch) {
        return depWorktree.branch;
      }
    }

    // Recurse: if the dependency itself depends on another task, follow the chain
    seen.add(depId);
    const transitiveBase = await resolveDependencyBaseBranch(depTask, deps, seen);
    if (transitiveBase) return transitiveBase;
  }

  return undefined;
}

function clearOverrides(task: Task): void {
  task.nextBranchOverride = undefined;
  task.nextBaseBranchOverride = undefined;
}

function markBlocked(task: Task, message: string): void {
  task.status = TaskStatus.BLOCKED;
  task.columnId = "blocked";
  task.lastSyncError = message;
}
