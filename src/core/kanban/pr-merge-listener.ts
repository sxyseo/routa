/**
 * PR Merge Listener
 *
 * Listens for PR_MERGED events from the GitHub webhook/polling pipeline.
 * When a task's PR is merged:
 *   1. Sets pullRequestMergedAt on the task
 *   2. Fetches the latest code on the base branch in the main codebase
 *   3. Schedules worktree + branch cleanup for the merged task
 *   4. Rebases ALL dev-lane worktrees in the same repo onto the new base
 *   5. Re-triggers dependency gate for blocked downstream tasks
 *
 * All lifecycle decisions (delete branch, remove worktree, rebase downstream)
 * come from KanbanBranchRules via getKanbanBranchRules().
 */

import { AgentEvent, AgentEventType } from "../events/event-bus";
import { rebaseBranchSafe } from "../git/git-operations";
import { fetchRemote, fetchAndFastForward } from "../git/git-utils";
import type { RoutaSystem } from "../routa-system";
import { getKanbanBranchRules, DEFAULT_BRANCH_RULES } from "./board-branch-rules";
import { getErrorType } from "./sync-error-writer";
import { dependencyUnblockFields } from "./dependency-gate";
import { onChildTaskStatusChanged } from "./parent-child-lifecycle";
import { parsePrUrl } from "./pr-status-verifier";
import { getServerBridge } from "../platform";

const HANDLER_KEY = "kanban-pr-merge-listener";
const CLEANUP_DELAY_MS = 30_000;

let pendingTimers: ReturnType<typeof setTimeout>[] = [];

export function startPrMergeListener(system: RoutaSystem): void {
  system.eventBus.on(HANDLER_KEY, async (event: AgentEvent) => {
    if (event.type !== AgentEventType.PR_MERGED) return;

    const data = event.data as {
      pullRequestUrl: string;
      prNumber?: number;
      prTitle?: string;
      branch?: string;
      baseBranch?: string;
      mergedAt?: string;
      repo?: string;
    };

    const { pullRequestUrl, mergedAt, baseBranch } = data;
    if (!pullRequestUrl) return;

    console.log(`[PrMergeListener] PR merged: ${pullRequestUrl}`);

    // 1. Find the task by PR URL
    const task = system.taskStore.findByPullRequestUrl
      ? await system.taskStore.findByPullRequestUrl(pullRequestUrl)
      : undefined;

    if (!task) {
      console.log(
        `[PrMergeListener] No task found for PR URL: ${pullRequestUrl}. Skipping.`,
      );
      return;
    }

    // Resolve branch rules for this task's board
    const workspace = await system.workspaceStore.get(task.workspaceId);
    const boardId = task.boardId;
    const rules = boardId
      ? getKanbanBranchRules(workspace?.metadata, boardId)
      : DEFAULT_BRANCH_RULES;

    // 2. Set pullRequestMergedAt and clear stale PR creation errors
    if (!task.pullRequestMergedAt) {
      task.pullRequestMergedAt = mergedAt ? new Date(mergedAt) : new Date();
      task.updatedAt = new Date();
      // Clear lastSyncError if it was caused by a PR creation failure or a
      // specialist pending marker — the PR is now merged so these are irrelevant.
      if (task.lastSyncError?.includes("pr create")
          || task.lastSyncError?.includes("Auto PR creation failed")
          || task.lastSyncError?.startsWith("[auto-merger-pending]")
          || task.lastSyncError?.startsWith("[conflict-resolver-pending]")
          || task.lastSyncError?.startsWith("[rebase-resolver-pending]")
          || task.lastSyncError?.startsWith("[done-lane-stuck]")) {
        task.lastSyncError = undefined;
      }
      await system.taskStore.save(task);
      console.log(
        `[PrMergeListener] Set pullRequestMergedAt for task ${task.id}.`,
      );
    }

    // 3a. Schedule remote branch deletion (independent of worktree)
    if (rules.lifecycle.deleteBranchOnMerge && task.pullRequestUrl) {
      const branchName = data.branch ?? await resolveBranchNameFromPR(task.pullRequestUrl);
      if (branchName) {
        const prUrl = task.pullRequestUrl;
        pendingTimers.push(setTimeout(async () => {
          await deleteRemoteBranch(prUrl, branchName);
        }, CLEANUP_DELAY_MS));
      }
    }

    // 3b. Schedule worktree cleanup (branch is handled independently above)
    if (task.worktreeId && rules.lifecycle.removeWorktreeOnMerge) {
      pendingTimers.push(setTimeout(() => {
        system.eventBus.emit({
          type: AgentEventType.WORKTREE_CLEANUP,
          agentId: "kanban-pr-merge-listener",
          workspaceId: task.workspaceId,
          data: {
            worktreeId: task.worktreeId,
            taskId: task.id,
            boardId: task.boardId,
            deleteBranch: false,
          },
          timestamp: new Date(),
        });
      }, CLEANUP_DELAY_MS));
    }

    // 4. Fetch latest on the main codebase so future worktrees use the updated base
    if (baseBranch) {
      await fetchMainCodebase(system, task.workspaceId);
    }

    // 5. Rebase all dev-lane worktrees in the same repo + unblock dependents (driven by rules)
    await handleDownstreamTasks(system, task, baseBranch, rules);

    // 6. Parent-child lifecycle: if this is a child task, notify the parent
    if (task.parentTaskId) {
      try {
        await onChildTaskStatusChanged(task, {
          taskStore: system.taskStore,
          kanbanBoardStore: system.kanbanBoardStore,
          worktreeStore: system.worktreeStore,
          eventBus: system.eventBus,
        });
      } catch (lifecycleErr) {
        console.error(
          "[PrMergeListener] Parent-child lifecycle error:",
          lifecycleErr,
        );
      }
    }
  });
}

/**
 * Fetch the main codebase (non-worktree) so its remote tracking refs are current.
 * This ensures newly created worktrees start from the latest merged state.
 */
async function fetchMainCodebase(
  system: RoutaSystem,
  workspaceId: string,
): Promise<void> {
  try {
    const codebases = await system.codebaseStore.listByWorkspace(workspaceId);
    for (const cb of codebases) {
      if (cb.repoPath) {
        const result = fetchAndFastForward(cb.repoPath, { forceReset: true });
        if (result.fetched) {
          console.log(
            `[PrMergeListener] Fetched & fast-forwarded codebase ${cb.id} at ${cb.repoPath}. synced=${result.synced.join(",")} skipped=${result.skipped.join(",")}`,
          );
        }
      }
    }
  } catch (err) {
    console.warn("[PrMergeListener] Failed to fetch main codebase:", err);
  }
}

/**
 * After a PR merge, two things happen for remaining tasks:
 *
 * A) Rebase: Every dev-lane worktree in the same workspace that shares
 *    the same codebase gets rebased onto origin/{baseBranch}. This keeps
 *    branches current even without explicit dependency declarations.
 *    Controlled by rules.lifecycle.rebaseDownstream.
 *
 * B) Unblock: Tasks explicitly blocked by the merged task get their
 *    dependency block cleared and are re-triggered.
 */
async function handleDownstreamTasks(
  system: RoutaSystem,
  mergedTask: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>,
  baseBranch?: string,
  rules?: { lifecycle: { rebaseDownstream: boolean } },
): Promise<void> {
  if (!mergedTask.workspaceId) return;

  const effectiveRules = rules ?? DEFAULT_BRANCH_RULES;
  const allTasks = await system.taskStore.listByWorkspace(mergedTask.workspaceId);
  const rebasedTasks = new Set<string>();

  // ── A) Rebase all dev-lane worktrees (gated by rules) ──
  if (baseBranch && effectiveRules.lifecycle.rebaseDownstream) {
    for (const otherTask of allTasks) {
      // Skip self, skip tasks without worktrees, skip non-dev columns
      if (otherTask.id === mergedTask.id) continue;
      if (!otherTask.worktreeId) continue;
      if (otherTask.columnId !== "dev") continue;

      // Only rebase worktrees that share a codebase with the merged task
      if (!shareCodebase(mergedTask, otherTask)) continue;

      await attemptDownstreamRebase(system, otherTask.worktreeId, baseBranch, otherTask.id);
      rebasedTasks.add(otherTask.id);
    }
  }

  // ── B) Unblock explicit dependents ──
  for (const depTask of allTasks) {
    if (!depTask.dependencies.includes(mergedTask.id)) continue;

    // Re-check dependency gate — if all deps now satisfied, clear the block
    if (getErrorType(depTask.lastSyncError) === "dependency_blocked") {
      Object.assign(depTask, dependencyUnblockFields());
      await system.taskStore.save(depTask);
      console.log(
        `[PrMergeListener] Cleared dependency block for task ${depTask.id}.`,
      );

      // Re-trigger automation for this task
      system.eventBus.emit({
        type: AgentEventType.COLUMN_TRANSITION,
        agentId: "kanban-pr-merge-listener",
        workspaceId: depTask.workspaceId,
        data: {
          cardId: depTask.id,
          cardTitle: depTask.title,
          boardId: depTask.boardId ?? "",
          workspaceId: depTask.workspaceId,
          fromColumnId: depTask.columnId ?? "",
          toColumnId: depTask.columnId ?? "",
          fromColumnName: "",
          toColumnName: "",
        },
        timestamp: new Date(),
      });
    }
  }
}

/**
 * Check if two tasks share at least one codebase.
 */
function shareCodebase(
  a: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>,
  b: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>,
): boolean {
  if (!a.codebaseIds || !b.codebaseIds) return true; // conservatively assume shared
  return a.codebaseIds.some((id) => b.codebaseIds!.includes(id));
}

async function attemptDownstreamRebase(
  system: RoutaSystem,
  worktreeId: string,
  baseBranch: string,
  taskId: string,
): Promise<void> {
  try {
    const worktree = await system.worktreeStore.get(worktreeId);
    if (!worktree?.worktreePath) return;

    // Fetch latest from remote first
    fetchRemote(worktree.worktreePath);

    const result = await rebaseBranchSafe(worktree.worktreePath, `origin/${baseBranch}`);
    if (result.success) {
      console.log(
        `[PrMergeListener] Rebased downstream task ${taskId} onto ${baseBranch}.`,
      );
    } else {
      const task = await system.taskStore.get(taskId);
      if (task) {
        const conflictInfo = result.conflictFiles?.length
          ? ` Conflicts in: ${result.conflictFiles.join(", ")}`
          : "";
        task.lastSyncError = `Rebase onto ${baseBranch} failed after upstream merge.${conflictInfo} Resolve manually or re-trigger the task.`;
        task.updatedAt = new Date();
        await system.taskStore.save(task);
      }
      console.warn(
        `[PrMergeListener] Rebase failed for task ${taskId}: conflicts detected.`,
      );
    }
  } catch (err) {
    console.error(
      `[PrMergeListener] Rebase error for task ${taskId}:`,
      err,
    );
  }
}

// ── Branch cleanup helpers ─────────────────────────────────────────────────

const PROTECTED_BRANCHES = new Set(["main", "master", "private", "develop"]);

async function resolveBranchNameFromPR(prUrl: string): Promise<string | undefined> {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) return undefined;
  try {
    const bridge = getServerBridge();
    if (!bridge.process.isAvailable()) return undefined;
    const { stdout } = await bridge.process.exec(
      `gh pr view ${parsed.prNumber} --repo ${parsed.owner}/${parsed.repo} --json headRefName --jq "."`,
      { cwd: process.cwd(), timeout: 30_000 },
    );
    const data = JSON.parse(stdout.trim());
    return data.headRefName;
  } catch {
    return undefined;
  }
}

export async function deleteRemoteBranch(prUrl: string, branchName: string): Promise<void> {
  if (PROTECTED_BRANCHES.has(branchName)) return;
  const parsed = parsePrUrl(prUrl);
  if (!parsed) return;
  try {
    const bridge = getServerBridge();
    if (!bridge.process.isAvailable()) return;
    await bridge.process.exec(
      `gh api repos/${parsed.owner}/${parsed.repo}/git/refs/heads/${encodeURIComponent(branchName)} -X DELETE`,
      { cwd: process.cwd(), timeout: 30_000 },
    );
    console.log(`[PrMergeListener] Deleted remote branch "${branchName}".`);
  } catch {
    // Branch may already be deleted — not an error.
  }
}

export function stopPrMergeListener(eventBus: { off: (key: string) => void }): void {
  for (const t of pendingTimers) clearTimeout(t);
  pendingTimers = [];
  eventBus.off(HANDLER_KEY);
}
