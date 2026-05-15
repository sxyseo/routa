import { getAcpInstanceId, isExecutionLeaseActive } from "../acp/execution-backend";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getAcpProcessManager } from "../acp/processer";
import type { RoutaSystem } from "../routa-system";
import { getKanbanAutomationSteps, resolveTaskStatusForBoardColumn } from "../models/kanban";
import type { Task, TaskLaneSessionStatus, TaskStatus } from "../models/task";
import { getTaskLaneSession, markTaskLaneSessionStatus } from "./task-lane-history";
import { resolveCurrentLaneAutomationState } from "./lane-automation-state";
import { resolveReviewLaneConvergenceTarget } from "./review-lane-convergence";
import { getKanbanEventBroadcaster } from "./kanban-event-broadcaster";
import {
  enqueueKanbanTaskSession,
  processKanbanColumnTransition,
} from "./workflow-orchestrator-singleton";
import { clearStuckMarker, getErrorType, parseCbResetCount } from "./sync-error-writer";
import { getKanbanConfig } from "./kanban-config";

export interface RestartRecoveryOptions {
  sessionStore: ReturnType<typeof getHttpSessionStore>;
  processManager: ReturnType<typeof getAcpProcessManager>;
}

function isSessionActivelyRunning(
  taskSessionId: string | undefined,
  options: RestartRecoveryOptions,
): boolean {
  if (!taskSessionId) return false;

  if (options.processManager.hasActiveSession(taskSessionId)) {
    return true;
  }

  const session = options.sessionStore.getSession(taskSessionId);
  if (!session) {
    return false;
  }

  if (session.acpStatus === "ready" || session.acpStatus === "connecting") {
    return true;
  }

  if (session.acpStatus === "error") {
    return false;
  }

  // Hydrated sessions from storage only remain resumable when the current
  // instance still owns the execution lease.
  const ownerInstanceId = session.ownerInstanceId?.trim();
  if (!ownerInstanceId) {
    return false;
  }
  if (ownerInstanceId !== getAcpInstanceId()) {
    return false;
  }

  return isExecutionLeaseActive(session.leaseExpiresAt);
}

function resolveStaleLaneSessionTerminalStatus(
  task: Pick<Task, "verificationVerdict" | "verificationReport" | "completionSummary" | "pullRequestUrl">,
): TaskLaneSessionStatus {
  if (task.pullRequestUrl) return "completed";
  return task.verificationVerdict || task.verificationReport || task.completionSummary
    ? "transitioned"
    : "timed_out";
}

async function sanitizeStaleCurrentLaneAutomation(
  system: RoutaSystem,
  task: Task,
  options: RestartRecoveryOptions,
): Promise<Task> {
  let mutated = false;
  const nextTask: Task = {
    ...task,
    laneSessions: [...(task.laneSessions ?? [])],
    laneHandoffs: [...(task.laneHandoffs ?? [])],
    sessionIds: [...(task.sessionIds ?? [])],
    comments: [...(task.comments ?? [])],
    labels: [...(task.labels ?? [])],
    dependencies: [...(task.dependencies ?? [])],
    codebaseIds: [...(task.codebaseIds ?? [])],
  };

  if (nextTask.triggerSessionId && !isSessionActivelyRunning(nextTask.triggerSessionId, options)) {
    const triggerLaneSession = getTaskLaneSession(nextTask, nextTask.triggerSessionId);
    if (triggerLaneSession && triggerLaneSession.columnId === nextTask.columnId) {
      if (triggerLaneSession.status === "running") {
        markTaskLaneSessionStatus(
          nextTask,
          triggerLaneSession.sessionId,
          resolveStaleLaneSessionTerminalStatus(nextTask),
        );
      }
    }
    nextTask.triggerSessionId = undefined;
    mutated = true;
  }

  for (const entry of nextTask.laneSessions ?? []) {
    if (
      entry.columnId === nextTask.columnId
      && entry.status === "running"
      && !isSessionActivelyRunning(entry.sessionId, options)
    ) {
      markTaskLaneSessionStatus(
        nextTask,
        entry.sessionId,
        resolveStaleLaneSessionTerminalStatus(nextTask),
      );
      mutated = true;
    }
  }

  if (mutated) {
    nextTask.updatedAt = new Date();
    await system.taskStore.save(nextTask);
    return nextTask;
  }

  return task;
}

async function convergeRecoveredReviewTask(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  task: Task,
  currentColumnName: string,
  convergenceColumnId: string,
): Promise<boolean> {
  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) {
    return false;
  }

  const convergenceColumn = board.columns.find((column) => column.id === convergenceColumnId);
  if (!convergenceColumn) {
    const nextTask: Task = {
      ...task,
      columnId: convergenceColumnId,
      status: resolveTaskStatusForBoardColumn(board.columns, convergenceColumnId),
      updatedAt: new Date(),
    };
    await system.taskStore.save(nextTask);
    getKanbanEventBroadcaster().notify({
      workspaceId,
      entity: "task",
      action: "moved",
      resourceId: nextTask.id,
      source: "system",
    });
    return true;
  }

  const nextTask: Task = {
    ...task,
    columnId: convergenceColumn.id,
    status: resolveTaskStatusForBoardColumn(board.columns, convergenceColumn.id),
    updatedAt: new Date(),
  };
  await system.taskStore.save(nextTask);
  getKanbanEventBroadcaster().notify({
    workspaceId,
    entity: "task",
    action: "moved",
    resourceId: nextTask.id,
    source: "system",
  });
  await processKanbanColumnTransition(system, {
    cardId: nextTask.id,
    cardTitle: nextTask.title,
    boardId,
    workspaceId,
    fromColumnId: task.columnId ?? "__revive__",
    toColumnId: convergenceColumn.id,
    fromColumnName: currentColumnName,
    toColumnName: convergenceColumn.name,
    source: { type: "restart_recovery" },
  });
  return true;
}

export async function reviveMissingEntryAutomations(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  options: RestartRecoveryOptions,
): Promise<void> {
  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) return;

  // Pre-filter tasks belonging to this board and having a column assignment.
  // This avoids passing unrelated tasks through the expensive sanitize step.
  const allTasks = await system.taskStore.listByWorkspace(workspaceId);
  const boardTasks = allTasks.filter((t) => t.boardId === boardId && t.columnId);
  for (const originalTask of boardTasks) {
    const task = await sanitizeStaleCurrentLaneAutomation(system, originalTask, options);
    if (task.triggerSessionId) continue;

    const currentColumnId = task.columnId;
    if (!currentColumnId) continue;
    const column = board.columns.find((entry) => entry.id === currentColumnId);
    if (!column) continue;

    const convergenceColumnId = resolveReviewLaneConvergenceTarget(task, board.columns);
    if (convergenceColumnId && convergenceColumnId !== currentColumnId) {
      const converged = await convergeRecoveredReviewTask(
        system,
        workspaceId,
        boardId,
        task,
        column.name,
        convergenceColumnId,
      );
      if (converged) {
        continue;
      }
    }

    const automation = column.automation;
    const transitionType = automation?.transitionType ?? "entry";
    const hasLaneSessionForCurrentColumn = (task.laneSessions ?? []).some((entry) => (
      entry.columnId === currentColumnId
      && entry.status === "running"
      && isSessionActivelyRunning(entry.sessionId, options)
    ));
    if (
      !automation?.enabled
      || (transitionType !== "entry" && transitionType !== "both")
      || getKanbanAutomationSteps(automation).length === 0
      || hasLaneSessionForCurrentColumn
    ) {
      continue;
    }

    const laneState = resolveCurrentLaneAutomationState(task, board.columns);
    if (
      laneState.currentSession
      && laneState.currentSession.columnId === currentColumnId
      && (laneState.currentSession.status === "transitioned" || laneState.currentSession.status === "completed")
    ) {
      if (laneState.nextStep && typeof laneState.currentStepIndex === "number") {
        await enqueueKanbanTaskSession(system, {
          task,
          expectedColumnId: currentColumnId,
          ignoreExistingTrigger: true,
          step: laneState.nextStep,
          stepIndex: laneState.currentStepIndex + 1,
        });
      }
      // Lane automation already completed (with or without remaining steps
      // that were skipped). Skip re-triggering to avoid duplicate sessions.
      continue;
    }

    // Dependency gate: skip re-triggering if dependencies are still unsatisfied
    if (task.dependencies && task.dependencies.length > 0 && boardId) {
      const board = await system.kanbanBoardStore.get(boardId);
      if (board) {
        const { checkDependencyGate } = await import("./dependency-gate");
        const gateResult = await checkDependencyGate(task, board.columns, system.taskStore);
        if (gateResult.blocked) {
          console.log(
            `[RestartRecovery] Skipping ${task.id} (${task.title}): blocked by [${gateResult.pendingDependencies.join(", ")}]`,
          );
          continue;
        }
      }
    }

    await processKanbanColumnTransition(system, {
      cardId: task.id,
      cardTitle: task.title,
      boardId,
      workspaceId,
      fromColumnId: "__revive__",
      toColumnId: currentColumnId,
      fromColumnName: "Revive",
      toColumnName: column.name,
      source: { type: "restart_recovery" },
    });
  }
}

// ─── Startup Stuck-Task Sweeper ──────────────────────────────────────────────

/** Error patterns that indicate a permanently stuck task requiring sweep recovery. */
const REPEAT_LIMIT_PATTERN = "Stopped Kanban automation";
const STEP_RESUME_LIMIT_PATTERN = "Max retries";
const ADVANCE_RECOVERY_PATTERN = "[advance-recovery]";

function isPermanentlyStuckError(lastSyncError: string | undefined): boolean {
  if (!lastSyncError) return false;
  const errorType = getErrorType(lastSyncError);
  if (errorType === "repeat_limit") return true;
  if (errorType === "advance_recovery") return true;
  // Step-resume limit: message contains "Max retries" (works for both JSON and legacy)
  if (lastSyncError.includes(STEP_RESUME_LIMIT_PATTERN)) return true;
  // Circuit-breaker max resets exceeded
  if (errorType === "circuit_breaker") {
    const maxResets = getKanbanConfig().cbMaxCooldownResets;
    const resetCount = parseCbResetCount(lastSyncError);
    if (resetCount >= maxResets) return true;
  }
  return false;
}

export interface StuckTaskSweepSummary {
  scanned: number;
  swept: number;
  errors: number;
}

/**
 * Startup stuck-task sweeper — clears permanently-blocked error markers so
 * the LaneScanner and done-lane recovery tick can re-evaluate on the fresh
 * service instance.
 *
 * Runs once at startup, before any periodic ticks fire. Safe to call
 * idempotently — tasks that are not stuck are left untouched.
 */
export async function sweepStuckTasksOnStartup(
  system: Pick<RoutaSystem, "taskStore" | "kanbanBoardStore" | "workspaceStore">,
): Promise<StuckTaskSweepSummary> {
  const summary: StuckTaskSweepSummary = { scanned: 0, swept: 0, errors: 0 };

  try {
    const workspaces = await system.workspaceStore.list();
    for (const ws of workspaces) {
      const tasks = await system.taskStore.listByWorkspace(ws.id);
      for (const task of tasks) {
        if (!isPermanentlyStuckError(task.lastSyncError)) continue;
        summary.scanned++;

        try {
          const cleaned = clearStuckMarker(task, "full");

          // Fix orphan IN_PROGRESS in done/archived columns
          let nextStatus: TaskStatus | undefined;
          if (
            task.status === "IN_PROGRESS"
            && task.boardId
            && task.columnId
          ) {
            const board = await system.kanbanBoardStore.get(task.boardId);
            const col = board?.columns.find((c) => c.id === task.columnId);
            if (col?.stage === "done" || col?.stage === "archived" || col?.id === "done") {
              nextStatus = "COMPLETED" as TaskStatus;
            }
          }

          if (task.version !== undefined && system.taskStore.atomicUpdate) {
            await system.taskStore.atomicUpdate(task.id, task.version, {
              lastSyncError: cleaned.lastSyncError,
              laneSessions: cleaned.laneSessions,
              ...(nextStatus ? { status: nextStatus } : {}),
              updatedAt: new Date(),
            });
          } else {
            task.lastSyncError = cleaned.lastSyncError;
            task.laneSessions = cleaned.laneSessions;
            if (nextStatus) task.status = nextStatus;
            task.updatedAt = new Date();
            await system.taskStore.save(task);
          }

          summary.swept++;
          console.log(
            `[StuckTaskSweeper] Cleared stuck marker for card ${task.id} ` +
            `in column ${task.columnId} (was: ${task.lastSyncError?.slice(0, 60)}...)`,
          );
        } catch (err) {
          summary.errors++;
          console.error(
            `[StuckTaskSweeper] Failed to sweep card ${task.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  } catch (err) {
    summary.errors++;
    console.error(
      "[StuckTaskSweeper] Sweep failed:",
      err instanceof Error ? err.message : err,
    );
  }

  if (summary.swept > 0 || summary.errors > 0) {
    console.log(
      `[StuckTaskSweeper] Startup sweep complete: scanned=${summary.scanned}, ` +
      `swept=${summary.swept}, errors=${summary.errors}`,
    );
  }

  return summary;
}
