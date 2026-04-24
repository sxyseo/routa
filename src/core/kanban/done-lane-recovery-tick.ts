/**
 * Done-Lane Recovery Tick — periodic task that detects and recovers stuck Done cards.
 *
 * Runs every 10 minutes as a safety net for edge cases not handled by the
 * lane scanner or workflow orchestrator:
 *
 *   - Webhook-lost PR merges (PR merged on GitHub but pullRequestMergedAt not set)
 *   - Circuit-breaker exhausted + PR still unmerged
 *   - Orphan IN_PROGRESS tasks in done lane with no active session
 *   - Conflict-detected PRs that need conflict-resolver specialist
 */

import type { RoutaSystem } from "../routa-system";
import type { Task, TaskLaneSession } from "../models/task";
import type { KanbanBoard } from "../models/kanban";
import { verifyPrMergeStatus } from "./pr-status-verifier";
import { parseCbResetCount } from "./workflow-orchestrator";
import { AgentEventType } from "../events/event-bus";
import { enqueueKanbanTaskSession } from "./workflow-orchestrator-singleton";

/** Minimum age (ms) before a done-lane card is considered for recovery. */
const PR_VERIFICATION_MIN_AGE_MS = 5 * 60 * 1000;
/** Age threshold for orphan IN_PROGRESS detection (no active session). */
const ORPHAN_AGE_MS = 10 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface DoneLaneRecoverySummary {
  examined: number;
  recovered: number;
  conflictResolved: number;
  stuckMarked: number;
  completed: number;
  errors: number;
}

type StuckPattern =
  | "cb_exhausted_pr_merged"
  | "cb_exhausted_pr_unmerged"
  | "webhook_missed"
  | "conflict_detected"
  | "orphan_in_progress"
  | "no_pr_completed";

interface DetectedStuck {
  pattern: StuckPattern;
  task: Task;
}

type RecoverySystem = Pick<RoutaSystem, "taskStore" | "kanbanBoardStore" | "workspaceStore" | "eventBus">;

// ── Helpers ────────────────────────────────────────────────────────────────

function isRealPR(task: Task): boolean {
  return Boolean(task.pullRequestUrl
    && task.pullRequestUrl !== "manual"
    && task.pullRequestUrl !== "already-merged");
}

function isDoneColumn(colId: string, board: KanbanBoard): boolean {
  const col = board.columns.find((c) => c.id === colId);
  return col?.stage === "done" || col?.stage === "archived" || colId === "done";
}

function getTaskAgeMs(task: Task): number {
  const updated = task.updatedAt instanceof Date
    ? task.updatedAt.getTime()
    : new Date(task.updatedAt as string | number).getTime();
  return Date.now() - updated;
}

function hasActiveSession(task: Task): boolean {
  return Boolean(task.triggerSessionId);
}

function getCbResetCount(task: Task): number {
  return parseCbResetCount(task.lastSyncError ?? "");
}

function getMaxResets(): number {
  return parseInt(process.env.ROUTA_CB_MAX_COOLDOWN_RESETS ?? "5", 10);
}

// ── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect stuck patterns for a task in the done lane.
 */
export function detectStuckPatterns(
  task: Task,
  board: KanbanBoard,
): DetectedStuck[] {
  const patterns: DetectedStuck[] = [];
  const colId = task.columnId ?? "";
  if (!isDoneColumn(colId, board)) return patterns;

  const ageMs = getTaskAgeMs(task);
  const cbExhausted = getCbResetCount(task) >= getMaxResets();
  const hasPR = isRealPR(task);
  const prMerged = Boolean(task.pullRequestMergedAt);

  // Pattern: circuit-breaker exhausted + PR actually merged on GitHub
  if (cbExhausted && hasPR && !prMerged) {
    patterns.push({ pattern: "cb_exhausted_pr_unmerged", task });
  }

  // Pattern: PR merged on GitHub but pullRequestMergedAt not set (webhook lost)
  // Also covers the most common case: COMPLETED + has PR + not merged + no error
  if (hasPR && !prMerged && !cbExhausted && ageMs > PR_VERIFICATION_MIN_AGE_MS) {
    patterns.push({ pattern: "webhook_missed", task });
  }

  // Pattern: COMPLETED + no PR + has worktree — may need PR creation
  if (task.status === "COMPLETED" && !hasPR && task.worktreeId && ageMs > ORPHAN_AGE_MS) {
    patterns.push({ pattern: "no_pr_completed", task });
  }

  // Pattern: orphan IN_PROGRESS in done with no active session
  if (task.status === "IN_PROGRESS" && !hasActiveSession(task) && ageMs > ORPHAN_AGE_MS) {
    patterns.push({ pattern: "orphan_in_progress", task });
  }

  // Pattern: COMPLETED with no PR and old enough — likely passed all steps
  if (task.status === "COMPLETED" && !hasPR && !task.worktreeId && ageMs > ORPHAN_AGE_MS) {
    patterns.push({ pattern: "no_pr_completed", task });
  }

  return patterns;
}

// ── Recovery actions ───────────────────────────────────────────────────────

async function recoverWebhookMissed(
  task: Task,
  system: RecoverySystem,
): Promise<boolean> {
  if (!task.pullRequestUrl) return false;

  const verification = await verifyPrMergeStatus(task.pullRequestUrl);

  // PR actually merged on GitHub — sync the state
  if (verification.verified && verification.merged) {
    console.log(
      `[DoneLaneRecovery] Webhook-lost merge detected for ${task.id}. ` +
      `Syncing pullRequestMergedAt.`,
    );

    task.pullRequestMergedAt = verification.mergedAt ? new Date(verification.mergedAt) : new Date();
    task.lastSyncError = undefined;
    task.updatedAt = new Date();
    await system.taskStore.save(task);

    system.eventBus.emit({
      type: AgentEventType.PR_MERGED,
      agentId: "kanban-done-lane-recovery",
      workspaceId: task.workspaceId,
      data: {
        pullRequestUrl: task.pullRequestUrl,
        mergedAt: task.pullRequestMergedAt.toISOString(),
      },
      timestamp: new Date(),
    });

    return true;
  }

  // PR not merged on GitHub — check for conflicts, then set diagnostic
  if (verification.verified) {
    if (verification.mergeable === false) {
      // Has conflicts — trigger conflict-resolver
      console.log(
        `[DoneLaneRecovery] Card ${task.id} PR has conflicts. Triggering conflict-resolver.`,
      );
      task.lastSyncError = `[done-lane-stuck] Merge conflicts detected. Conflict resolver triggered.`;
      task.triggerSessionId = undefined;
      task.updatedAt = new Date();
      await system.taskStore.save(task);
      await triggerConflictResolver(task, system);
    } else {
      // Open PR, no conflicts — needs human merge
      console.log(
        `[DoneLaneRecovery] Card ${task.id} PR open but not merged. Setting diagnostic.`,
      );
      task.lastSyncError = `[done-lane-stuck] PR open, awaiting merge: ${task.pullRequestUrl}`;
      task.updatedAt = new Date();
      await system.taskStore.save(task);
    }
  }

  return false;
}

async function recoverCbExhausted(
  task: Task,
  system: RecoverySystem,
): Promise<"merged" | "conflict" | "unmerged"> {
  if (!task.pullRequestUrl) return "unmerged";

  const verification = await verifyPrMergeStatus(task.pullRequestUrl);

  // If PR was actually merged on GitHub, sync the state
  if (verification.verified && verification.merged) {
    console.log(
      `[DoneLaneRecovery] CB-exhausted card ${task.id} PR actually merged on GitHub. Recovering.`,
    );
    task.pullRequestMergedAt = verification.mergedAt ? new Date(verification.mergedAt) : new Date();
    task.lastSyncError = undefined;
    task.updatedAt = new Date();
    await system.taskStore.save(task);

    system.eventBus.emit({
      type: AgentEventType.PR_MERGED,
      agentId: "kanban-done-lane-recovery",
      workspaceId: task.workspaceId,
      data: {
        pullRequestUrl: task.pullRequestUrl,
        mergedAt: task.pullRequestMergedAt.toISOString(),
      },
      timestamp: new Date(),
    });

    return "merged";
  }

  // Check if PR has conflicts — trigger conflict-resolver as independent phase
  if (verification.verified && verification.mergeable === false) {
    console.log(
      `[DoneLaneRecovery] CB-exhausted card ${task.id} has merge conflicts. ` +
      `Triggering conflict-resolver as independent phase.`,
    );
    task.lastSyncError = `[done-lane-stuck] Merge conflicts detected. Conflict resolver triggered.`;
    task.triggerSessionId = undefined;
    task.updatedAt = new Date();
    await system.taskStore.save(task);
    await triggerConflictResolver(task, system);
    return "conflict";
  }

  // PR is still open and unmerged — set diagnostic
  console.log(
    `[DoneLaneRecovery] CB-exhausted card ${task.id} PR still unmerged. ` +
    `Setting diagnostic.`,
  );
  task.lastSyncError = `[done-lane-stuck] PR not merged, retries exhausted. PR: ${task.pullRequestUrl}. Manual merge required.`;
  task.updatedAt = new Date();
  await system.taskStore.save(task);
  return "unmerged";
}

/**
 * Trigger conflict-resolver specialist as an independent automation step.
 * Shared by recoverWebhookMissed and recoverCbExhausted.
 */
async function triggerConflictResolver(
  task: Task,
  system: RecoverySystem,
): Promise<void> {
  try {
    const freshTask = await system.taskStore.get(task.id);
    if (freshTask) {
      const result = await enqueueKanbanTaskSession(system as RoutaSystem, {
        task: freshTask,
        ignoreExistingTrigger: true,
        bypassDependencyGate: true,
        step: {
          id: "conflict-resolver",
          role: "DEVELOPER",
          specialistId: "kanban-conflict-resolver",
          specialistName: "Conflict Resolver",
        },
        stepIndex: 0,
      });
      if (result.sessionId) {
        console.log(
          `[DoneLaneRecovery] Conflict-resolver session ${result.sessionId} started for card ${task.id}.`,
        );
      } else {
        console.warn(
          `[DoneLaneRecovery] Failed to start conflict-resolver for card ${task.id}: ${result.error}`,
        );
      }
    }
  } catch (err) {
    console.error(
      `[DoneLaneRecovery] Error triggering conflict-resolver for card ${task.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function recoverOrphanInProgress(
  task: Task,
  system: RecoverySystem,
): Promise<boolean> {
  console.log(
    `[DoneLaneRecovery] Orphan IN_PROGRESS in done lane: ${task.id}. Marking COMPLETED.`,
  );
  task.status = "COMPLETED" as typeof task.status;
  task.triggerSessionId = undefined;
  task.lastSyncError = undefined;
  task.updatedAt = new Date();
  await system.taskStore.save(task);
  return true;
}

// ── Main tick ──────────────────────────────────────────────────────────────

/**
 * Run a single done-lane recovery tick across all workspaces.
 *
 * Scans done columns for stuck tasks and applies recovery actions.
 */
export async function runDoneLaneRecoveryTick(
  system: RecoverySystem,
): Promise<DoneLaneRecoverySummary> {
  const summary: DoneLaneRecoverySummary = {
    examined: 0,
    recovered: 0,
    conflictResolved: 0,
    stuckMarked: 0,
    completed: 0,
    errors: 0,
  };

  try {
    const workspaces = await system.workspaceStore.list();

    for (const workspace of workspaces) {
      const boards = await system.kanbanBoardStore.listByWorkspace(workspace.id);
      const allTasks = await system.taskStore.listByWorkspace(workspace.id);

      for (const board of boards) {
        const doneColumns = board.columns.filter(
          (col) => col.stage === "done" || col.stage === "archived" || col.id === "done",
        );
        const doneColumnIds = new Set(doneColumns.map((c) => c.id));

        const doneTasks = allTasks.filter(
          (t) => t.columnId && doneColumnIds.has(t.columnId),
        );

        for (const task of doneTasks) {
          summary.examined++;
          const stuckItems = detectStuckPatterns(task, board);

          for (const stuck of stuckItems) {
            try {
              switch (stuck.pattern) {
                case "webhook_missed": {
                  const ok = await recoverWebhookMissed(task, system);
                  if (ok) summary.recovered++;
                  break;
                }
                case "cb_exhausted_pr_unmerged": {
                  const result = await recoverCbExhausted(task, system);
                  if (result === "merged") summary.recovered++;
                  else if (result === "conflict") summary.conflictResolved++;
                  else summary.stuckMarked++;
                  break;
                }
                case "conflict_detected": {
                  summary.conflictResolved++;
                  break;
                }
                case "orphan_in_progress": {
                  const ok = await recoverOrphanInProgress(task, system);
                  if (ok) summary.completed++;
                  break;
                }
                case "no_pr_completed": {
                  // Already COMPLETED — no action needed
                  break;
                }
              }
            } catch (err) {
              summary.errors++;
              console.error(
                `[DoneLaneRecovery] Error recovering task ${task.id} ` +
                `(pattern=${stuck.pattern}):`,
                err instanceof Error ? err.message : err,
              );
            }
          }
        }
      }
    }
  } catch (err) {
    summary.errors++;
    console.error(
      "[DoneLaneRecovery] Tick failed:",
      err instanceof Error ? err.message : err,
    );
  }

  console.log(
    `[DoneLaneRecovery] Tick complete: examined=${summary.examined}, ` +
    `recovered=${summary.recovered}, conflicts=${summary.conflictResolved}, ` +
    `stuck=${summary.stuckMarked}, completed=${summary.completed}, ` +
    `errors=${summary.errors}`,
  );

  return summary;
}
