/**
 * Diagnostics — collects system-level diagnostic data for the overseer.
 *
 * Scans tasks, sessions, worktrees, and markers to detect patterns
 * that require automated or manual intervention.
 */

import type { RoutaSystem } from "../routa-system";
import type { Task } from "../models/task";

// ─── Types ──────────────────────────────────────────────────────────

export type DiagnosticCategory = "AUTO" | "NOTIFY" | "ESCALATE";

export type DiagnosticPattern =
  | "stale-trigger-session"
  | "expired-pending-marker"
  | "orphan-worktree"
  | "dependency-block-resolved"
  | "version-conflict-retry"
  | "webhook-lost-pr-merge"
  | "orphan-in-progress"
  | "automation-limit-marker"
  | "cb-cooldown-expired";

export interface OverseerDiagnostic {
  pattern: DiagnosticPattern;
  category: DiagnosticCategory;
  taskId: string;
  description: string;
  details: Record<string, unknown>;
}

export interface OverseerTickResult {
  examined: number;
  autoFixed: number;
  notified: number;
  escalated: number;
  skipped: number;
  errors: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const STALE_TRIGGER_SESSION_MS = 30 * 60 * 1000;   // 30 minutes
const EXPIRED_PENDING_MARKER_MS = 60 * 60 * 1000;   // 60 minutes
const MAX_VERSION_CONFLICT_RETRIES = 2;

// ─── Active Session Checker ────────────────────────────────────────

async function hasActiveSession(system: RoutaSystem, sessionId: string): Promise<boolean> {
  try {
    // ConversationStore.getConversation(agentId) returns messages for that agent/session
    const messages = await system.conversationStore.getConversation(sessionId);
    if (!messages || messages.length === 0) return false;
    const lastMsg = messages[messages.length - 1];
    const lastActivity = lastMsg.timestamp?.getTime() ?? 0;
    return Date.now() - lastActivity < STALE_TRIGGER_SESSION_MS;
  } catch {
    return false;
  }
}

// ─── Diagnostic Collectors ─────────────────────────────────────────

/**
 * Collect all system diagnostics for the overseer to classify and act upon.
 */
export async function collectSystemDiagnostics(
  system: RoutaSystem,
): Promise<OverseerDiagnostic[]> {
  const diagnostics: OverseerDiagnostic[] = [];

  // Collect tasks across all workspaces
  const workspaces = await system.workspaceStore.list();
  const allTasks: Task[] = [];

  for (const ws of workspaces) {
    const tasks = await system.taskStore.listByWorkspace(ws.id);
    allTasks.push(...tasks);
  }

  for (const task of allTasks) {
    // AUTO: stale triggerSessionId
    await checkStaleTriggerSession(system, task, diagnostics);

    // AUTO: expired pending marker
    checkExpiredPendingMarker(task, diagnostics);

    // AUTO: orphan worktree reference
    await checkOrphanWorktree(system, task, diagnostics);

    // AUTO: dependency block resolved
    checkDependencyBlockResolved(task, allTasks, diagnostics);

    // AUTO: version conflict retry
    checkVersionConflictRetry(task, diagnostics);

    // NOTIFY: orphan IN_PROGRESS status
    checkOrphanInProgress(task, diagnostics);
  }

  return diagnostics;
}

async function checkStaleTriggerSession(
  system: RoutaSystem,
  task: Task,
  diagnostics: OverseerDiagnostic[],
): Promise<void> {
  const sid = task.triggerSessionId;
  if (!sid) return;

  // Check if task was recently updated (still active)
  const updatedAt = task.updatedAt?.getTime() ?? 0;
  if (Date.now() - updatedAt < STALE_TRIGGER_SESSION_MS) return;

  const hasActive = await hasActiveSession(system, sid);
  if (hasActive) return;

  diagnostics.push({
    pattern: "stale-trigger-session",
    category: "AUTO",
    taskId: task.id,
    description: `Task "${task.title}" has stale triggerSessionId (${sid}) with no active process for >30min`,
    details: { triggerSessionId: sid, taskStatus: task.status },
  });
}

function checkExpiredPendingMarker(
  task: Task,
  diagnostics: OverseerDiagnostic[],
): void {
  // Check for pending markers in task comment/fields
  const comment = task.comment ?? "";
  const markerPatterns = [
    "[auto-merger-pending]",
    "[automation-limit]",
    "[pending-review]",
  ];

  for (const marker of markerPatterns) {
    if (comment.includes(marker)) {
      const updatedAt = task.updatedAt?.getTime() ?? 0;
      if (Date.now() - updatedAt > EXPIRED_PENDING_MARKER_MS) {
        diagnostics.push({
          pattern: "expired-pending-marker",
          category: "AUTO",
          taskId: task.id,
          description: `Task "${task.title}" has expired pending marker "${marker}" >60min with no active session`,
          details: { marker, taskStatus: task.status },
        });
      }
    }
  }
}

async function checkOrphanWorktree(
  system: RoutaSystem,
  task: Task,
  diagnostics: OverseerDiagnostic[],
): Promise<void> {
  if (!task.worktreeId) return;

  try {
    const worktree = await system.worktreeStore.get(task.worktreeId);
    if (!worktree) {
      diagnostics.push({
        pattern: "orphan-worktree",
        category: "AUTO",
        taskId: task.id,
        description: `Task "${task.title}" references non-existent worktree ${task.worktreeId}`,
        details: { worktreeId: task.worktreeId },
      });
    }
  } catch {
    // Worktree store error — assume orphan
    diagnostics.push({
      pattern: "orphan-worktree",
      category: "AUTO",
      taskId: task.id,
      description: `Task "${task.title}" references inaccessible worktree ${task.worktreeId}`,
      details: { worktreeId: task.worktreeId },
    });
  }
}

function checkDependencyBlockResolved(
  task: Task,
  allTasks: Task[],
  diagnostics: OverseerDiagnostic[],
): void {
  // Don't interfere with split parent markers — they indicate child task
  // dependency, not dependency-block issues that unblock-dependency should clear.
  if (task.lastSyncError?.startsWith("[Split]")) return;

  const hasBlockedError = task.lastSyncError?.includes("dependency_blocked")
    || task.lastSyncError?.includes("Blocked by unfinished dependencies");
  if (task.status !== "PENDING" && task.dependencyStatus !== "blocked" && !hasBlockedError) return;

  const deps = task.dependencies ?? [];
  if (deps.length === 0) return;

  // Align with dependency-gate.ts isDependencySatisfied: check terminal status + PR merge
  const allSatisfied = deps.every((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    if (!dep) return false;
    const isTerminal = dep.status === "COMPLETED" || dep.status === "ARCHIVED"
      || dep.columnId === "done" || dep.columnId === "archived";
    const prMerged = !dep.pullRequestUrl || Boolean(dep.pullRequestMergedAt);
    return isTerminal && prMerged;
  });

  if (allSatisfied) {
    diagnostics.push({
      pattern: "dependency-block-resolved",
      category: "AUTO",
      taskId: task.id,
      description: `Task "${task.title}" is still blocked but all dependencies are satisfied`,
      details: { dependencies: deps, taskStatus: task.status },
    });
  }
}

function checkVersionConflictRetry(
  task: Task,
  diagnostics: OverseerDiagnostic[],
): void {
  const lastSyncError = task.lastSyncError ?? "";
  if (!lastSyncError.toLowerCase().includes("version conflict") &&
      !lastSyncError.toLowerCase().includes("optimistic lock")) return;

  // Count how many times we've seen this
  const comments = task.comments ?? [];
  const conflictComments = comments.filter(
    (c) => c.body?.toLowerCase().includes("version conflict") ?? false,
  );

  if (conflictComments.length <= MAX_VERSION_CONFLICT_RETRIES) {
    diagnostics.push({
      pattern: "version-conflict-retry",
      category: "AUTO",
      taskId: task.id,
      description: `Task "${task.title}" has version conflict (retry ${conflictComments.length}/${MAX_VERSION_CONFLICT_RETRIES})`,
      details: { retryCount: conflictComments.length, lastError: lastSyncError },
    });
  }
}

function checkOrphanInProgress(
  task: Task,
  diagnostics: OverseerDiagnostic[],
): void {
  if (task.status !== "IN_PROGRESS") return;

  // Check if task has been IN_PROGRESS for a long time without session activity
  const updatedAt = task.updatedAt?.getTime() ?? 0;
  const THIRTY_MINUTES = 30 * 60 * 1000;
  if (Date.now() - updatedAt > THIRTY_MINUTES && !task.triggerSessionId) {
    diagnostics.push({
      pattern: "orphan-in-progress",
      category: "AUTO",
      taskId: task.id,
      description: `Task "${task.title}" has been IN_PROGRESS for >30min with no active session`,
      details: { taskStatus: task.status },
    });
  }
}
