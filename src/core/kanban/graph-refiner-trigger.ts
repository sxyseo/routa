/**
 * Graph Refiner Trigger — debounce-based trigger for the Graph Refiner.
 *
 * Monitors Backlog changes and runs the refiner after a debounce period.
 * State is stored in globalThis to survive HMR and match the lane-scanner pattern.
 */

import type { RoutaSystem } from "../routa-system";
import type { Task } from "../models/task";
import { runGraphRefiner } from "./graph-refiner";
import { getKanbanConfig } from "./kanban-config";
import { EventBus, AgentEventType } from "../events/event-bus";

// ─── Types ──────────────────────────────────────────────────────────────

interface RefinerTriggerState {
  /** Per-board debounce timers */
  timers: Map<string, ReturnType<typeof setTimeout>>;
  /** Per-board flags: true while a refiner run is in progress */
  running: Map<string, boolean>;
  /** Per-board flags: true if a change arrived during a running refiner */
  pending: Map<string, boolean>;
  /** Global started flag */
  started: boolean;
  /** Tick counter for periodic check throttling */
  periodicTickCounter: number;
}

// ─── Singleton state ────────────────────────────────────────────────────

const GLOBAL_KEY = "routa_graph_refiner_trigger";

function getState(): RefinerTriggerState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      timers: new Map(),
      running: new Map(),
      pending: new Map(),
      started: false,
      periodicTickCounter: 0,
    };
  }
  return g[GLOBAL_KEY] as RefinerTriggerState;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function boardKey(boardId: string): string {
  return `refiner-${boardId}`;
}

// ─── Execution ──────────────────────────────────────────────────────────

async function executeRefinerRun(
  system: RoutaSystem,
  boardId: string,
  workspaceId: string,
): Promise<void> {
  const config = getKanbanConfig();
  if (!config.graphRefinerEnabled) return;

  const state = getState();
  const key = boardKey(boardId);

  if (state.running.get(key)) {
    state.pending.set(key, true);
    return;
  }

  state.running.set(key, true);

  try {
    // Fetch backlog tasks for this board
    const allTasks = await system.taskStore.listByWorkspace(workspaceId);
    const board = await system.kanbanBoardStore.get(boardId);
    if (!board) return;

    const backlogColumnIds = board.columns
      .filter((c) => c.stage === "backlog")
      .map((c) => c.id);

    const backlogTasks = allTasks.filter(
      (t) => backlogColumnIds.includes(t.columnId ?? ""),
    );

    if (backlogTasks.length < config.graphRefinerMinTasks) return;

    console.log(
      `[GraphRefiner] Running refiner for board ${boardId} with ${backlogTasks.length} backlog tasks`,
    );

    const result = await runGraphRefiner(backlogTasks, system.taskStore);

    if (result.inferredCount > 0) {
      console.log(
        `[GraphRefiner] Board ${boardId}: inferred ${result.inferredCount} dependencies, ` +
        `${result.skippedCycles} cycle skips, ${result.errors.length} errors`,
      );
    }

    if (result.errors.length > 0) {
      console.warn(`[GraphRefiner] Board ${boardId} errors:`, result.errors);
    }

    // Emit completion event
    system.eventBus.emit({
      type: AgentEventType.GRAPH_REFINER_COMPLETED,
      agentId: "graph-refiner",
      workspaceId,
      data: {
        boardId,
        inferredCount: result.inferredCount,
        skippedCycles: result.skippedCycles,
        errors: result.errors,
      },
      timestamp: new Date(),
    });
  } catch (err) {
    console.error(
      `[GraphRefiner] Run failed for board ${boardId}:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    state.running.set(key, false);

    // If changes arrived during the run, re-trigger immediately
    if (state.pending.get(key)) {
      state.pending.set(key, false);
      scheduleRefinerRun(system, boardId, workspaceId, 0);
    }
  }
}

function scheduleRefinerRun(
  system: RoutaSystem,
  boardId: string,
  workspaceId: string,
  delayMs?: number,
): void {
  const state = getState();
  const key = boardKey(boardId);
  const config = getKanbanConfig();
  const debounceMs = delayMs ?? config.graphRefinerDebounceMs;

  // Clear existing timer
  const existing = state.timers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    state.timers.delete(key);
    void executeRefinerRun(system, boardId, workspaceId);
  }, debounceMs);

  state.timers.set(key, timer);
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Notify the trigger that a Backlog change occurred.
 * Starts or resets the debounce timer for the affected board.
 */
export function notifyBacklogChange(
  system: RoutaSystem,
  boardId: string,
  workspaceId: string,
): void {
  const config = getKanbanConfig();
  if (!config.graphRefinerEnabled) return;

  scheduleRefinerRun(system, boardId, workspaceId);
}

/**
 * Check if any board needs a periodic refiner run.
 * Called from the Lane Scanner tick as a fallback.
 */
const PERIODIC_CHECK_INTERVAL = 10;

export async function checkPeriodicRefiner(
  system: RoutaSystem,
): Promise<void> {
  const config = getKanbanConfig();
  if (!config.graphRefinerEnabled) return;

  const state = getState();
  state.periodicTickCounter++;
  if (state.periodicTickCounter < PERIODIC_CHECK_INTERVAL) return;
  state.periodicTickCounter = 0;

  const workspaces = await system.workspaceStore.list();

  for (const ws of workspaces) {
    const board = await system.kanbanBoardStore.getDefault(ws.id);
    if (!board) continue;

    const key = boardKey(board.id);
    // Skip if already scheduled or running
    if (state.timers.has(key) || state.running.get(key)) continue;

    const backlogColumnIds = board.columns
      .filter((c) => c.stage === "backlog")
      .map((c) => c.id);

    const tasks = await system.taskStore.listByWorkspace(ws.id);
    const backlogTasks = tasks.filter(
      (t) => backlogColumnIds.includes(t.columnId ?? ""),
    );

    if (backlogTasks.length >= config.graphRefinerMinTasks) {
      console.log(`[GraphRefiner] Periodic trigger for board ${board.id}`);
      await executeRefinerRun(system, board.id, ws.id);
    }
  }
}

/**
 * Start the Graph Refiner trigger (idempotent).
 */
export function startGraphRefinerTrigger(_system: RoutaSystem): void {
  const state = getState();
  if (state.started) return;
  state.started = true;
  console.log("[GraphRefiner] Trigger started");
}

/**
 * Stop the Graph Refiner trigger and clean up all timers.
 */
export function stopGraphRefinerTrigger(): void {
  const state = getState();
  for (const timer of state.timers.values()) {
    clearTimeout(timer);
  }
  state.timers.clear();
  state.running.clear();
  state.pending.clear();
  state.started = false;
  console.log("[GraphRefiner] Trigger stopped");
}
