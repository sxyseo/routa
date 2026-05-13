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
import { TaskStatus } from "../models/task";
import type { KanbanBoard } from "../models/kanban";
import { resolveTaskStatusForBoardColumn } from "../models/kanban";
import { shouldSkipTickForMemory } from "./memory-guard";
import { verifyPrMergeStatus } from "./pr-status-verifier";
import { parseCbResetCount } from "./workflow-orchestrator";
import { AgentEventType } from "../events/event-bus";
import { enqueueKanbanTaskSession } from "./workflow-orchestrator-singleton";
import { clearStuckMarker, buildDoneStuckError, parseDoneStuckRetryCount } from "./sync-error-writer";
import { getKanbanConfig } from "./kanban-config";
import { getHttpSessionStore } from "../acp/http-session-store";
import { markTaskLaneSessionStatus } from "./task-lane-history";
import { executeAutoPrCreation } from "./pr-auto-create";
import { safeAtomicSave } from "./atomic-task-update";

const recoveryCfg = getKanbanConfig();

const RECOVERY_SPECIALIST_IDS = [
  "kanban-auto-merger",
  "kanban-conflict-resolver",
  "kanban-rebase-resolver",
] as const;

/** Minimum age (ms) before a done-lane card is considered for recovery. */
const PR_VERIFICATION_MIN_AGE_MS = recoveryCfg.prVerificationMinAgeMs;
/** Age threshold for orphan IN_PROGRESS detection (no active session). */
const ORPHAN_AGE_MS = recoveryCfg.orphanAgeMs;

// ── Types ──────────────────────────────────────────────────────────────────

export interface DoneLaneRecoverySummary {
  examined: number;
  recovered: number;
  conflictResolved: number;
  stuckMarked: number;
  completed: number;
  /** Number of tasks whose permanent automation-limit markers were cleared. */
  limitSwept: number;
  /** Number of specialist sessions resolved (completed/failed) by this tick. */
  specialistResolved: number;
  errors: number;
}

type StuckPattern =
  | "cb_exhausted_pr_merged"
  | "cb_exhausted_pr_unmerged"
  | "webhook_missed"
  | "conflict_detected"
  | "pr_closed_unmerged"
  | "orphan_in_progress"
  | "no_pr_completed"
  | "review_degraded"
  | "automation_limit_exhausted";

interface DetectedStuck {
  pattern: StuckPattern;
  task: Task;
}

type RecoverySystem = Pick<RoutaSystem, "taskStore" | "kanbanBoardStore" | "workspaceStore" | "eventBus" | "worktreeStore" | "codebaseStore">;

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
  return recoveryCfg.cbMaxCooldownResets;
}

// ── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect stuck patterns for a task in the done lane.
 */
export async function detectStuckPatterns(
  task: Task,
  board: KanbanBoard,
): Promise<DetectedStuck[]> {
  const patterns: DetectedStuck[] = [];
  const colId = task.columnId ?? "";
  const ageMs = getTaskAgeMs(task);

  // Blocked column: if PR is merged, treat as recoverable (auto-pass to unblock)
  const col = board.columns.find((c) => c.id === colId);
  if (col?.stage === "blocked" && isRealPR(task) && task.pullRequestMergedAt && ageMs > ORPHAN_AGE_MS) {
    patterns.push({ pattern: "review_degraded", task });
    return patterns;
  }

  if (!isDoneColumn(colId, board)) return patterns;

  const cbExhausted = getCbResetCount(task) >= getMaxResets();
  const hasPR = isRealPR(task);
  const prMerged = Boolean(task.pullRequestMergedAt);

  // Skip if conflict-resolver/auto-merger/rebase-resolver is already in progress (idempotency guard).
  // Allow re-detection if the pending marker is stale (> 30 min).
  if (task.lastSyncError?.startsWith("[conflict-resolver-pending]")
      || task.lastSyncError?.startsWith("[auto-merger-pending]")
      || task.lastSyncError?.startsWith("[rebase-resolver-pending]")) {
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

  // Skip if the most recent lane session is a recovery specialist still active
  // in HttpSessionStore. Prevents re-detection while the specialist is in-flight.
  // However, if the session has exceeded the auto-merger timeout, treat it as
  // stuck and proceed with recovery (fixes auto-merger deadlock self-lockout).
  const sessions = task.laneSessions ?? [];
  const recentSession = sessions[sessions.length - 1];
  if (recentSession?.status === "running" && recentSession.specialistId
      && (RECOVERY_SPECIALIST_IDS as readonly string[]).includes(recentSession.specialistId)
      && recentSession.sessionId) {
    const activity = getHttpSessionStore().getSessionActivity(recentSession.sessionId);
    if (activity && !activity.terminalState) {
      const sessionAge = Date.now() - new Date(recentSession.startedAt).getTime();
      const mergerTimeout = recoveryCfg.autoMergerTimeoutMs;
      if (sessionAge < mergerTimeout) {
        // Before skipping, check if PR is already merged on GitHub.
        // Prevents self-lockout when PR was manually merged while auto-merger is "running".
        if (isRealPR(task) && !task.pullRequestMergedAt) {
          try {
            const prCheck = await verifyPrMergeStatus(task.pullRequestUrl!);
            if (prCheck.verified && prCheck.merged) {
              console.log(
                `[DoneLaneRecovery] Card ${task.id} PR already merged on GitHub ` +
                `while specialist session ${recentSession.sessionId} is still active. ` +
                `Overriding skip to proceed with recovery.`,
              );
              // Fall through to pattern detection
            } else {
              return patterns; // PR not merged or check failed -- session still useful
            }
          } catch {
            return patterns; // Safety fallback
          }
        } else {
          return patterns; // No real PR or already merged -- skip
        }
      }
      // Session exceeded timeout but still shows as active — treat as stuck.
      console.warn(
        `[DoneLaneRecovery] Specialist session ${recentSession.sessionId} for card ${task.id} ` +
        `exceeded timeout (${Math.round(sessionAge / 60000)}min > ${Math.round(mergerTimeout / 60000)}min). Proceeding with recovery.`,
      );
    }
  }

  // Pattern: circuit-breaker exhausted + PR actually merged on GitHub
  if (cbExhausted && hasPR && !prMerged) {
    patterns.push({ pattern: "cb_exhausted_pr_unmerged", task });
  }

  // Pattern: PR merged on GitHub but pullRequestMergedAt not set (webhook lost)
  // Also covers the most common case: has PR + not merged + no error
  // Skip COMPLETED tasks in done column — they've already passed all automation steps.
  // Rebase-resolver on a completed task is wasteful (code may already be merged via
  // child tasks or a replacement PR). The rebase-resolver "succeeds" (LLM exits 0),
  // clearing lastSyncError, which removes the dedup marker and causes this check
  // to re-fire every tick — an infinite loop.
  if (hasPR && !prMerged && !cbExhausted && ageMs > PR_VERIFICATION_MIN_AGE_MS
      && task.status !== "COMPLETED") {
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

  // Pattern: COMPLETED with [done-lane-stuck] diagnostic + real PR — route by cause
  if (hasPR && !prMerged
      && task.status === "COMPLETED"
      && task.lastSyncError?.startsWith("[done-lane-stuck]")
      && ageMs > PR_VERIFICATION_MIN_AGE_MS) {
    if (task.lastSyncError.includes("closed") || task.lastSyncError.includes("Closed")) {
      // PR was closed without merging → rebase-resolver
      patterns.push({ pattern: "pr_closed_unmerged", task });
    } else if (task.lastSyncError.includes("conflict") || task.lastSyncError.includes("Conflict")) {
      // Actual merge conflict → conflict-resolver specialist
      patterns.push({ pattern: "conflict_detected", task });
    } else if (parseDoneStuckRetryCount(task.lastSyncError) >= 3) {
      // UNKNOWN retried 3 times → stop auto-retry, leave for manual intervention
    } else {
      // "mergeability unknown" or other transient state → re-verify via webhook_missed
      patterns.push({ pattern: "webhook_missed", task });
    }
  }

  // Pattern: review-degraded — stale retry exhausted, auto-pass with warning
  if (task.lastSyncError?.startsWith("[review-degraded]") && ageMs > ORPHAN_AGE_MS) {
    patterns.push({ pattern: "review_degraded", task });
  }

  // Pattern: automation limit exhausted (repeat-limit, step-resume-limit, or advance-recovery)
  // These permanently block the task. After a cooldown window, clear the marker
  // so the LaneScanner can re-trigger automation with a fresh attempt cycle.
  if (task.lastSyncError
      && (task.lastSyncError.includes("Stopped Kanban automation")
          || task.lastSyncError.includes("Max retries")
          || task.lastSyncError.includes("[advance-recovery]"))
      && ageMs > ORPHAN_AGE_MS) {
    patterns.push({ pattern: "automation_limit_exhausted", task });
  }

  return patterns;
}

// ── Recovery actions ───────────────────────────────────────────────────────

type WebhookRecoveryResult = "merged" | "auto_merger" | "conflict" | "unknown" | "no_action";

async function recoverWebhookMissed(
  task: Task,
  system: RecoverySystem,
): Promise<WebhookRecoveryResult> {
  if (!task.pullRequestUrl) return "no_action";

  const verification = await verifyPrMergeStatus(task.pullRequestUrl);

  // PR actually merged on GitHub — sync the state
  if (verification.verified && verification.merged) {
    console.log(
      `[DoneLaneRecovery] Webhook-lost merge detected for ${task.id}. ` +
      `Syncing pullRequestMergedAt.`,
    );

    const mergedAt = verification.mergedAt ? new Date(verification.mergedAt) : new Date();
    await safeAtomicSave(task, system.taskStore, {
      pullRequestMergedAt: mergedAt,
      lastSyncError: null,
      updatedAt: new Date(),
    }, "DoneLaneRecovery webhook-merged");

    system.eventBus.emit({
      type: AgentEventType.PR_MERGED,
      agentId: "kanban-done-lane-recovery",
      workspaceId: task.workspaceId,
      data: {
        pullRequestUrl: task.pullRequestUrl,
        mergedAt: mergedAt.toISOString(),
      },
      timestamp: new Date(),
    });

    return "merged";
  }

  // PR not merged on GitHub — route by state
  if (verification.verified) {
    // PR CLOSED without merging — base branch likely deleted.
    // Trigger rebase-resolver to rebase onto workspace baseBranch and open a new PR.
    if (verification.state === "closed" && !verification.merged) {
      console.log(
        `[DoneLaneRecovery] Card ${task.id} PR closed without merging. ` +
        `Triggering rebase-resolver to rebase onto base branch.`,
      );
      task.lastSyncError = `[rebase-resolver-pending] Triggered at ${new Date().toISOString()}. Closed PR: ${task.pullRequestUrl}`;
      await safeAtomicSave(task, system.taskStore, {
        lastSyncError: task.lastSyncError,
        triggerSessionId: null,
        updatedAt: new Date(),
      }, "DoneLaneRecovery rebase-resolver-pending");
      await triggerRebaseResolver(task, system);
      return "conflict";
    }

    if (verification.mergeable === false) {
      // Has conflicts — trigger conflict-resolver
      console.log(
        `[DoneLaneRecovery] Card ${task.id} PR has conflicts. Triggering conflict-resolver.`,
      );
      task.lastSyncError = `[done-lane-stuck] Merge conflicts detected. Conflict resolver triggered.`;
      await safeAtomicSave(task, system.taskStore, {
        lastSyncError: task.lastSyncError,
        triggerSessionId: null,
        updatedAt: new Date(),
      }, "DoneLaneRecovery conflict-detected");
      await triggerConflictResolver(task, system);
      return "conflict";
    } else if (verification.mergeable === true) {
      // Open PR, mergeable — trigger independent auto-merger session
      console.log(
        `[DoneLaneRecovery] Card ${task.id} PR mergeable but not merged. Triggering auto-merger.`,
      );
      task.lastSyncError = `[auto-merger-pending] Triggered at ${new Date().toISOString()}. PR: ${task.pullRequestUrl}`;
      await safeAtomicSave(task, system.taskStore, {
        lastSyncError: task.lastSyncError,
        triggerSessionId: null,
        updatedAt: new Date(),
      }, "DoneLaneRecovery auto-merger-pending");
      await triggerAutoMerger(task, system);
      return "auto_merger";
    } else {
      // mergeable=UNKNOWN or undefined — GitHub still calculating, set diagnostic with retry counter
      const prevRetries = parseDoneStuckRetryCount(task.lastSyncError ?? "");
      const nextRetry = prevRetries + 1;
      console.log(
        `[DoneLaneRecovery] Card ${task.id} PR mergeability unknown (retry #${nextRetry}). Setting diagnostic.`,
      );
      if (nextRetry <= 3) {
        task.lastSyncError = `[done-lane-stuck] PR mergeability unknown, retry #${nextRetry}: ${task.pullRequestUrl}`;
      } else {
        task.lastSyncError = `[done-lane-stuck] PR mergeability unknown after 3 retries. Manual check required: ${task.pullRequestUrl}`;
      }
      await safeAtomicSave(task, system.taskStore, {
        lastSyncError: task.lastSyncError,
        updatedAt: new Date(),
      }, "DoneLaneRecovery mergeability-unknown");
      return "unknown";
    }
  }

  return "no_action";
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
    const mergedAt = verification.mergedAt ? new Date(verification.mergedAt) : new Date();
    await safeAtomicSave(task, system.taskStore, {
      pullRequestMergedAt: mergedAt,
      lastSyncError: null,
      updatedAt: new Date(),
    }, "DoneLaneRecovery cb-exhausted-merged");

    system.eventBus.emit({
      type: AgentEventType.PR_MERGED,
      agentId: "kanban-done-lane-recovery",
      workspaceId: task.workspaceId,
      data: {
        pullRequestUrl: task.pullRequestUrl,
        mergedAt: mergedAt.toISOString(),
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
    await safeAtomicSave(task, system.taskStore, {
      lastSyncError: `[done-lane-stuck] Merge conflicts detected. Conflict resolver triggered.`,
      triggerSessionId: null,
      updatedAt: new Date(),
    }, "DoneLaneRecovery cb-exhausted-conflict");
    await triggerConflictResolver(task, system);
    return "conflict";
  }

  // PR is still open — trigger auto-merger if mergeable
  if (verification.verified && verification.mergeable === true) {
    console.log(
      `[DoneLaneRecovery] CB-exhausted card ${task.id} PR mergeable. Triggering auto-merger.`,
    );
    await safeAtomicSave(task, system.taskStore, {
      lastSyncError: `[auto-merger-pending] Triggered at ${new Date().toISOString()}. PR: ${task.pullRequestUrl}`,
      triggerSessionId: null,
      updatedAt: new Date(),
    }, "DoneLaneRecovery cb-exhausted-auto-merger");
    await triggerAutoMerger(task, system);
    return "unmerged";
  }

  console.log(
    `[DoneLaneRecovery] CB-exhausted card ${task.id} PR still unmerged. ` +
    `Setting diagnostic.`,
  );
  await safeAtomicSave(task, system.taskStore, {
    lastSyncError: `[done-lane-stuck] PR not merged, retries exhausted. PR: ${task.pullRequestUrl}. Manual merge required.`,
    updatedAt: new Date(),
  }, "DoneLaneRecovery cb-exhausted-stuck");
  return "unmerged";
}

/**
 * Close + Recreate: close a stuck PR, delete the branch, and move the card
 * from done back to dev so it gets re-developed from the latest main.
 * Returns true if the card was successfully moved back to dev.
 */
async function attemptPrRecreate(task: Task, system: RecoverySystem): Promise<boolean> {
  if (!task.pullRequestUrl || task.pullRequestUrl === "manual" || task.pullRequestUrl === "already-merged") {
    return false;
  }

  try {
    // 1. Close the PR
    const { closePullRequest } = await import("./pr-status-verifier");
    const closeResult = await closePullRequest(task.pullRequestUrl);
    if (!closeResult.closed) {
      console.warn(`[DoneLaneRecovery] Failed to close PR for card ${task.id}.`);
      return false;
    }
    console.log(`[DoneLaneRecovery] Closed PR for card ${task.id}.`);

    // 2. Delete remote branch
    if (closeResult.branchName) {
      const { deleteRemoteBranch } = await import("./pr-merge-listener");
      await deleteRemoteBranch(task.pullRequestUrl, closeResult.branchName);
    }

    // 3. Schedule worktree cleanup via event bus (avoids direct GitWorktreeService dependency)
    if (task.worktreeId) {
      system.eventBus.emit({
        type: AgentEventType.WORKTREE_CLEANUP,
        agentId: "done-lane-recovery",
        workspaceId: task.workspaceId,
        data: {
          worktreeId: task.worktreeId,
          taskId: task.id,
          boardId: task.boardId,
          deleteBranch: false,
        },
        timestamp: new Date(),
      });
    }

    // 4. Find dev column on the board
    const board = task.boardId ? await system.kanbanBoardStore.get(task.boardId) : undefined;
    const devColumn = board?.columns.find(c => c.stage === "dev");
    if (!devColumn) {
      console.warn(`[DoneLaneRecovery] No dev column found for card ${task.id}. Cannot recreate.`);
      return false;
    }

    // 5. Resolve correct status for dev column
    const devStatus = resolveTaskStatusForBoardColumn(board!.columns, devColumn.id);

    // 6. Full reset — clear all automation state and move back to dev
    const cleared = clearStuckMarker(task, "full");
    const previousColumnId = task.columnId;

    await safeAtomicSave(task, system.taskStore, {
      columnId: devColumn.id,
      status: devStatus,
      worktreeId: null,
      pullRequestUrl: null,
      pullRequestMergedAt: null,
      triggerSessionId: null,
      lastSyncError: null,
      laneSessions: cleared.laneSessions,
      updatedAt: new Date(),
    }, "DoneLaneRecovery pr-recreate");

    // 7. Emit COLUMN_TRANSITION to trigger dev automation
    system.eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "done-lane-recovery",
      workspaceId: task.workspaceId,
      data: {
        cardId: task.id,
        cardTitle: task.title,
        boardId: task.boardId ?? "",
        workspaceId: task.workspaceId,
        fromColumnId: previousColumnId ?? "",
        toColumnId: devColumn.id,
        fromColumnName: "",
        toColumnName: devColumn.name,
        source: { type: "pr_recreate" as const },
      },
      timestamp: new Date(),
    });

    console.log(
      `[DoneLaneRecovery] PR recreate for card ${task.id}: moved from ${previousColumnId} → ${devColumn.id}. ` +
      `Dev session will start from latest main.`,
    );
    return true;
  } catch (err) {
    console.error(`[DoneLaneRecovery] PR recreate failed for card ${task.id}:`, err);
    return false;
  }
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
    await safeAtomicSave(freshTask, system.taskStore, {
      lastSyncError: `[conflict-resolver-pending] Triggered at ${new Date().toISOString()}. PR: ${freshTask.pullRequestUrl}`,
      updatedAt: new Date(),
    }, "DoneLaneRecovery conflict-resolver-pending");

    const result = await enqueueKanbanTaskSession(system as RoutaSystem, {
      task: freshTask,
      ignoreExistingTrigger: true,
      bypassDependencyGate: true,
      bypassQueue: true,
      step: {
        id: "conflict-resolver",
        role: "DEVELOPER",
        specialistId: "kanban-conflict-resolver",
        specialistName: "Conflict Resolver",
      },
      stepIndex: 0,
    });
    console.log(
      `[DoneLaneRecovery] enqueueKanbanTaskSession result for card ${task.id}: ` +
      `sessionId=${result.sessionId}, queued=${result.queued}, error=${result.error}`,
    );
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
      const match = freshTask.lastSyncError.match(/Triggered at (\d{4}-\d{2}-\d{2}T[^\s.]+)/);
      if (match) {
        const pendingAt = new Date(match[1]).getTime();
        if (!isNaN(pendingAt) && Date.now() - pendingAt < 30 * 60 * 1000) {
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

    // Cooldown: skip if previously failed within cooldown window
    if (freshTask.lastSyncError?.startsWith("[auto-merger-failed]")) {
      const match = freshTask.lastSyncError.match(/at (\d{4}-\d{2}-\d{2}T[^\s.]+)/);
      if (match) {
        const failedAt = new Date(match[1]).getTime();
        if (!isNaN(failedAt) && Date.now() - failedAt < 10 * 60 * 1000) {
          console.log(
            `[DoneLaneRecovery] Skipping auto-merger for card ${task.id}: recently failed, in cooldown.`,
          );
          return;
        }
      }
    }

    // Merge directly via GitHub REST API (no LLM session needed)
    const { mergePullRequest } = await import("../github/github-merge");
    const token = process.env.GH_TOKEN;
    if (!token) {
      console.warn(
        `[DoneLaneRecovery] Cannot auto-merge for card ${task.id}: GH_TOKEN not set.`,
      );
      await safeAtomicSave(freshTask, system.taskStore, {
        lastSyncError: `[auto-merger-failed] GH_TOKEN not configured at ${new Date().toISOString()}.`,
        updatedAt: new Date(),
      }, "DoneLaneRecovery auto-merger-no-token");
      return;
    }

    console.log(
      `[DoneLaneRecovery] Auto-merging PR for card ${task.id} via GitHub API: ${freshTask.pullRequestUrl}`,
    );

    const mergeResult = await mergePullRequest({
      prUrl: freshTask.pullRequestUrl!,
      token,
      mergeMethod: "merge",
    });

    if (mergeResult.ok) {
      // Merge succeeded — sync state immediately
      const mergedAt = new Date();
      await safeAtomicSave(freshTask, system.taskStore, {
        pullRequestMergedAt: mergedAt,
        lastSyncError: null,
        triggerSessionId: null,
        updatedAt: new Date(),
      }, "DoneLaneRecovery auto-merger-success");

      console.log(
        `[DoneLaneRecovery] Auto-merged PR for card ${task.id} via GitHub API (sha: ${mergeResult.sha}).`,
      );

      // Emit PR_MERGED so downstream dependencies unblock immediately
      system.eventBus.emit({
        type: AgentEventType.PR_MERGED,
        agentId: "kanban-done-lane-recovery",
        workspaceId: freshTask.workspaceId,
        data: {
          pullRequestUrl: freshTask.pullRequestUrl,
          mergedAt: mergedAt.toISOString(),
        },
        timestamp: new Date(),
      });
    } else {
      // Merge failed — mark with reason for recovery routing
      const reason = mergeResult.status === 405
        ? "not_mergeable"
        : mergeResult.status === 409
          ? "conflict"
          : "unknown";

      console.warn(
        `[DoneLaneRecovery] Auto-merge failed for card ${task.id} (${reason}): ${mergeResult.message}`,
      );

      if (reason === "conflict") {
        await safeAtomicSave(freshTask, system.taskStore, {
          lastSyncError: `[done-lane-stuck] Merge conflicts detected via API. Conflict resolver triggered.`,
          updatedAt: new Date(),
        }, "DoneLaneRecovery auto-merger-conflict");
        await triggerConflictResolver(freshTask, system);
      } else {
        await safeAtomicSave(freshTask, system.taskStore, {
          lastSyncError: `[auto-merger-failed] ${reason}: ${mergeResult.message} at ${new Date().toISOString()}.`,
          updatedAt: new Date(),
        }, "DoneLaneRecovery auto-merger-failed");
      }
    }
  } catch (err) {
    console.error(
      `[DoneLaneRecovery] Error triggering auto-merger for card ${task.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Trigger rebase-resolver specialist when a PR was closed without merging.
 * The specialist rebases the branch onto the workspace baseBranch and creates a new PR.
 */
async function triggerRebaseResolver(
  task: Task,
  system: RecoverySystem,
): Promise<void> {
  try {
    const freshTask = await system.taskStore.get(task.id);
    if (!freshTask) return;

    // Idempotency: skip if already has active session or pending marker
    if (freshTask.triggerSessionId) {
      console.log(
        `[DoneLaneRecovery] Skipping rebase-resolver for card ${task.id}: ` +
        `already has active session ${freshTask.triggerSessionId}.`,
      );
      return;
    }
    if (freshTask.lastSyncError?.startsWith("[rebase-resolver-pending]")) {
      const match = freshTask.lastSyncError.match(/Triggered at (.+?)[.\s]/);
      if (match) {
        const pendingAt = new Date(match[1]).getTime();
        if (Date.now() - pendingAt < 30 * 60 * 1000) {
          console.log(
            `[DoneLaneRecovery] Skipping rebase-resolver for card ${task.id}: already pending.`,
          );
          return;
        }
      }
    }

    // Set pending marker before triggering
    await safeAtomicSave(freshTask, system.taskStore, {
      lastSyncError: `[rebase-resolver-pending] Triggered at ${new Date().toISOString()}. Closed PR: ${freshTask.pullRequestUrl}`,
      updatedAt: new Date(),
    }, "DoneLaneRecovery rebase-resolver-pending");

    const result = await enqueueKanbanTaskSession(system as RoutaSystem, {
      task: freshTask,
      ignoreExistingTrigger: true,
      bypassDependencyGate: true,
      step: {
        id: "rebase-resolver",
        role: "DEVELOPER",
        specialistId: "kanban-rebase-resolver",
        specialistName: "Rebase Resolver",
      },
      stepIndex: 0,
    });
    if (result.sessionId) {
      console.log(
        `[DoneLaneRecovery] Rebase-resolver session ${result.sessionId} started for card ${task.id}.`,
      );
    } else {
      console.warn(
        `[DoneLaneRecovery] Failed to start rebase-resolver for card ${task.id}: ${result.error}`,
      );
    }
  } catch (err) {
    console.error(
      `[DoneLaneRecovery] Error triggering rebase-resolver for card ${task.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function recoverOrphanInProgress(
  task: Task,
  system: RecoverySystem,
): Promise<boolean> {
  // Re-read to avoid stale reference before updating
  const fresh = await system.taskStore.get(task.id);
  if (!fresh) return false;

  // Split parent guard: don't mark COMPLETED if child tasks are pending
  if (fresh.splitPlan?.childTaskIds?.length) {
    let allChildrenDone = true;
    for (const childId of fresh.splitPlan.childTaskIds) {
      const child = await system.taskStore.get(childId);
      if (child && child.status !== "COMPLETED" && child.status !== "ARCHIVED") {
        allChildrenDone = false;
        break;
      }
    }
    if (!allChildrenDone) {
      console.log(
        `[DoneLaneRecovery] Orphan IN_PROGRESS ${task.id} is a split parent with pending children. Skipping.`,
      );
      return false;
    }
  }

  console.log(
    `[DoneLaneRecovery] Orphan IN_PROGRESS in done lane: ${task.id}. Marking COMPLETED.`,
  );
  await safeAtomicSave(fresh, system.taskStore, {
    status: "COMPLETED" as TaskStatus,
    triggerSessionId: null,
    lastSyncError: null,
    updatedAt: new Date(),
  }, "DoneLaneRecovery orphan-in-progress");
  return true;
}

async function recoverAutomationLimitExhausted(
  task: Task,
  system: RecoverySystem,
): Promise<boolean> {
  console.log(
    `[DoneLaneRecovery] Automation limit exhausted for card ${task.id} ` +
    `(error: ${(task.lastSyncError ?? "").slice(0, 80)}). Clearing marker.`,
  );
  // Re-read to avoid stale reference before updating
  const fresh = await system.taskStore.get(task.id);
  if (!fresh) return false;
  const cleaned = clearStuckMarker(fresh, "deep");

  await safeAtomicSave(fresh, system.taskStore, {
    lastSyncError: cleaned.lastSyncError,
    laneSessions: cleaned.laneSessions,
    triggerSessionId: null,
    updatedAt: new Date(),
  }, "DoneLaneRecovery automation-limit-clear");
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

// ── Specialist session resolution ──────────────────────────────────────────

/**
 * Resolve done-lane tasks whose independent specialist sessions (auto-merger,
 * conflict-resolver, rebase-resolver) have completed or failed. These sessions
 * are NOT tracked in WorkflowOrchestrator.activeAutomations, so their outcomes
 * are only detected here by checking HttpSessionStore for terminal states.
 */
async function resolveCompletedSpecialistSessions(
  tasks: Task[],
  system: RecoverySystem,
): Promise<number> {
  const sessionStore = getHttpSessionStore();
  let resolved = 0;

  for (const task of tasks) {
    const sessions = task.laneSessions ?? [];
    let specialistSession: TaskLaneSession | undefined;
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      if (s.status === "running" && s.specialistId
          && (RECOVERY_SPECIALIST_IDS as readonly string[]).includes(s.specialistId)) {
        specialistSession = s;
        break;
      }
    }
    if (!specialistSession?.sessionId) continue;

    const activity = sessionStore.getSessionActivity(specialistSession.sessionId);
    // If the session has a terminal state, process it immediately.
    // If there's activity but no terminal state, check for silent death:
    //   if the last meaningful activity was > orphanAgeMs ago, treat as timed_out.
    // If there's NO activity record at all (e.g. server restart cleared HttpSessionStore),
    //   check startedAt — if the session started > orphanAgeMs ago, treat as timed_out.
    if (!activity?.terminalState) {
      if (activity?.lastMeaningfulActivityAt) {
        const lastActive = new Date(activity.lastMeaningfulActivityAt).getTime();
        const staleThresholdMs = recoveryCfg.orphanAgeMs;
        if (Date.now() - lastActive < staleThresholdMs) {
          continue; // Session still active (within threshold)
        }
        console.warn(
          `[DoneLaneRecovery] Specialist session ${specialistSession.sessionId} for card ${task.id} ` +
          `has no terminalState but last activity was ${Math.round((Date.now() - lastActive) / 60_000)}m ago. ` +
          `Treating as timed_out.`,
        );
      } else if (specialistSession.startedAt) {
        const startedAt = new Date(specialistSession.startedAt).getTime();
        if (Date.now() - startedAt < recoveryCfg.orphanAgeMs) {
          continue; // Session started recently — may still be initializing
        }
        console.warn(
          `[DoneLaneRecovery] Specialist session ${specialistSession.sessionId} for card ${task.id} ` +
          `has no HttpSessionStore record (server restart?). Session started ${Math.round((Date.now() - startedAt) / 60_000)}m ago. ` +
          `Treating as timed_out.`,
        );
      } else {
        continue; // No activity record and no startedAt — skip
      }
    }

    const effectiveTerminalState = activity?.terminalState ?? "timed_out";

    const freshTask = await system.taskStore.get(task.id);
    if (!freshTask) continue;

    const specialistId = specialistSession.specialistId;
    const isSuccess = effectiveTerminalState === "completed";

    markTaskLaneSessionStatus(freshTask, specialistSession.sessionId,
      isSuccess ? "completed" : "failed");

    if (isSuccess && specialistId === "kanban-auto-merger") {
      await safeAtomicSave(freshTask, system.taskStore, {
        lastSyncError: null,
        triggerSessionId: null,
        laneSessions: freshTask.laneSessions,
        updatedAt: new Date(),
      }, "DoneLaneRecovery specialist-auto-merger-success");
      resolved++;
      console.log(
        `[DoneLaneRecovery] Auto-merger completed for card ${task.id}. Clearing marker.`,
      );
    } else if (!isSuccess && specialistId === "kanban-auto-merger") {
      console.log(
        `[DoneLaneRecovery] Auto-merger failed for card ${task.id}. Marking stuck for next tick recovery.`,
      );
      await safeAtomicSave(freshTask, system.taskStore, {
        triggerSessionId: null,
        lastSyncError: `[done-lane-stuck] Auto-merger failed (session ${specialistSession.sessionId}). Will retry on next tick via webhook_missed recovery.`,
        laneSessions: freshTask.laneSessions,
        updatedAt: new Date(),
      }, "DoneLaneRecovery specialist-auto-merger-failed");
      resolved++;
    } else if (isSuccess && specialistId === "kanban-conflict-resolver") {
      await safeAtomicSave(freshTask, system.taskStore, {
        lastSyncError: null,
        triggerSessionId: null,
        laneSessions: freshTask.laneSessions,
        updatedAt: new Date(),
      }, "DoneLaneRecovery specialist-conflict-resolver-success");
      resolved++;
      console.log(
        `[DoneLaneRecovery] Conflict-resolver completed for card ${task.id}. Will re-verify PR status.`,
      );
    } else if (!isSuccess && specialistId === "kanban-conflict-resolver") {
      const retryCount = countSpecialistRetries(freshTask, "kanban-conflict-resolver") + 1;
      if (retryCount >= recoveryCfg.conflictResolverMaxRetries) {
        console.warn(
          `[DoneLaneRecovery] Conflict-resolver exhausted for card ${task.id}. Attempting PR close + recreate.`,
        );
        const recreated = await attemptPrRecreate(freshTask, system);
        if (!recreated) {
          await safeAtomicSave(freshTask, system.taskStore, {
            lastSyncError: buildDoneStuckError(
              `Conflict resolver failed ${retryCount} times and PR recreate failed. Manual intervention required.`,
            ),
            triggerSessionId: null,
            laneSessions: freshTask.laneSessions,
            updatedAt: new Date(),
          }, "DoneLaneRecovery specialist-conflict-exhausted");
        }
      } else {
        console.log(
          `[DoneLaneRecovery] Conflict-resolver failed for card ${task.id} (retry ${retryCount}/${recoveryCfg.conflictResolverMaxRetries}). Retrying.`,
        );
        await safeAtomicSave(freshTask, system.taskStore, {
          lastSyncError: `[conflict-resolver-pending] Triggered at ${new Date().toISOString()}. Retry #${retryCount}.`,
          triggerSessionId: null,
          laneSessions: freshTask.laneSessions,
          updatedAt: new Date(),
        }, "DoneLaneRecovery specialist-conflict-retry");
        await triggerConflictResolver(freshTask, system);
      }
      resolved++;
    } else if (isSuccess && specialistId === "kanban-rebase-resolver") {
      await safeAtomicSave(freshTask, system.taskStore, {
        lastSyncError: null,
        triggerSessionId: null,
        laneSessions: freshTask.laneSessions,
        updatedAt: new Date(),
      }, "DoneLaneRecovery specialist-rebase-success");
      resolved++;
    } else if (!isSuccess && specialistId === "kanban-rebase-resolver") {
      const retryCount = countSpecialistRetries(freshTask, "kanban-rebase-resolver") + 1;
      if (retryCount >= recoveryCfg.conflictResolverMaxRetries) {
        await safeAtomicSave(freshTask, system.taskStore, {
          lastSyncError: `[done-lane-stuck] Rebase resolver failed ${retryCount} times. Manual intervention required.`,
          triggerSessionId: null,
          laneSessions: freshTask.laneSessions,
          updatedAt: new Date(),
        }, "DoneLaneRecovery specialist-rebase-exhausted");
      } else {
        await safeAtomicSave(freshTask, system.taskStore, {
          lastSyncError: `[rebase-resolver-pending] Triggered at ${new Date().toISOString()}. Retry #${retryCount}.`,
          triggerSessionId: null,
          laneSessions: freshTask.laneSessions,
          updatedAt: new Date(),
        }, "DoneLaneRecovery specialist-rebase-retry");
        await triggerRebaseResolver(freshTask, system);
      }
      resolved++;
    }
  }

  return resolved;
}

function countSpecialistRetries(task: Task, specialistId: string): number {
  const sessions = task.laneSessions ?? [];
  let count = 0;
  for (const s of sessions) {
    if (s.specialistId === specialistId && s.status === "failed") count++;
  }
  return count;
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
    limitSwept: 0,
    specialistResolved: 0,
    errors: 0,
  };

  if (shouldSkipTickForMemory("DoneLaneRecovery")) {
    return summary;
  }

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

        // Also scan blocked column for tasks with merged PRs (Issue 19 fix)
        const blockedColumns = board.columns.filter((col) => col.stage === "blocked");
        const blockedColumnIds = new Set(blockedColumns.map((c) => c.id));

        const doneTasks = allTasks.filter(
          (t) => t.columnId && (doneColumnIds.has(t.columnId)
            // Include blocked tasks with merged PRs for recovery
            || (blockedColumnIds.has(t.columnId) && t.pullRequestMergedAt)),
        );

        // Phase 0: Resolve specialist sessions that have completed/failed since last tick.
        const specialistResolved = await resolveCompletedSpecialistSessions(doneTasks, system);
        summary.specialistResolved += specialistResolved;

        // Collect all stuck items across done tasks
        const allStuckItems: DetectedStuck[] = [];
        for (const task of doneTasks) {
          summary.examined++;
          const stuckItems = await detectStuckPatterns(task, board);
          allStuckItems.push(...stuckItems);
        }

        // Sort: conflict-resolvers first, then merge candidates by dependency readiness
        const sorted = sortMergeCandidates(allStuckItems, taskMap);

        // Track auto-merger triggers per codebase to allow parallelism across repos.
        const autoMergerTriggeredBranches = new Set<string>();

        for (const stuck of sorted) {
          try {
            switch (stuck.pattern) {
              case "webhook_missed": {
                const branchKey = stuck.task.codebaseIds?.[0] ?? stuck.task.id;
                if (autoMergerTriggeredBranches.has(branchKey)) {
                  console.log(
                    `[DoneLaneRecovery] Deferring auto-merger for card ${stuck.task.id}: ` +
                    `already triggered one this tick for this codebase.`,
                  );
                  break;
                }
                const result = await recoverWebhookMissed(stuck.task, system);
                if (result === "merged") {
                  summary.recovered++;
                } else if (result === "auto_merger") {
                  summary.recovered++;
                  autoMergerTriggeredBranches.add(branchKey);
                } else if (result === "conflict") {
                  summary.conflictResolved++;
                }
                break;
              }
              case "cb_exhausted_pr_unmerged": {
                const branchKey = stuck.task.codebaseIds?.[0] ?? stuck.task.id;
                if (autoMergerTriggeredBranches.has(branchKey)) {
                  console.log(
                    `[DoneLaneRecovery] Deferring CB-exhausted merge for card ${stuck.task.id}: ` +
                    `already triggered one this tick for this codebase.`,
                  );
                  summary.stuckMarked++;
                  break;
                }
                const result = await recoverCbExhausted(stuck.task, system);
                if (result === "merged") {
                  summary.recovered++;
                  autoMergerTriggeredBranches.add(branchKey);
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
              case "pr_closed_unmerged": {
                // PR was closed without merging — trigger rebase-resolver
                await triggerRebaseResolver(stuck.task, system);
                summary.conflictResolved++;
                break;
              }
              case "orphan_in_progress": {
                const ok = await recoverOrphanInProgress(stuck.task, system);
                if (ok) summary.completed++;
                break;
              }
              case "no_pr_completed": {
                // COMPLETED but no PR — push code and create PR
                if (stuck.task.worktreeId && stuck.task.boardId) {
                  // Clear placeholder PR URLs ("manual", "already-merged") so PrAutoCreate can proceed
                  if (stuck.task.pullRequestUrl && !isRealPR(stuck.task)) {
                    await safeAtomicSave(stuck.task, system.taskStore, {
                      pullRequestUrl: null,
                      updatedAt: new Date(),
                    }, "DoneLaneRecovery no-pr-clear-placeholder");
                  }
                  const prUrl = await executeAutoPrCreation(
                    system.worktreeStore,
                    system.taskStore,
                    system.codebaseStore,
                    {
                      cardId: stuck.task.id,
                      cardTitle: stuck.task.title ?? stuck.task.id,
                      boardId: stuck.task.boardId,
                      worktreeId: stuck.task.worktreeId,
                    },
                  );
                  if (prUrl) {
                    console.log(
                      `[DoneLaneRecovery] Created PR for no-pr-completed task ${stuck.task.id}: ${prUrl}`,
                    );
                    summary.recovered++;
                  } else {
                    console.warn(
                      `[DoneLaneRecovery] PR creation returned no URL for task ${stuck.task.id}`,
                    );
                  }
                }
                break;
              }
              case "automation_limit_exhausted": {
                const ok = await recoverAutomationLimitExhausted(stuck.task, system);
                if (ok) summary.limitSwept++;
                break;
              }
              case "review_degraded": {
                // Auto-pass, but first ensure PR exists if task has a worktree
                const freshDegraded = await system.taskStore.get(stuck.task.id);
                if (freshDegraded) {
                  if (!isRealPR(freshDegraded) && freshDegraded.worktreeId && freshDegraded.boardId) {
                    // Clear placeholder PR URLs so PrAutoCreate can proceed
                    if (freshDegraded.pullRequestUrl) {
                      await safeAtomicSave(freshDegraded, system.taskStore, {
                        pullRequestUrl: null,
                        updatedAt: new Date(),
                      }, "DoneLaneRecovery review-degraded-clear-pr");
                    }
                    const prUrl = await executeAutoPrCreation(
                      system.worktreeStore,
                      system.taskStore,
                      system.codebaseStore,
                      {
                        cardId: freshDegraded.id,
                        cardTitle: freshDegraded.title ?? freshDegraded.id,
                        boardId: freshDegraded.boardId,
                        worktreeId: freshDegraded.worktreeId,
                      },
                    );
                    if (prUrl) {
                      console.log(
                        `[DoneLaneRecovery] Created PR for review-degraded task ${freshDegraded.id}: ${prUrl}`,
                      );
                      summary.recovered++;
                    }
                  }
                  await safeAtomicSave(freshDegraded, system.taskStore, {
                    lastSyncError: null,
                    status: TaskStatus.COMPLETED,
                    updatedAt: new Date(),
                  }, "DoneLaneRecovery review-degraded-complete");
                  console.log(
                    `[DoneLaneRecovery] Auto-passed review-degraded task ${freshDegraded.id}.`,
                  );
                  summary.completed++;
                }
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
    `specialistResolved=${summary.specialistResolved}, ` +
    `limitSwept=${summary.limitSwept}, errors=${summary.errors}`,
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
            && !err.startsWith("[conflict-resolver-pending]")
            && !err.startsWith("[rebase-resolver-pending]")
            && !err.startsWith("[done-lane-stuck]")) {
          continue;
        }
        if (task.triggerSessionId) continue;

        console.log(
          `[DoneLaneRecovery] Cleaning orphan marker for card ${task.id}: ${err.slice(0, 40)}...`,
        );
        // Startup cleanup uses safeAtomicSave for consistency
        await safeAtomicSave(task, system.taskStore, {
          lastSyncError: null,
          updatedAt: new Date(),
        }, "DoneLaneRecovery startup-cleanup");
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
