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
import type { TaskStore } from "../store/task-store";
import { hasExceededNonDevAutomationRepeatLimit } from "./workflow-orchestrator";
import { getHttpSessionStore } from "../acp/http-session-store";
import { clearStaleTriggerSession } from "./task-trigger-session";
import { getKanbanAutomationSteps, type KanbanColumnStage, inferStageFromColumnId } from "../models/kanban";
import { AgentEventType } from "../events/event-bus";
import { PR_FAILURE_PREFIX } from "./pr-auto-create";
import { verifyPrMergeStatus } from "./pr-status-verifier";
import { checkPeriodicRefiner } from "./graph-refiner-trigger";
import { shouldSkipTickForMemory } from "./memory-guard";
import {
  isCircuitBreaker,
  isRateLimited,
  parseCbResetCount,
  parseSyncError,
  buildCircuitBreakerError,
  buildAdvanceRecoveryError,
  getErrorType,
} from "./sync-error-writer";
import { checkDependencyGate, dependencyUnblockFields } from "./dependency-gate";
import type { ColumnTransitionData } from "./column-transition";
import { analyzeFlowForTasks, getTopFailureColumns } from "./flow-ledger";
import { withHeartbeat } from "../scheduling/system-heartbeat-registry";
import { getKanbanConfig } from "./kanban-config";
import { safeAtomicSave } from "./atomic-task-update";

const scannerCfg = getKanbanConfig();

const SCAN_INTERVAL_MS = 30_000;
const MAX_STEP_RESUME_ATTEMPTS = 3;

/** Adaptive scan interval based on recent activity. */
function computeScanInterval(stats: LaneScannerStats): number {
  const IDLE_MS = 60_000;
  const NORMAL_MS = 30_000;
  const ERROR_MS = 15_000;
  if (stats.errors > 0) return ERROR_MS;
  if (stats.triggeredTasks === 0 && stats.errors === 0) return IDLE_MS;
  return NORMAL_MS;
}
/** Minimum age (ms) before verifying PR merge status via GitHub API. */
const PR_VERIFICATION_MIN_AGE_MS = 5 * 60 * 1000;

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
  return withHeartbeat("kanban-lane-scanner", () => runLaneScannerTickInner(system));
}

async function runLaneScannerTickInner(system: RoutaSystem): Promise<LaneScannerStats> {
  const state = getScannerState();

  // Memory guard: skip tick if heap memory is approaching the limit
  if (shouldSkipTickForMemory("LaneScanner")) {
    return state.stats;
  }

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

      // Flow-ledger feedback: skip columns with chronic high failure rates
      let skipColumns: Set<string> | null = null;
      try {
        const report = analyzeFlowForTasks(boardTasks, {
          workspaceId: board.workspaceId,
          boardId: board.id,
        });
        const topFailures = getTopFailureColumns(report.laneMetrics, scannerCfg.flowFailureThreshold);
        if (topFailures.length > 0) {
          skipColumns = new Set(topFailures);
        }
      } catch { /* non-critical — continue without flow filtering */ }

      for (const task of boardTasks) {
        // Skip tasks not in an automated column
        if (!task.columnId || !automatedColumnIds.has(task.columnId)) continue;
        // Flow-ledger: skip tasks in columns with chronic failure (>= 70% failure rate)
        if (skipColumns && skipColumns.has(task.columnId) && !task.triggerSessionId) continue;
        // Skip tasks that already have an active trigger; clean up stale ones
        if (task.triggerSessionId) {
          const cleaned = await clearStaleTriggerSession(task, getHttpSessionStore(), system.taskStore);
          if (!cleaned) continue;
        }
        // Skip completed/blocked tasks.
        // Done-lane COMPLETED cards with a real PR that isn't merged are handled
        // exclusively by the done-lane recovery tick (standalone conflict-resolver
        // sessions). The lane scanner must NOT reset them to IN_PROGRESS — doing
        // so creates a zombie loop: COMPLETED → IN_PROGRESS → pipeline → fail → COMPLETED → repeat.
        if (task.status === "COMPLETED" || task.status === "BLOCKED" || task.status === "CANCELLED") {
          continue;
        }
        // Done-lane PR-settled guard: cards in done-stage columns that already
        // have a real PR URL are considered settled unless auto-merge is needed.
        // This prevents the lane scanner from re-triggering cards that the
        // WorkflowOrchestrator has already processed through the done-lane pipeline.
        if (task.pullRequestUrl && columnStageMap.get(task.columnId ?? "") === "done") {
          const isPRSettled = task.pullRequestMergedAt
            || task.pullRequestUrl === "manual"
            || task.pullRequestUrl === "already-merged";
          if (isPRSettled) continue;
          // PR not merged — only allow re-triggering if auto-merge is configured
          const col = automatedColumns.find(
            (c: { id: string }) => c.id === task.columnId,
          );
          const wantsAutoMerge = (col as { automation?: { deliveryRules?: { autoMergeAfterPR?: boolean } } })
            ?.automation?.deliveryRules?.autoMergeAfterPR;
          if (!wantsAutoMerge) {
            // Even though auto-merge is disabled, verify PR merge status via GitHub API
            // to catch webhook-lost merges. Only check tasks that have been in done for
            // at least PR_VERIFICATION_MIN_AGE_MS to avoid unnecessary API calls.
            const taskAge = task.updatedAt instanceof Date
              ? task.updatedAt.getTime()
              : new Date(task.updatedAt as string | number).getTime();
            if (Date.now() - taskAge > PR_VERIFICATION_MIN_AGE_MS) {
              try {
                const verification = await verifyPrMergeStatus(task.pullRequestUrl);
                if (verification.verified && verification.merged) {
                  console.log(
                    `[LaneScanner] Settled guard: PR actually merged on GitHub for card ${task.id}. ` +
                    `Syncing pullRequestMergedAt.`,
                  );
                  const prSaved = await safeAtomicSave(task, system.taskStore, {
                    pullRequestMergedAt: verification.mergedAt ? new Date(verification.mergedAt) : new Date(),
                    lastSyncError: undefined,
                    updatedAt: new Date(),
                  }, "PR merge verification");
                  if (!prSaved) continue;
                }
              } catch {
                // Verification failed silently — skip this card for now.
              }
            }
            continue;
          }
        }
        // Circuit-breaker / rate-limit: skip cards marked as failed, but auto-recover
        // after the cooldown period (SESSION_RETRY_RESET_MS, default 5 min).
        if (isCircuitBreaker(task.lastSyncError) || isRateLimited(task.lastSyncError)) {
          const updatedAt = task.updatedAt instanceof Date
            ? task.updatedAt.getTime()
            : new Date(task.updatedAt as string | number).getTime();
          const cooldownMs = scannerCfg.sessionRetryResetMs;
          if (Date.now() - updatedAt < cooldownMs) continue;
          // Check if this card has exceeded the max cooldown reset count
          if (isCircuitBreaker(task.lastSyncError)) {
            const resetCount = parseCbResetCount(task.lastSyncError);
            const maxResets = scannerCfg.cbMaxCooldownResets;
            if (resetCount >= maxResets) {
              continue; // Permanently skip — too many cooldown resets
            }
            // Increment reset count in the marker for next cycle
            const newResetCount = resetCount + 1;
            console.log(
              `[LaneScanner] Cooldown expired for card ${task.id}, ` +
              `clearing circuit-breaker marker (reset ${newResetCount}/${maxResets}).`,
            );
            // Preserve PR failure info if embedded in the previous lastSyncError
            const prevPayload = parseSyncError(task.lastSyncError);
            const prevInfo = prevPayload?.prev
              ?? (task.lastSyncError?.includes(PR_FAILURE_PREFIX) ? task.lastSyncError : undefined);
            task.lastSyncError = buildCircuitBreakerError(
              newResetCount,
              "pending retry.",
              prevInfo,
            );
          } else {
            console.log(
              `[LaneScanner] Cooldown expired for card ${task.id}, clearing rate-limit marker.`,
            );
          }
          const cbFields = {
            lastSyncError: task.lastSyncError,
            updatedAt: new Date(),
          };
          const cbSaved = await safeAtomicSave(task, system.taskStore, cbFields, "circuit-breaker reset");
          if (!cbSaved) continue;
        }
        // Skip creation-source sessions (auto-generated from agent runs)
        if (task.creationSource === "session") continue;
        // Early dependency-blocked recovery: re-check whether dependencies are now
        // satisfied even when no lane sessions exist for the current column.
        // Without this, cards blocked before any session started in this column
        // would never be re-evaluated (the original recovery path inside
        // allStepsCompleted requires completed lane sessions).
        if (getErrorType(task.lastSyncError) === "dependency_blocked") {
          if (task.dependencies.length > 0 && task.boardId) {
            const board = await system.kanbanBoardStore.get(task.boardId);
            if (board) {
              const depCheck = await checkDependencyGate(task, board.columns, system.taskStore);
              if (!depCheck.blocked) {
                const unblockSaved = await safeAtomicSave(task, system.taskStore, dependencyUnblockFields(), "early dependency unblock");
                if (unblockSaved) {
                  console.log(
                    `[LaneScanner] Early dependency unblocked for card ${task.id}. Will re-trigger on next scan.`,
                  );
                }
              }
            }
          }
          continue;
        }
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

        // All steps completed → check for stale error state or failed advance before skipping
        const allStepsCompleted = steps.length > 0 && lastCompletedStepIndex >= steps.length - 1;
        if (allStepsCompleted) {
          if (!task.lastSyncError) {
            // Check for failed advance: the card completed all steps in the current
            // column but has failed/timed_out lane sessions in OTHER columns. This
            // indicates an auto-advance was attempted but the downstream automation
            // failed, leaving the card stranded (e.g. backlog refiner completed,
            // auto-advance to todo triggered, but todo orchestrator session failed).
            const hasFailedAdvance = laneSessions.some(
              (s: { columnId?: string; status: string }) =>
                s.columnId !== task.columnId
                && (s.status === "failed" || s.status === "timed_out"),
            );

            // Detect "should have auto-advanced but didn't" — all steps completed,
            // autoAdvanceOnSuccess is configured, yet the card is still in this column.
            // This can happen when autoAdvanceCard loses a version-conflict race or
            // the server restarts between session completion and the advance.
            const shouldAutoAdvance = currentColumn?.automation?.autoAdvanceOnSuccess === true;
            const columnStage = currentColumn?.stage ?? (currentColumn?.id ? inferStageFromColumnId(currentColumn.id) : undefined);
            // Terminal stages (done/archived) have nowhere to advance to — skip advance-only logic.
            const stuckInColumn = shouldAutoAdvance && columnStage !== "done" && columnStage !== "archived";

            if (!hasFailedAdvance && !stuckInColumn) {
              continue; // No error, no cross-column failures, no pending advance — genuinely done
            }

            // Stuck-in-column with no cross-column failures: auto-advance was lost.
            // Emit an advance-only COLUMN_TRANSITION so the orchestrator retries
            // autoAdvanceCard WITHOUT re-running the specialist step.
            if (stuckInColumn && !hasFailedAdvance) {
              const stuckAttempts = countStepAttempts(laneSessions, task.columnId!, 0, { countCompleted: true });
              if (stuckAttempts >= MAX_STEP_RESUME_ATTEMPTS) {
                await safeAtomicSave(task, system.taskStore, {
                  lastSyncError: buildAdvanceRecoveryError(
                    `Max retries (${MAX_STEP_RESUME_ATTEMPTS}) reached. Card completed in "${currentColumn?.name}" but auto-advance kept failing.`,
                  ),
                  updatedAt: new Date(),
                }, "stuck-advance limit");
                continue;
              }
              console.log(
                `[LaneScanner] Card ${task.id} completed all steps in "${currentColumn?.name}" ` +
                `but is still in this column (autoAdvanceOnSuccess=true). Emitting advance-only event (attempt ${stuckAttempts + 1}/${MAX_STEP_RESUME_ATTEMPTS}).`,
              );
              // Emit advance-only event — orchestrator will call autoAdvanceCard
              // without re-running the specialist step.
              try {
                const freshCheck = await system.taskStore.get(task.id);
                if (!freshCheck || freshCheck.columnId !== task.columnId) {
                  continue;
                }
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
                    source: { type: "advance_only" },
                  } as Record<string, unknown>,
                  timestamp: new Date(),
                });
              } catch (err) {
                console.warn(
                  `[LaneScanner] Failed to emit advance-only event for task ${task.id}:`,
                  err instanceof Error ? err.message : err,
                );
              }
              continue;
            }

            // Recovery: clear orphaned failed sessions from other columns and
            // re-trigger the current column's automation. The autoAdvance mechanism
            // will retry the push to the next column.
            const advanceRecoveryAttempts = countStepAttempts(laneSessions, task.columnId!, 0, { countCompleted: true });
            if (advanceRecoveryAttempts >= MAX_STEP_RESUME_ATTEMPTS) {
              await safeAtomicSave(task, system.taskStore, {
                lastSyncError: buildAdvanceRecoveryError(
                  `Max retries (${MAX_STEP_RESUME_ATTEMPTS}) reached. Card completed in "${currentColumn?.name}" but failed to advance.`,
                ),
                updatedAt: new Date(),
              }, "advance recovery limit");
              continue;
            }

            console.log(
              `[LaneScanner] Detected failed advance for card ${task.id} in column ${task.columnId}. ` +
              `Clearing orphan sessions and re-triggering.`,
            );

            // Remove failed sessions from other columns — they're stale evidence
            // of previous failed advance attempts.
            const filteredSessions = laneSessions.filter(
              (s: { columnId?: string; status: string }) =>
                !(s.columnId !== task.columnId && (s.status === "failed" || s.status === "timed_out")),
            );
            const advSaved = await safeAtomicSave(task, system.taskStore, {
              laneSessions: filteredSessions,
              updatedAt: new Date(),
            }, "advance recovery cleanup");
            if (!advSaved) continue;
            // Fall through — re-trigger current column automation (autoAdvance will push again)
          } else {
            // Stale-state recovery: lastSyncError set + all current-column steps
            // "transitioned"/"completed" means the card was returned to this column
            // after a downstream failure (e.g. worktree creation failed). Re-trigger
            // from step 0 with bounded retries.
            // For split parents waiting for children, skip re-triggering entirely —
            // the parent will auto-advance when all children complete.
            if (task.lastSyncError?.startsWith("[Split]")) {
              continue;
            }
            // For dependency-blocked errors, re-check whether dependencies are now
            // satisfied — the prerequisite task may have completed since last scan.
            if (getErrorType(task.lastSyncError) === "dependency_blocked") {
              if (task.dependencies.length > 0 && task.boardId) {
                const board = await system.kanbanBoardStore.get(task.boardId);
                if (board) {
                  const depCheck = await checkDependencyGate(task, board.columns, system.taskStore);
                  if (!depCheck.blocked) {
                    const unblockSaved = await safeAtomicSave(task, system.taskStore, dependencyUnblockFields(), "dependency unblock");
                    if (unblockSaved) {
                      console.log(
                        `[LaneScanner] Dependency unblocked for card ${task.id}. Will re-trigger on next scan.`,
                      );
                    }
                  }
                }
              }
              continue;
            }
            const recoveryAttempts = countStepAttempts(laneSessions, task.columnId!, 0);
            if (recoveryAttempts >= MAX_STEP_RESUME_ATTEMPTS) {
              continue;
            }
            const staleSaved = await safeAtomicSave(task, system.taskStore, {
              lastSyncError: undefined,
              updatedAt: new Date(),
            }, "stale-state recovery");
            if (!staleSaved) continue;
            // Fall through — resumeStepIndex stays undefined → step 0
          }
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
        // Defensive check: verify the card hasn't been moved to a different
        // column by a concurrent writer since we started processing it.
        try {
          const freshCheck = await system.taskStore.get(task.id);
          if (!freshCheck || freshCheck.columnId !== task.columnId) {
            console.log(
              `[LaneScanner] Card ${task.id} moved from ${task.columnId} to ${freshCheck?.columnId} during scan. Skipping trigger.`,
            );
            continue;
          }
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
              source: { type: "lane_scanner", resumeStepIndex },
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

  // Periodic Graph Refiner fallback
  await checkPeriodicRefiner(system);

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
    scheduleNextTick(system);
  }, 5_000);

  g[`${GLOBAL_KEY}_started`] = true;
  console.log("[LaneScanner] Started (adaptive interval: 15s–60s)");
}

/** Schedule the next tick based on current scanner stats. */
function scheduleNextTick(system: RoutaSystem): void {
  const interval = computeScanInterval(getScannerState().stats);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    void runLaneScannerTick(system)
      .then(() => {
        if ((globalThis as Record<string, unknown>)[`${GLOBAL_KEY}_started`]) {
          scheduleNextTick(system);
        }
      })
      .catch((err) => {
        console.error("[LaneScanner] Tick failed, will retry:", err);
        if ((globalThis as Record<string, unknown>)[`${GLOBAL_KEY}_started`]) {
          scheduleNextTick(system);
        }
      });
  }, interval);
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
    clearTimeout(scanTimer);
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
  options?: { countCompleted?: boolean },
): number {
  let count = 0;
  for (const entry of laneSessions) {
    if (
      entry.columnId === columnId
      && typeof entry.stepIndex === "number"
      && entry.stepIndex === stepIndex
      && (options?.countCompleted || entry.status !== "completed")
    ) {
      count++;
    }
  }
  return count;
}
