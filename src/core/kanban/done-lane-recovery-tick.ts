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

  // Skip if conflict-resolver/auto-merger is already in progress (idempotency guard).
  // Allow re-detection if the pending marker is stale (> 30 min).
  if (task.lastSyncError?.startsWith("[conflict-resolver-pending]")
      || task.lastSyncError?.startsWith("[auto-merger-pending]")) {
    const match = task.lastSyncError.match(/Triggered at (.+?)[.\s]/);
    if (match) {
      const pendingAt = new Date(match[1]).getTime();
      if (Date.now() - pendingAt < 30 * 60 * 1000) {
        return patterns;
      }
    } else {
      return patterns;
    }
  }

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

  // Pattern: orphan IN_PROGRESS in done with no active session and NO real PR
  // (IN_PROGRESS + PR is handled by webhook_missed/cb_exhausted patterns above)
  if (task.status === "IN_PROGRESS" && !hasActiveSession(task) && !hasPR && ageMs > ORPHAN_AGE_MS) {
    patterns.push({ pattern: "orphan_in_progress", task });
  }

  // Pattern: COMPLETED with no PR and old enough — likely passed all steps
  if (task.status === "COMPLETED" && !hasPR && !task.worktreeId && ageMs > ORPHAN_AGE_MS) {
    patterns.push({ pattern: "no_pr_completed", task });
  }

  // Pattern: COMPLETED with [done-lane-stuck] diagnostic + real PR — needs conflict-resolver
  if (hasPR && !prMerged
      && task.status === "COMPLETED"
      && task.lastSyncError?.startsWith("[done-lane-stuck]")
      && ageMs > PR_VERIFICATION_MIN_AGE_MS) {
    patterns.push({ pattern: "conflict_detected", task });
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
    } else if (verification.mergeable === true) {
      // Open PR, mergeable — trigger independent auto-merger session
      console.log(
        `[DoneLaneRecovery] Card ${task.id} PR mergeable but not merged. Triggering auto-merger.`,
      );
      task.lastSyncError = `[auto-merger-pending] Triggered at ${new Date().toISOString()}. PR: ${task.pullRequestUrl}`;
      task.triggerSessionId = undefined;
      task.updatedAt = new Date();
      await system.taskStore.save(task);
      await triggerAutoMerger(task, system);
    } else {
      // mergeable=UNKNOWN or undefined — GitHub still calculating, set diagnostic
      console.log(
        `[DoneLaneRecovery] Card ${task.id} PR mergeability unknown. Setting diagnostic.`,
      );
      task.lastSyncError = `[done-lane-stuck] PR mergeability unknown, will retry: ${task.pullRequestUrl}`;
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

  // PR is still open — trigger auto-merger if mergeable
  if (verification.verified && verification.mergeable === true) {
    console.log(
      `[DoneLaneRecovery] CB-exhausted card ${task.id} PR mergeable. Triggering auto-merger.`,
    );
    task.lastSyncError = `[auto-merger-pending] Triggered at ${new Date().toISOString()}. PR: ${task.pullRequestUrl}`;
    task.triggerSessionId = undefined;
    task.updatedAt = new Date();
    await system.taskStore.save(task);
    await triggerAutoMerger(task, system);
    return "unmerged";
  }

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
 * Shared by recoverWebhookMissed, recoverCbExhausted, and conflict_detected handler.
 */
async function triggerConflictResolver(
  task: Task,
  system: RecoverySystem,
): Promise<void> {
  try {
    const freshTask = await system.taskStore.get(task.id);
    if (!freshTask) return;

    // Idempotency: skip if there's already an active trigger or conflict-resolver pending
    if (freshTask.triggerSessionId) {
      console.log(
        `[DoneLaneRecovery] Skipping conflict-resolver for card ${task.id}: ` +
        `already has active session ${freshTask.triggerSessionId}.`,
      );
      return;
    }
    if (freshTask.lastSyncError?.startsWith("[conflict-resolver-pending]")) {
      // Check if the pending marker is stale (> 30 min)
      const match = freshTask.lastSyncError.match(/Triggered at (.+)\./);
      if (match) {
        const pendingAt = new Date(match[1]).getTime();
        if (Date.now() - pendingAt < 30 * 60 * 1000) {
          console.log(
            `[DoneLaneRecovery] Skipping conflict-resolver for card ${task.id}: already pending.`,
          );
          return;
        }
        console.log(
          `[DoneLaneRecovery] Stale conflict-resolver-pending marker for card ${task.id}. Re-triggering.`,
        );
      }
    }

    // Set pending marker before triggering to prevent duplicates
    freshTask.lastSyncError = `[conflict-resolver-pending] Triggered at ${new Date().toISOString()}. PR: ${freshTask.pullRequestUrl}`;
    freshTask.updatedAt = new Date();
    await system.taskStore.save(freshTask);

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
  } catch (err) {
    console.error(
      `[DoneLaneRecovery] Error triggering conflict-resolver for card ${task.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Trigger auto-merger specialist as an independent automation step.
 * Used when recovery tick detects a mergeable but unmerged PR.
 */
async function triggerAutoMerger(
  task: Task,
  system: RecoverySystem,
): Promise<void> {
  try {
    const freshTask = await system.taskStore.get(task.id);
    if (!freshTask) return;

    // Idempotency: skip if there's already an active trigger
    if (freshTask.triggerSessionId) {
      console.log(
        `[DoneLaneRecovery] Skipping auto-merger for card ${task.id}: ` +
        `already has active session ${freshTask.triggerSessionId}.`,
      );
      return;
    }
    if (freshTask.lastSyncError?.startsWith("[auto-merger-pending]")) {
      const match = freshTask.lastSyncError.match(/Triggered at (.+)\./);
      if (match) {
        const pendingAt = new Date(match[1]).getTime();
        if (Date.now() - pendingAt < 30 * 60 * 1000) {
          console.log(
            `[DoneLaneRecovery] Skipping auto-merger for card ${task.id}: already pending.`,
          );
          return;
        }
        console.log(
          `[DoneLaneRecovery] Stale auto-merger-pending marker for card ${task.id}. Re-triggering.`,
        );
      }
    }

    // Set pending marker before triggering
    freshTask.lastSyncError = `[auto-merger-pending] Triggered at ${new Date().toISOString()}. PR: ${freshTask.pullRequestUrl}`;
    freshTask.updatedAt = new Date();
    await system.taskStore.save(freshTask);

    const result = await enqueueKanbanTaskSession(system as RoutaSystem, {
      task: freshTask,
      ignoreExistingTrigger: true,
      bypassDependencyGate: true,
      step: {
        id: "auto-merger",
        role: "DEVELOPER",
        specialistId: "kanban-auto-merger",
        specialistName: "Auto Merger",
      },
      stepIndex: 0,
    });
    if (result.sessionId) {
      console.log(
        `[DoneLaneRecovery] Auto-merger session ${result.sessionId} started for card ${task.id}.`,
      );
    } else {
      console.warn(
        `[DoneLaneRecovery] Failed to start auto-merger for card ${task.id}: ${result.error}`,
      );
    }
  } catch (err) {
    console.error(
      `[DoneLaneRecovery] Error triggering auto-merger for card ${task.id}:`,
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

// ── Merge queue ordering ─────────────────────────────────────────────────────

/**
 * Sort stuck items for the merge queue.
 *
 * Priority:
 * 1. conflict-detected items (conflict-resolver can run in parallel)
 * 2. auto-merge candidates ordered by dependency readiness:
 *    - Tasks whose dependencies are all merged → higher priority
 *    - Tasks with no dependencies → ordered by updatedAt (FIFO)
 * 3. Non-merge items (orphan, no_pr) — order doesn't matter
 */
function sortMergeCandidates(items: DetectedStuck[], taskMap: Map<string, Task>): DetectedStuck[] {
  return items.sort((a, b) => {
    // conflict-detected items first (conflict-resolver runs in parallel, no merge)
    const aIsConflict = a.pattern === "conflict_detected" ? 0 : 1;
    const bIsConflict = b.pattern === "conflict_detected" ? 0 : 1;
    if (aIsConflict !== bIsConflict) return aIsConflict - bIsConflict;

    // For merge-related patterns, sort by dependency readiness
    const aTask = a.task;
    const bTask = b.task;
    const aDepsReady = areDepsMerged(aTask, taskMap);
    const bDepsReady = areDepsMerged(bTask, taskMap);
    if (aDepsReady !== bDepsReady) return aDepsReady ? -1 : 1;

    // Same readiness → FIFO by updatedAt
    const aTime = aTask.updatedAt instanceof Date ? aTask.updatedAt.getTime() : new Date(aTask.updatedAt as string | number).getTime();
    const bTime = bTask.updatedAt instanceof Date ? bTask.updatedAt.getTime() : new Date(bTask.updatedAt as string | number).getTime();
    return aTime - bTime;
  });
}

/**
 * Check if all of a task's dependencies are merged (or it has no dependencies).
 * Tasks without dependencies are always "ready".
 */
function areDepsMerged(task: Task, taskMap: Map<string, Task>): boolean {
  if (!task.dependencies || task.dependencies.length === 0) return true;
  for (const depId of task.dependencies) {
    const dep = taskMap.get(depId);
    if (!dep) continue;
    if (!dep.pullRequestMergedAt) return false;
  }
  return true;
}

// ── Main tick ──────────────────────────────────────────────────────────────

/**
 * Run a single done-lane recovery tick across all workspaces.
 *
 * Scans done columns for stuck tasks and applies recovery actions.
 * Auto-merger triggers are limited to ONE per tick to prevent cascading
 * conflicts when multiple PRs target the same base branch.
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

      // Build task lookup map for dependency resolution
      const taskMap = new Map<string, Task>();
      for (const t of allTasks) taskMap.set(t.id, t);

      for (const board of boards) {
        const doneColumns = board.columns.filter(
          (col) => col.stage === "done" || col.stage === "archived" || col.id === "done",
        );
        const doneColumnIds = new Set(doneColumns.map((c) => c.id));

        const doneTasks = allTasks.filter(
          (t) => t.columnId && doneColumnIds.has(t.columnId),
        );

        // Collect all stuck items across done tasks
        const allStuckItems: DetectedStuck[] = [];
        for (const task of doneTasks) {
          summary.examined++;
          const stuckItems = detectStuckPatterns(task, board);
          allStuckItems.push(...stuckItems);
        }

        // Sort: conflict-resolvers first, then merge candidates by dependency readiness
        const sorted = sortMergeCandidates(allStuckItems, taskMap);

        let autoMergerTriggered = false;

        for (const stuck of sorted) {
          try {
            switch (stuck.pattern) {
              case "webhook_missed": {
                if (autoMergerTriggered) {
                  // Only one auto-merger per tick to prevent cascading conflicts
                  console.log(
                    `[DoneLaneRecovery] Deferring auto-merger for card ${stuck.task.id}: ` +
                    `already triggered one this tick.`,
                  );
                  break;
                }
                const ok = await recoverWebhookMissed(stuck.task, system);
                if (ok) {
                  summary.recovered++;
                  autoMergerTriggered = true;
                }
                break;
              }
              case "cb_exhausted_pr_unmerged": {
                if (autoMergerTriggered) {
                  console.log(
                    `[DoneLaneRecovery] Deferring CB-exhausted merge for card ${stuck.task.id}: ` +
                    `already triggered one this tick.`,
                  );
                  summary.stuckMarked++;
                  break;
                }
                const result = await recoverCbExhausted(stuck.task, system);
                if (result === "merged") {
                  summary.recovered++;
                  autoMergerTriggered = true;
                } else if (result === "conflict") {
                  summary.conflictResolved++;
                } else {
                  summary.stuckMarked++;
                }
                break;
              }
              case "conflict_detected": {
                // Conflict-resolvers can run in parallel — no serial limit
                await triggerConflictResolver(stuck.task, system);
                summary.conflictResolved++;
                break;
              }
              case "orphan_in_progress": {
                const ok = await recoverOrphanInProgress(stuck.task, system);
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
              `[DoneLaneRecovery] Error recovering task ${stuck.task.id} ` +
              `(pattern=${stuck.pattern}):`,
              err instanceof Error ? err.message : err,
            );
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

/**
 * Cleanup orphan pending markers on server startup.
 *
 * When the server restarts during an active auto-merger or conflict-resolver
 * session, the session is lost but the [auto-merger-pending] /
 * [conflict-resolver-pending] marker remains in lastSyncError. The recovery
 * tick's idempotency guard would skip these cards for 30 minutes.
 *
 * This function clears markers that have no active triggerSessionId,
 * allowing the next recovery tick to immediately re-detect and re-trigger.
 */
export async function cleanupOrphanPendingMarkers(
  system: RecoverySystem,
): Promise<number> {
  let cleaned = 0;
  try {
    const workspaces = await system.workspaceStore.list();
    for (const ws of workspaces) {
      const tasks = await system.taskStore.listByWorkspace(ws.id);
      for (const task of tasks) {
        const err = task.lastSyncError ?? "";
        if (!err.startsWith("[auto-merger-pending]")
            && !err.startsWith("[conflict-resolver-pending]")) {
          continue;
        }
        if (task.triggerSessionId) continue;

        console.log(
          `[DoneLaneRecovery] Cleaning orphan marker for card ${task.id}: ${err.slice(0, 40)}...`,
        );
        task.lastSyncError = undefined;
        task.updatedAt = new Date();
        await system.taskStore.save(task);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(
        `[DoneLaneRecovery] Startup cleanup: cleared ${cleaned} orphan pending marker(s).`,
      );
    }
  } catch (err) {
    console.error(
      "[DoneLaneRecovery] Startup cleanup failed:",
      err instanceof Error ? err.message : err,
    );
  }
  return cleaned;
}
