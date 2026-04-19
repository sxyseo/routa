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
import { enqueueKanbanTaskSession } from "./workflow-orchestrator-singleton";
import { hasExceededNonDevAutomationRepeatLimit } from "./workflow-orchestrator";

const SCAN_INTERVAL_MS = 30_000;

let scanTimer: ReturnType<typeof setInterval> | null = null;
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
        // Skip tasks that already have an active trigger
        if (task.triggerSessionId) continue;
        // Skip completed/blocked tasks
        if (task.status === "COMPLETED" || task.status === "BLOCKED") continue;
        // Skip creation-source sessions (auto-generated from agent runs)
        if (task.creationSource === "session") continue;
        // Skip tasks whose lane automation already completed successfully —
        // re-triggering would cause an infinite loop when the card has nowhere
        // to advance (e.g. done is the last column).
        const laneSessions = task.laneSessions ?? [];
        const lastLaneSession = laneSessions.length > 0 ? laneSessions[laneSessions.length - 1] : undefined;
        if (lastLaneSession?.columnId === task.columnId && lastLaneSession?.status === "completed") {
          continue;
        }
        // Respect the repeat limit for this column/stage (including blocked)
        const stage = columnStageMap.get(task.columnId);
        if (stage && hasExceededNonDevAutomationRepeatLimit(task, task.columnId, stage as import("../models/kanban").KanbanColumnStage)) {
          continue;
        }

        scannedTasks++;

        try {
          const result = await enqueueKanbanTaskSession(system, {
            task,
            expectedColumnId: task.columnId,
          });

          if (result.sessionId || result.queued) {
            triggeredTasks++;
          }
        } catch (err) {
          errors++;
          console.warn(
            `[LaneScanner] Failed to enqueue task ${task.id} in column ${task.columnId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  } catch (err) {
    errors++;
    console.error("[LaneScanner] Scan tick failed:", err instanceof Error ? err.message : err);
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
  setTimeout(() => {
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
