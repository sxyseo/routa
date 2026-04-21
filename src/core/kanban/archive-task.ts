/**
 * Archive Task — single entry point for kanban task archival.
 *
 * Handles the full lifecycle: session finalization, column transition,
 * worktree/branch cleanup. Used by both auto-archive tick and manual API.
 */

import { AgentEventType, type AgentEvent, type EventBus } from "../events/event-bus";
import { TaskStatus, type Task } from "../models/task";
import type { KanbanBoard } from "../models/kanban";
import type { TaskStore } from "../store/task-store";
import { emitColumnTransition } from "./column-transition";
import { finalizeActiveTaskSession } from "./task-session-transition";
import { hasPendingAutomation, hasOpenPR, findArchivedColumn, findDoneColumn } from "./auto-archive-tick";
import { getKanbanBranchRules } from "./board-branch-rules";

interface ArchiveSystem {
  taskStore: TaskStore;
  workspaceStore: {
    get: (id: string) => Promise<{ metadata?: Record<string, string> } | undefined>;
  };
  eventBus: EventBus;
}

export interface ArchiveTaskResult {
  success: boolean;
  taskId: string;
  taskTitle: string;
  error?: string;
  worktreeCleanupScheduled: boolean;
}

export interface ArchiveDoneTasksResult {
  archived: ArchiveTaskResult[];
  skipped: Array<{ cardId: string; title: string; reason: string }>;
}

/**
 * Archive a single task with full resource cleanup.
 *
 * Idempotent: returns success immediately if the task is already archived.
 */
export async function archiveTask(
  system: ArchiveSystem,
  task: Task,
  board: KanbanBoard,
): Promise<ArchiveTaskResult> {
  const archivedColumn = findArchivedColumn(board);
  if (!archivedColumn) {
    return {
      success: false,
      taskId: task.id,
      taskTitle: task.title,
      error: "No archived column on board",
      worktreeCleanupScheduled: false,
    };
  }

  // Idempotent: already archived
  if (task.columnId === archivedColumn.id && task.status === TaskStatus.ARCHIVED) {
    return { success: true, taskId: task.id, taskTitle: task.title, worktreeCleanupScheduled: false };
  }

  // 1. Finalize active sessions (clear triggerSessionId, mark laneSessions)
  finalizeActiveTaskSession(task, "transitioned");

  // 2. Mark remaining running lane sessions as transitioned
  for (const session of task.laneSessions ?? []) {
    if (session.status === "running") {
      session.status = "transitioned";
    }
  }

  // 3. Move to archived column
  const fromColumnId = task.columnId ?? findDoneColumn(board)?.id ?? "done";
  const fromColumnName = board.columns.find((c) => c.id === fromColumnId)?.name ?? "Done";

  task.columnId = archivedColumn.id;
  task.status = TaskStatus.ARCHIVED;
  task.updatedAt = new Date();
  await system.taskStore.save(task);

  // 4. Emit column transition event
  emitColumnTransition(system.eventBus, {
    cardId: task.id,
    cardTitle: task.title,
    boardId: board.id,
    workspaceId: task.workspaceId,
    fromColumnId,
    toColumnId: archivedColumn.id,
    fromColumnName,
    toColumnName: archivedColumn.name,
  });

  // 5. Schedule worktree cleanup via event (handled by worktree-cleanup.ts listener)
  let worktreeCleanupScheduled = false;
  if (task.worktreeId) {
    const workspace = await system.workspaceStore.get(task.workspaceId);
    const branchRules = board.id
      ? getKanbanBranchRules(workspace?.metadata, board.id)
      : undefined;
    const deleteBranch = branchRules?.lifecycle.deleteBranchOnMerge ?? true;

    system.eventBus.emit({
      type: AgentEventType.WORKTREE_CLEANUP,
      agentId: "kanban-archive-task",
      workspaceId: task.workspaceId,
      data: {
        worktreeId: task.worktreeId,
        taskId: task.id,
        boardId: board.id,
        deleteBranch,
      },
      timestamp: new Date(),
    } as AgentEvent);
    worktreeCleanupScheduled = true;
  }

  return { success: true, taskId: task.id, taskTitle: task.title, worktreeCleanupScheduled };
}

/**
 * Archive all eligible tasks in a board's done column.
 *
 * Skips tasks with pending automation or open PRs (safety checks).
 * If `taskIds` is provided, only archives those specific tasks.
 */
export async function archiveDoneTasks(
  system: ArchiveSystem,
  board: KanbanBoard,
  taskIds?: string[],
): Promise<ArchiveDoneTasksResult> {
  const doneColumn = findDoneColumn(board);
  const result: ArchiveDoneTasksResult = { archived: [], skipped: [] };

  let tasks: Task[];
  if (taskIds && taskIds.length > 0) {
    const resolved = await Promise.all(taskIds.map((id) => system.taskStore.get(id)));
    // Only include tasks that belong to this board
    tasks = resolved.filter(
      (t): t is Task => t !== undefined && (t.boardId ?? board.id) === board.id,
    );
  } else {
    if (!doneColumn) return result;
    const allTasks = await system.taskStore.listByWorkspace(board.workspaceId);
    tasks = allTasks.filter(
      (t) => (t.boardId ?? board.id) === board.id
        && t.columnId === doneColumn.id,
    );
  }

  for (const task of tasks) {
    if (hasPendingAutomation(task)) {
      result.skipped.push({ cardId: task.id, title: task.title, reason: "存在未完成的自动化步骤" });
      continue;
    }
    if (hasOpenPR(task)) {
      result.skipped.push({ cardId: task.id, title: task.title, reason: "存在未合并的 PR" });
      continue;
    }

    try {
      const archiveResult = await archiveTask(system, task, board);
      if (archiveResult.success) {
        result.archived.push(archiveResult);
      } else {
        result.skipped.push({
          cardId: task.id,
          title: task.title,
          reason: archiveResult.error ?? "归档失败",
        });
      }
    } catch (err) {
      result.skipped.push({
        cardId: task.id,
        title: task.title,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
