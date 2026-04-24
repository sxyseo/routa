/**
 * Auto Archive Tick — periodic task that archives stale Done cards.
 *
 * Cards in the `done` column are eligible for archival after staying there
 * beyond a configurable number of days (default 30). Before archiving, the
 * tick verifies that all automation steps have completed and no active PRs
 * remain open.
 */

import type { RoutaSystem } from "../routa-system";
import type { Task, TaskLaneSession } from "../models/task";
import type { KanbanBoard, KanbanColumn } from "../models/kanban";
import { archiveTask } from "./archive-task";

/** Default number of days a card must sit in `done` before auto-archival. */
export const DEFAULT_AUTO_ARCHIVE_DAYS = 30;

/** Time (ms) after PR merge before a merged card becomes eligible for auto-archive. */
export const POST_MERGE_ARCHIVE_MS = 60 * 60 * 1000; // 1 hour

export interface AutoArchiveSummary {
  /** Number of cards successfully archived. */
  archived: number;
  /** Number of cards skipped with reasons. */
  skipped: Array<{ cardId: string; title: string; reason: string }>;
  /** Total done cards examined. */
  examined: number;
}

type AutoArchiveSystem = Pick<RoutaSystem, "taskStore" | "kanbanBoardStore" | "workspaceStore" | "eventBus">;

/**
 * Resolve the configured archive age threshold (in days) from workspace metadata.
 */
export function resolveAutoArchiveDays(metadata?: Record<string, string>): number {
  const raw = metadata?.autoArchiveDays;
  if (!raw) return DEFAULT_AUTO_ARCHIVE_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTO_ARCHIVE_DAYS;
}

/**
 * Check whether a task has been sitting in the done column long enough.
 * Merged cards (pullRequestMergedAt set) use the shorter POST_MERGE_ARCHIVE_MS
 * threshold; non-PR cards use the configured archiveDays.
 *
 * Note: hasPendingAutomation() and hasOpenPR() are checked separately in the
 * tick loop, so by the time a merged card passes the age check + those guards,
 * the pipeline is guaranteed to be complete.
 */
export function isCardOldEnough(task: Task, archiveDays: number, now: Date = new Date()): boolean {
  // Merged cards: eligible after POST_MERGE_ARCHIVE_MS (default 1 hour)
  if (task.pullRequestMergedAt) {
    const mergedAt = task.pullRequestMergedAt instanceof Date
      ? task.pullRequestMergedAt.getTime()
      : new Date(task.pullRequestMergedAt as string | number).getTime();
    return now.getTime() - mergedAt >= POST_MERGE_ARCHIVE_MS;
  }
  // Use the latest lane session entry for the done column to determine when
  // the card entered done. Fall back to updatedAt.
  const doneSessions = (task.laneSessions ?? []).filter(
    (s: TaskLaneSession) => s.columnId === task.columnId || s.columnId === "done",
  );
  const latestDoneSession = doneSessions[doneSessions.length - 1];
  const enteredAt = latestDoneSession?.startedAt
    ? new Date(latestDoneSession.startedAt)
    : task.updatedAt;

  if (!enteredAt) return false;
  const elapsedMs = now.getTime() - enteredAt.getTime();
  return elapsedMs >= archiveDays * 24 * 60 * 60 * 1000;
}

/**
 * Check whether a task has any running automation steps in its current column.
 *
 * A card is safe to archive only when no lane session for its current column
 * is still in `running` state.
 */
export function hasPendingAutomation(task: Task): boolean {
  const currentColumnId = task.columnId;
  const sessions = task.laneSessions ?? [];
  return sessions.some(
    (s: TaskLaneSession) =>
      (s.columnId === currentColumnId || s.columnId === "done") && s.status === "running",
  );
}

/**
 * Check whether a task has an open (non-merged) PR.
 * A PR is considered open if `pullRequestUrl` is set but `pullRequestMergedAt` is not.
 */
export function hasOpenPR(task: Task): boolean {
  return Boolean(task.pullRequestUrl && !task.pullRequestMergedAt);
}

/**
 * Find the archived column on a board.
 */
export function findArchivedColumn(board: KanbanBoard): KanbanColumn | undefined {
  return board.columns.find(
    (col) => col.stage === "archived" || col.id === "archived",
  );
}

/**
 * Find the done column on a board.
 */
export function findDoneColumn(board: KanbanBoard): KanbanColumn | undefined {
  return board.columns.find(
    (col) => col.stage === "done" || col.id === "done",
  );
}

/**
 * Run a single auto-archive tick across all workspaces.
 *
 * For each board, finds cards in the `done` column that have exceeded the
 * configured age threshold, have no pending automation, and no open PRs,
 * then moves them to the `archived` column.
 */
export async function runAutoArchiveTick(system: AutoArchiveSystem): Promise<AutoArchiveSummary> {
  const summary: AutoArchiveSummary = {
    archived: 0,
    skipped: [],
    examined: 0,
  };

  try {
    const workspaces = await system.workspaceStore.list();

    for (const workspace of workspaces) {
      const archiveDays = resolveAutoArchiveDays(workspace.metadata);
      const boards = await system.kanbanBoardStore.listByWorkspace(workspace.id);

      for (const board of boards) {
        const doneColumn = findDoneColumn(board);
        const archivedColumn = findArchivedColumn(board);
        if (!doneColumn || !archivedColumn) continue;

        const allTasks = await system.taskStore.listByWorkspace(workspace.id);
        const boardTasks = allTasks.filter(
          (t) => (t.boardId ?? board.id) === board.id && t.columnId === doneColumn.id,
        );

        for (const task of boardTasks) {
          summary.examined++;

          // AC2: only process cards in done that exceed the configured days
          if (!isCardOldEnough(task, archiveDays)) {
            summary.skipped.push({
              cardId: task.id,
              title: task.title,
              reason: `停留时间不足 ${archiveDays} 天`,
            });
            continue;
          }

          // AC3: skip if automation steps are still pending/running
          if (hasPendingAutomation(task)) {
            summary.skipped.push({
              cardId: task.id,
              title: task.title,
              reason: "存在未完成的自动化步骤",
            });
            continue;
          }

          // AC4: skip if there is an active open PR
          if (hasOpenPR(task)) {
            summary.skipped.push({
              cardId: task.id,
              title: task.title,
              reason: "存在未合并的 PR",
            });
            continue;
          }

          // AC5: archive with full resource cleanup (worktree, branch, sessions)
          const archiveResult = await archiveTask(system, task, board);
          if (archiveResult.success) {
            summary.archived++;
          } else {
            summary.skipped.push({
              cardId: task.id,
              title: task.title,
              reason: archiveResult.error ?? "归档失败",
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[AutoArchive] Tick failed:", err instanceof Error ? err.message : err);
  }

  // AC6: output summary log
  console.log(
    `[AutoArchive] Tick complete: examined=${summary.examined}, ` +
    `archived=${summary.archived}, skipped=${summary.skipped.length}` +
    (summary.skipped.length > 0
      ? ` (reasons: ${summary.skipped.map((s) => `[${s.cardId}] ${s.reason}`).join("; ")})`
      : ""),
  );

  return summary;
}
