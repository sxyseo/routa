/**
 * Kanban Lane Scanner
 *
 * Periodically scans kanban lanes (columns) for tasks that have automation
 * enabled but no active triggerSessionId. This ensures tasks that were missed
 * by the API-level trigger (e.g., created while the server was down, or after
 * a restart) get picked up and processed automatically.
 *
 * Runs as a background tick registered in the SchedulerService.
 */

import type { RoutaSystem } from "../routa-system";
import { hasExceededNonDevAutomationRepeatLimit } from "./workflow-orchestrator";
import { getHttpSessionStore } from "../acp/http-session-store";
import { clearStaleTriggerSession } from "./task-trigger-session";
import { getKanbanAutomationSteps, type KanbanColumnStage } from "../models/kanban";
import { AgentEventType } from "../events/event-bus";

const SCAN_INTERVAL_MS = 30_000;
const MAX_STEP_RESUME_ATTEMPTS = 3;

let scanTimer: ReturnType<typeof setInterval> | null = null;
let initialScanTimer: ReturnType<typeof setTimeout> | null = null;
let isScanning = false;
const GLOBAL_KEY = "__routa_kanban_lane_scanner__";

export interface LaneScannerStats {
  lastScanAt: Date | null;
  scannedTasks: number;
  triggeredTasks: number;
  errors: number;
}

interface LaneScannerState {
  stats: LaneScannerStats;
}

function getScannerState(): LaneScannerState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      stats: {
        lastScanAt: null,
        scannedTasks: 0,
        triggeredTasks: 0,
        errors: 0,
      },
    };
  }
  return g[GLOBAL_KEY] as LaneScannerState;
}

/**
 * Run a single scan pass across all boards looking for tasks with
 * enabled lane automation but no triggerSessionId.
 */
export async function runLaneScannerTick(system: RoutaSystem): Promise<LaneScannerStats> {
  const state = getScannerState();

  // Prevent re-entry: if previous tick is still running, skip this one
  if (isScanning) {
    return state.stats;
  }
  isScanning = true;

  let scannedTasks = 0;
  let triggeredTasks = 0;
  let errors = 0;

  try {
    // Collect all boards across all workspaces
    const workspaces = await system.workspaceStore.list();
    const boards: Array<Awaited<ReturnType<typeof system.kanbanBoardStore.get>> & { id: string }> = [];
    for (const ws of workspaces) {
      const wsBoards = await system.kanbanBoardStore.listByWorkspace(ws.id);
      for (const b of wsBoards) {
        boards.push(b);
      }
    }

    for (const board of boards) {
      // Find columns with enabled automation
      const automatedColumns = board.columns.filter(
        (col: { automation?: { enabled?: boolean } }) => col.automation?.enabled === true,
      );
      if (automatedColumns.length === 0) continue;

      const automatedColumnIds = new Set(
        automatedColumns.map((col: { id: string }) => col.id),
      );

      // Build a stage lookup per column for repeat-limit checks
      const columnStageMap = new Map<string, string>();
      for (const col of automatedColumns) {
        if (col.stage) columnStageMap.set(col.id, col.stage);
      }

      // Get all tasks for this board
      const tasks = await system.taskStore.listByWorkspace(board.workspaceId);
      const boardTasks = tasks.filter(
        (t: { boardId?: string }) => (t.boardId ?? board.id) === board.id,
      );

      for (const task of boardTasks) {
        // Skip tasks not in an automated column
        if (!task.columnId || !automatedColumnIds.has(task.columnId)) continue;
        // Skip tasks that already have an active trigger; clean up stale ones
        if (task.triggerSessionId) {
          const cleaned = await clearStaleTriggerSession(task, getHttpSessionStore(), system.taskStore);
          if (!cleaned) continue;
        }
        // Skip completed/blocked tasks
        if (task.status === "COMPLETED" || task.status === "BLOCKED") continue;
        // Skip creation-source sessions (auto-generated from agent runs)
        if (task.creationSource === "session") continue;
        // Skip tasks whose lane automation already completed successfully —
        // re-triggering would cause an infinite loop when the card has nowhere
        // to advance (e.g. done is the last column).
        // For multi-step automations, find the highest completed step to avoid
        // re-running earlier steps that already succeeded.
        const laneSessions = task.laneSessions ?? [];
        const currentColumn = board.columns.find(
          (col: { id: string }) => col.id === task.columnId,
        );
        const steps = getKanbanAutomationSteps(currentColumn?.automation);
        const lastCompletedStepIndex = findLastCompletedStepIndex(laneSessions, task.columnId!);

        // All steps completed → check for stale error state before skipping
        const allStepsCompleted = steps.length > 0 && lastCompletedStepIndex >= steps.length - 1;
        if (allStepsCompleted) {
          if (!task.lastSyncError) {
            continue;
          }
          // Stale-state recovery: lastSyncError set + all current-column steps
          // "transitioned"/"completed" means the card was returned to this column
          // after a downstream failure (e.g. worktree creation failed). Re-trigger
          // from step 0 with bounded retries.
          const recoveryAttempts = countStepAttempts(laneSessions, task.columnId!, 0);
          if (recoveryAttempts >= MAX_STEP_RESUME_ATTEMPTS) {
            continue;
          }
          task.lastSyncError = undefined;
          task.updatedAt = new Date();
          await system.taskStore.save(task);
          // Fall through — resumeStepIndex stays undefined → step 0
        }

        // For multi-step resume: check per-step attempt limit to prevent
        // infinite retries when timed_out sessions don't count toward
        // the global repeat limit.
        let resumeStepIndex: number | undefined;
        if (lastCompletedStepIndex >= 0 && lastCompletedStepIndex < steps.length - 1) {
          const nextStepIndex = lastCompletedStepIndex + 1;
          const stepAttempts = countStepAttempts(laneSessions, task.columnId!, nextStepIndex);
          if (stepAttempts >= MAX_STEP_RESUME_ATTEMPTS) {
            continue;
          }
          resumeStepIndex = nextStepIndex;
        }

        // Respect the repeat limit for this column/stage (including blocked)
        const stage = columnStageMap.get(task.columnId);
        if (stage && hasExceededNonDevAutomationRepeatLimit(task, task.columnId!, stage as KanbanColumnStage)) {
          continue;
        }

        scannedTasks++;

        // Trigger via COLUMN_TRANSITION event so the Workflow Orchestrator
        // manages the full multi-step flow (ActiveAutomation tracking,
        // laneSession status updates, terminal guard, etc.).
        try {
          system.eventBus.emit({
            type: AgentEventType.COLUMN_TRANSITION,
            agentId: "kanban-lane-scanner",
            workspaceId: task.workspaceId,
            data: {
              cardId: task.id,
              cardTitle: task.title,
              boardId: board.id,
              workspaceId: task.workspaceId,
              fromColumnId: task.columnId,
              toColumnId: task.columnId,
              resumeStepIndex,
            } as Record<string, unknown>,
            timestamp: new Date(),
          });
          triggeredTasks++;
        } catch (err) {
          errors++;
          console.warn(
            `[LaneScanner] Failed to emit transition for task ${task.id} in column ${task.columnId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  } catch (err) {
    errors++;
    console.error("[LaneScanner] Scan tick failed:", err instanceof Error ? err.message : err);
  } finally {
    isScanning = false;
  }

  state.stats = {
    lastScanAt: new Date(),
    scannedTasks,
    triggeredTasks,
    errors,
  };

  return state.stats;
}

/**
 * Start the periodic lane scanner.
 * Idempotent — calling multiple times is safe.
 */
export function startLaneScanner(system: RoutaSystem): void {
  const g = globalThis as Record<string, unknown>;
  if (g[`${GLOBAL_KEY}_started`]) return;

  // Run initial scan after a short delay to let the system warm up
  initialScanTimer = setTimeout(() => {
    initialScanTimer = null;
    void runLaneScannerTick(system);
  }, 5_000);

  scanTimer = setInterval(() => {
    void runLaneScannerTick(system);
  }, SCAN_INTERVAL_MS);

  g[`${GLOBAL_KEY}_started`] = true;
  console.log(`[LaneScanner] Started (interval: ${SCAN_INTERVAL_MS / 1000}s)`);
}

/**
 * Stop the lane scanner.
 */
export function stopLaneScanner(): void {
  const g = globalThis as Record<string, unknown>;
  if (initialScanTimer) {
    clearTimeout(initialScanTimer);
    initialScanTimer = null;
  }
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  g[`${GLOBAL_KEY}_started`] = false;
}

/**
 * Get current scanner stats.
 */
export function getLaneScannerStats(): LaneScannerStats {
  return getScannerState().stats;
}

/**
 * Find the highest stepIndex that completed successfully for the given column.
 * Returns -1 if no completed/transitioned step is found.
 */
function findLastCompletedStepIndex(
  laneSessions: Array<{ columnId?: string; stepIndex?: number; status: string }>,
  columnId: string,
): number {
  let result = -1;
  for (const entry of laneSessions) {
    if (
      entry.columnId === columnId
      && typeof entry.stepIndex === "number"
      && (entry.status === "completed" || entry.status === "transitioned")
      && entry.stepIndex > result
    ) {
      result = entry.stepIndex;
    }
  }
  return result;
}

/**
 * Count total attempts for a specific step in the given column (all statuses).
 * Used to prevent infinite retries when timed_out sessions don't count toward
 * the global repeat limit.
 */
function countStepAttempts(
  laneSessions: Array<{ columnId?: string; stepIndex?: number; status: string }>,
  columnId: string,
  stepIndex: number,
): number {
  let count = 0;
  for (const entry of laneSessions) {
    if (
      entry.columnId === columnId
      && typeof entry.stepIndex === "number"
      && entry.stepIndex === stepIndex
    ) {
      count++;
    }
  }
  return count;
}
