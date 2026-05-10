/**
 * Fan-In Merge
 *
 * Aggregates code from completed child task branches into a parent task branch.
 * Used when the merge strategy is "fan_in" or "cascade_fan_in".
 *
 * Flow:
 *  1. Find all completed children with worktrees
 *  2. Ensure the parent has a worktree/branch (create if needed)
 *  3. Merge child branches into the parent branch in topological order
 *  4. Report conflicts for manual resolution
 */

import { TaskStatus, type Task } from "../models/task";
import type { TaskStore } from "../store/task-store";
import type { WorktreeStore } from "../db/pg-worktree-store";
import { getServerBridge } from "../platform";
import { getChildTasks } from "./parent-child-lifecycle";
import type { MergeStrategy } from "./task-split-topology";

async function execCommand(
  command: string,
  options: { cwd: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  const bridge = getServerBridge();
  if (!bridge.process.isAvailable()) {
    throw new Error("Process API is not available in this environment.");
  }
  return bridge.process.exec(command, { cwd: options.cwd, timeout: options.timeout ?? 30_000 });
}

// ─── Types ─────────────────────────────────────────────────────────────

export interface FanInMergeDeps {
  taskStore: TaskStore;
  worktreeStore: WorktreeStore;
}

export interface FanInMergeResult {
  success: boolean;
  mergedBranches: string[];
  conflicts: string[];
}

// ─── Core merge ────────────────────────────────────────────────────────

/**
 * Merge completed child task branches into the parent task's branch.
 *
 * This is called after all children are confirmed completed.
 * The parent must have a worktree with a branch to receive merges.
 */
export async function executeFanInMerge(
  parentTask: Task,
  deps: FanInMergeDeps,
): Promise<FanInMergeResult> {
  const mergedBranches: string[] = [];
  const conflicts: string[] = [];

  // 1. Get all completed children
  const children = await getChildTasks(parentTask, deps.taskStore);
  const completedChildren = children.filter(
    (c) => c.status === TaskStatus.COMPLETED && c.worktreeId,
  );

  if (completedChildren.length === 0) {
    return { success: true, mergedBranches: [], conflicts: [] };
  }

  // 2. Resolve parent worktree — must exist before merge
  if (!parentTask.worktreeId) {
    return {
      success: false,
      mergedBranches: [],
      conflicts: ["Parent task has no worktree — cannot merge into it"],
    };
  }

  const parentWorktree = await deps.worktreeStore.get(parentTask.worktreeId);
  if (!parentWorktree?.worktreePath) {
    return {
      success: false,
      mergedBranches: [],
      conflicts: ["Parent worktree not found or has no path"],
    };
  }

  // 3. Sort children using persisted topological order from splitPlan
  const topoOrder = parentTask.splitPlan?.childTaskIds ?? [];
  const topoIndex = new Map(topoOrder.map((id, i) => [id, i]));
  const sorted = [...completedChildren].sort((a, b) => {
    const ai = topoIndex.get(a.id) ?? Infinity;
    const bi = topoIndex.get(b.id) ?? Infinity;
    // Fallback to createdAt when not in splitPlan
    if (ai === bi && ai === Infinity) {
      return a.createdAt.getTime() - b.createdAt.getTime();
    }
    return ai - bi;
  });

  // 4. Merge each child branch into the parent worktree
  for (const child of sorted) {
    if (!child.worktreeId) continue;

    const childWorktree = await deps.worktreeStore.get(child.worktreeId);
    if (!childWorktree?.branch) continue;

    try {
      const result = await mergeBranch(
        parentWorktree.worktreePath,
        childWorktree.branch,
      );

      if (result.success) {
        mergedBranches.push(childWorktree.branch);
      } else {
        conflicts.push(
          ...result.conflictFiles.map(
            (f) => `${childWorktree.branch}: ${f}`,
          ),
        );
        // Stop merging on first conflict to avoid cascading issues
        break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      conflicts.push(`${childWorktree.branch}: ${msg}`);
      break;
    }
  }

  // 5. Update parent task with result
  if (conflicts.length > 0) {
    parentTask.lastSyncError =
      `[Fan-In] Merge conflicts: ${conflicts.join("; ")}. Resolve manually.`;
    parentTask.updatedAt = new Date();
    await deps.taskStore.save(parentTask);
  }

  return {
    success: conflicts.length === 0,
    mergedBranches,
    conflicts,
  };
}

// ─── Git merge helper ──────────────────────────────────────────────────

async function mergeBranch(
  cwd: string,
  sourceBranch: string,
): Promise<{ success: boolean; conflictFiles: string[] }> {
  const conflictFiles: string[] = [];

  try {
    // Fetch the source branch to ensure it's available
    await execCommand(`git fetch origin ${sourceBranch}`, { cwd, timeout: 30_000 }).catch(() => {});

    // Attempt merge with --no-ff to preserve branch history
    await execCommand(`git merge --no-ff ${sourceBranch} -m "Merge branch ${sourceBranch} (fan-in)"`, {
      cwd,
      timeout: 60_000,
    });
    return { success: true, conflictFiles: [] };
  } catch {
    // Extract conflict file list
    try {
      const { stdout } = await execCommand("git diff --name-only --diff-filter=U", {
        cwd,
        timeout: 10_000,
      });
      const files = stdout.trim().split("\n").filter(Boolean);
      conflictFiles.push(...files);
    } catch {
      // Could not read conflicts — merge may have already been aborted
    }

    // Abort the failed merge to leave the repo clean
    await execCommand("git merge --abort", { cwd, timeout: 10_000 }).catch(() => {});

    return { success: false, conflictFiles };
  }
}

// ─── Strategy resolver ─────────────────────────────────────────────────

/**
 * Determine if fan-in merge is needed based on the merge strategy.
 * Fan-in is needed when tasks are parallel (fan_in or cascade_fan_in)
 * and there are multiple completed children.
 */
export function needsFanInMerge(
  strategy: MergeStrategy,
  childCount: number,
): boolean {
  if (childCount <= 1) return false;
  return strategy === "fan_in" || strategy === "cascade_fan_in";
}
