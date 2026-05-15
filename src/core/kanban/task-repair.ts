import type { RoutaSystem } from "../routa-system";
import { resolveTaskStatusForBoardColumn, type KanbanColumnStage } from "../models/kanban";
import { getHttpSessionStore } from "../acp/http-session-store";
import { isTriggerSessionStale } from "./task-trigger-session";
import { getTaskLaneSession, markTaskLaneSessionStatus } from "./task-lane-history";
import { getErrorType } from "./sync-error-writer";
import type { Task, TaskStatus } from "../models/task";

export interface TaskRepairReport {
  taskId: string;
  taskTitle: string;
  fixes: string[];
}

export interface RepairSummary {
  scannedTasks: number;
  repairedTasks: number;
  fixes: TaskRepairReport[];
  errors: string[];
}

function repairTask(
  task: Task,
  boardMap: Map<string, { columns: Array<{ id: string; stage: KanbanColumnStage }> } | undefined>,
  sessionStore: ReturnType<typeof getHttpSessionStore>,
  fixes: string[],
): void {
  // 1. Fix stale triggerSessionId
  if (task.triggerSessionId) {
    const staleId = isTriggerSessionStale(task.triggerSessionId, sessionStore);
    if (staleId) {
      const laneEntry = getTaskLaneSession(task, staleId);
      if (laneEntry?.status === "running") {
        const terminalStatus = task.pullRequestUrl ? "completed" as const : "timed_out" as const;
        markTaskLaneSessionStatus(task, staleId, terminalStatus);
        fixes.push(`laneSession ${staleId}: running → ${terminalStatus}`);
      }
      task.triggerSessionId = undefined;
      fixes.push(`triggerSessionId: cleared stale ${staleId}`);
    }
  }

  // 2. Fix orphaned running lane sessions
  if (task.laneSessions) {
    for (const session of task.laneSessions) {
      if (session.status !== "running") continue;
      if (session.sessionId === task.triggerSessionId) continue;

      const activity = sessionStore.getSessionActivity(session.sessionId);
      if (!activity || activity.terminalState) {
        const terminalStatus = task.pullRequestUrl ? "completed" as const : "timed_out" as const;
        markTaskLaneSessionStatus(task, session.sessionId, terminalStatus);
        fixes.push(`laneSession ${session.sessionId}: running → ${terminalStatus} (orphaned)`);
      }
    }
  }

  // 3. Normalize status based on column
  if (task.boardId && task.columnId) {
    const board = boardMap.get(task.boardId);
    if (board) {
      const expectedStatus = resolveTaskStatusForBoardColumn(board.columns, task.columnId);
      if (
        task.status !== expectedStatus
        && task.status !== "BLOCKED"
        && task.status !== "CANCELLED"
        && task.status !== "NEEDS_FIX"
      ) {
        const oldStatus = task.status;
        task.status = expectedStatus as TaskStatus;
        fixes.push(`status: ${oldStatus} → ${expectedStatus}`);
      }
    }
  }

  // 4. Clear stale lastSyncError (but preserve dependency_blocked — that's structural, not stale)
  if (task.lastSyncError && !task.triggerSessionId && getErrorType(task.lastSyncError) !== "dependency_blocked") {
    task.lastSyncError = undefined;
    fixes.push("lastSyncError: cleared (no active session)");
  }

  if (fixes.length > 0) {
    task.updatedAt = new Date();
  }
}

export async function repairWorkspaceTasks(system: RoutaSystem, workspaceId: string): Promise<RepairSummary> {
  const sessionStore = getHttpSessionStore();
  const result: RepairSummary = {
    scannedTasks: 0,
    repairedTasks: 0,
    fixes: [],
    errors: [],
  };

  const tasks = await system.taskStore.listByWorkspace(workspaceId);
  const boards = await system.kanbanBoardStore.listByWorkspace(workspaceId);
  const boardMap = new Map(boards.map((b) => [b.id, b]));

  for (const task of tasks) {
    result.scannedTasks++;
    const fixes: string[] = [];

    try {
      repairTask(task, boardMap, sessionStore, fixes);

      if (fixes.length > 0) {
        await system.taskStore.save(task);
        result.fixes.push({ taskId: task.id, taskTitle: task.title, fixes });
        result.repairedTasks++;
      }
    } catch (err) {
      result.errors.push(
        `${task.id} (${task.title}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

/**
 * Run repair across all workspaces. Intended for startup.
 */
export async function repairAllWorkspaces(system: RoutaSystem): Promise<RepairSummary> {
  const merged: RepairSummary = {
    scannedTasks: 0,
    repairedTasks: 0,
    fixes: [],
    errors: [],
  };

  const workspaces = await system.workspaceStore.list();
  for (const ws of workspaces) {
    const wsResult = await repairWorkspaceTasks(system, ws.id);
    merged.scannedTasks += wsResult.scannedTasks;
    merged.repairedTasks += wsResult.repairedTasks;
    merged.fixes.push(...wsResult.fixes);
    merged.errors.push(...wsResult.errors);
  }

  return merged;
}
