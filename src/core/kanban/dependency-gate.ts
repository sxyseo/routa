/**
 * Dependency Gate
 *
 * Shared functions for checking, syncing, and updating task dependency state.
 * Used by the workflow orchestrator, API routes, and session queue.
 */

import { TaskStatus, type Task } from "../models/task";

export interface DependencyGateResult {
  blocked: boolean;
  pendingDependencies: string[];
}

export interface CanMoveResult {
  canMove: boolean;
  blockedBy: string[];
  message?: string;
}

/**
 * Determine whether a dependency task is "truly done":
 *   - status is COMPLETED or ARCHIVED (both are terminal states past done)
 *   - OR the task sits in a "done" or "archived" column
 *   - AND its PR (if any) has been merged
 */
export function isDependencySatisfied(depTask: Task): boolean {
  const isCompleted = depTask.status === TaskStatus.COMPLETED
    || depTask.status === TaskStatus.ARCHIVED
    || depTask.columnId === "done"
    || depTask.columnId === "archived";
  // A PR is considered merged when: no PR URL, has a merge timestamp,
  // or the URL is a non-HTTP sentinel value (e.g. "already-merged").
  const prUrl = depTask.pullRequestUrl?.trim();
  const prMerged = !prUrl
    || Boolean(depTask.pullRequestMergedAt)
    || !prUrl.startsWith("http");
  return isCompleted && prMerged;
}

export async function checkDependencyGate(
  task: { dependencies: string[] },
  boardColumns: Array<{ id: string; stage?: string }>,
  taskStore: { get(id: string): Promise<Task | undefined | null> },
): Promise<DependencyGateResult> {
  if (!task.dependencies || task.dependencies.length === 0) {
    return { blocked: false, pendingDependencies: [] };
  }

  const pending: string[] = [];
  for (const depId of task.dependencies) {
    const depTask = await taskStore.get(depId);
    if (!depTask) continue;
    if (!isDependencySatisfied(depTask)) {
      pending.push(depTask.title || depId);
    }
  }

  return { blocked: pending.length > 0, pendingDependencies: pending };
}

/**
 * Check if a task can move to a target column by verifying all dependencies
 * are completed before that column.
 *
 * AC2: Implement canMoveToNextColumn(taskId, targetColumn) function
 */
export async function checkCanMoveToNextColumn(
  task: { dependencies: string[]; columnId?: string; title?: string },
  targetColumnId: string,
  boardColumns: Array<{ id: string; position: number }>,
  taskStore: { get(id: string): Promise<Task | undefined | null> },
): Promise<CanMoveResult> {
  if (!task.dependencies || task.dependencies.length === 0) {
    return { canMove: true, blockedBy: [] };
  }

  const targetColumn = boardColumns.find((c) => c.id === targetColumnId);
  if (!targetColumn) {
    return { canMove: false, blockedBy: [], message: `Unknown target column: ${targetColumnId}` };
  }

  const gateResult = await checkDependencyGate(task, boardColumns, taskStore);
  if (!gateResult.blocked) {
    return { canMove: true, blockedBy: [] };
  }

  const pendingDepTasks: string[] = [];
  for (const depId of task.dependencies) {
    const depTask = await taskStore.get(depId);
    if (depTask) {
      const depColumn = boardColumns.find((c) => c.id === depTask.columnId);
      const targetPos = targetColumn.position;
      const depPos = depColumn?.position ?? 0;
      if (depPos >= targetPos) {
        pendingDepTasks.push(depTask.title || depId);
      }
    }
  }

  if (pendingDepTasks.length > 0) {
    return {
      canMove: false,
      blockedBy: pendingDepTasks,
      message: `Cannot move "${task.title}" to "${targetColumnId}": blocked by unfinished dependencies: ${pendingDepTasks.join(", ")}`,
    };
  }

  return { canMove: true, blockedBy: [] };
}

/**
 * Get dependency status for UI display.
 *
 * AC4: Return dependency status information for UI rendering
 */
export async function getDependencyStatus(
  task: Task,
  taskStore: { get(id: string): Promise<Task | undefined | null> },
): Promise<{
  hasDependencies: boolean;
  dependencies: Array<{
    id: string;
    title: string;
    status: string;
    columnId: string;
    isCompleted: boolean;
  }>;
  isBlocked: boolean;
}> {
  const deps = task.dependencies ?? [];
  if (deps.length === 0) {
    return { hasDependencies: false, dependencies: [], isBlocked: false };
  }

  const depDetails: Array<{
    id: string;
    title: string;
    status: string;
    columnId: string;
    isCompleted: boolean;
  }> = [];
  let isBlocked = false;

  for (const depId of deps) {
    const depTask = await taskStore.get(depId);
    if (depTask) {
      const isCompleted = isDependencySatisfied(depTask);
      if (!isCompleted) {
        isBlocked = true;
      }
      depDetails.push({
        id: depTask.id,
        title: depTask.title,
        status: depTask.status,
        columnId: depTask.columnId ?? "backlog",
        isCompleted,
      });
    }
  }

  return { hasDependencies: true, dependencies: depDetails, isBlocked };
}

/**
 * Sync bidirectional dependency relations when a task's dependencies change.
 * Updates the `blocking` array on both the current task and the affected dependency tasks.
 */
export async function updateDependencyRelations(
  taskId: string,
  newDependencies: string[],
  taskStore: {
    get(id: string): Promise<Task | undefined | null>;
    save(task: Task): Promise<void>;
  },
): Promise<void> {
  const task = await taskStore.get(taskId);
  if (!task) return;

  const oldDeps = new Set(task.dependencies);
  const newDeps = new Set(newDependencies);

  const added = newDependencies.filter((id) => !oldDeps.has(id));
  const removed = task.dependencies.filter((id) => !newDeps.has(id));

  // Update the task's own blocking array by scanning workspace for reverse refs.
  // This is done lazily — callers should also set task.dependencies = newDependencies.

  // Add this task to blocking lists of newly-added dependencies
  for (const depId of added) {
    const depTask = await taskStore.get(depId);
    if (!depTask) continue;
    if (!depTask.blocking) depTask.blocking = [];
    if (!depTask.blocking.includes(taskId)) {
      depTask.blocking.push(taskId);
      await taskStore.save(depTask);
    }
  }

  // Remove this task from blocking lists of removed dependencies
  for (const depId of removed) {
    const depTask = await taskStore.get(depId);
    if (!depTask) continue;
    if (depTask.blocking) {
      depTask.blocking = depTask.blocking.filter((id) => id !== taskId);
      await taskStore.save(depTask);
    }
  }
}

/**
 * Update a task's dependencyStatus based on the gate check result.
 */
export function applyDependencyStatus(
  task: Task,
  gateResult: DependencyGateResult,
): void {
  if (gateResult.blocked) {
    task.dependencyStatus = "blocked";
  } else if (task.dependencies.length > 0) {
    task.dependencyStatus = "clear";
  } else {
    task.dependencyStatus = undefined;
  }
}

/**
 * Prepare a canonical dependency-unblock update payload.
 *
 * All dependency-unblock code paths (overseer, lane-scanner, pr-merge-listener,
 * orchestrator) must apply the same mutations. This function returns the
 * minimal, consistent set of field changes required.
 */
export function dependencyUnblockFields(): {
  dependencyStatus: "clear";
  lastSyncError: undefined;
  updatedAt: Date;
} {
  return {
    dependencyStatus: "clear",
    lastSyncError: undefined,
    updatedAt: new Date(),
  };
}

// ─── Parent-child hierarchy ─────────────────────────────────────

const MAX_PARENT_DEPTH = 8;

/**
 * Validate a parent-child relationship assignment.
 * Returns an error message if invalid, undefined if valid.
 */
export function validateParentAssignment(
  taskId: string,
  parentTaskId: string,
): string | undefined {
  if (taskId === parentTaskId) {
    return "A task cannot be its own parent.";
  }
  return undefined;
}

/**
 * Detect circular parent chains by walking up the parent hierarchy.
 * Returns true if a cycle is detected.
 */
export async function detectParentCycle(
  taskId: string,
  parentTaskId: string,
  taskStore: { get(id: string): Promise<Task | undefined | null> },
): Promise<boolean> {
  const visited = new Set<string>([taskId]);
  let currentId: string | undefined = parentTaskId;

  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
    if (!currentId) return false;
    if (visited.has(currentId)) return true;
    visited.add(currentId);

    const current = await taskStore.get(currentId);
    currentId = current?.parentTaskId;
  }

  return false;
}

export interface ParentProgress {
  completed: number;
  total: number;
  label: string;
}

/**
 * Compute sub-task completion progress for a parent task.
 */
export async function computeParentProgress(
  parentTask: Task,
  taskStore: {
    listByWorkspace(workspaceId: string): Promise<Task[]>;
  },
): Promise<ParentProgress | undefined> {
  const allTasks = await taskStore.listByWorkspace(parentTask.workspaceId);
  const children = allTasks.filter((t) => t.parentTaskId === parentTask.id);

  if (children.length === 0) return undefined;

  const completed = children.filter((t) => t.status === "COMPLETED").length;
  return {
    completed,
    total: children.length,
    label: `${completed}/${children.length} sub-tasks completed`,
  };
}
