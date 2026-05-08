/**
 * WIP Limit Gate — enforces per-column work-in-progress limits.
 *
 * Checks whether a column has reached its configured WIP limit
 * before allowing a card transition to proceed.
 */

import type { KanbanBoard, KanbanColumn } from "../models/kanban";
import type { Task } from "../models/task";

export interface WipLimitResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  message?: string;
}

/** Count non-completed tasks currently in a given column. */
async function countActiveTasksInColumn(
  columnId: string,
  workspaceId: string,
  taskStore: { listByWorkspace(wsId: string): Promise<Task[]> },
): Promise<number> {
  const tasks = await taskStore.listByWorkspace(workspaceId);
  return tasks.filter((t) =>
    t.columnId === columnId
    && t.status !== "COMPLETED"
    && t.status !== "ARCHIVED",
  ).length;
}

/**
 * Check whether a card transition is allowed under the column's WIP limit.
 * Returns the result with current count and limit for diagnostic messages.
 */
export async function checkWipLimit(
  task: Task,
  targetColumnId: string,
  board: KanbanBoard,
  taskStore: { listByWorkspace(wsId: string): Promise<Task[]> },
): Promise<WipLimitResult> {
  const column = board.columns.find((c) => c.id === targetColumnId);
  const wipLimit = column?.automation?.wipLimit;

  if (!wipLimit || wipLimit <= 0) {
    return { allowed: true, currentCount: 0, limit: 0 };
  }

  const currentCount = await countActiveTasksInColumn(
    targetColumnId,
    task.workspaceId,
    taskStore,
  );

  if (currentCount >= wipLimit) {
    return {
      allowed: false,
      currentCount,
      limit: wipLimit,
      message: `Column "${column?.name ?? targetColumnId}" at capacity (${currentCount}/${wipLimit}). WIP limit reached.`,
    };
  }

  return { allowed: true, currentCount, limit: wipLimit };
}
