/**
 * PR Auto-Create
 *
 * Creates a Pull Request for a completed kanban task by pushing the
 * worktree branch to origin and invoking `gh pr create`.
 *
 * Can be called directly (synchronous, pre-automation) or via the
 * PR_CREATE_REQUESTED event listener (backward compatibility).
 *
 * Steps:
 *   1. Resolve worktree path and current branch
 *   2. Push the branch to origin (if not already pushed)
 *   3. Create a Pull Request via gh CLI (--body-file for safe multi-line body)
 *   4. Update the task with the PR URL
 */

import { AgentEvent, AgentEventType } from "../events/event-bus";
import { getServerBridge } from "../platform";
import type { RoutaSystem } from "../routa-system";
import type { TaskStore } from "../store/task-store";
import type { WorktreeStore } from "../db/pg-worktree-store";
import { shellQuote } from "../git/git-utils";

const HANDLER_KEY = "kanban-pr-auto-create";
const PR_RETRY_LIMIT = parseInt(process.env.ROUTA_PR_RETRY_LIMIT ?? "3", 10);
export const PR_FAILURE_PREFIX = "Auto PR creation failed";

async function execCommand(
  command: string,
  cwd: string,
  timeout = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  const bridge = getServerBridge();
  if (!bridge.process.isAvailable()) {
    throw new Error("Process API is not available in this environment.");
  }
  return bridge.process.exec(command, { cwd, timeout });
}

/**
 * Execute auto PR creation for a task.
 *
 * Pushes the worktree branch to origin and creates a PR via `gh` CLI.
 * On success, updates the task's `pullRequestUrl` field.
 *
 * @returns The PR URL on success, or `undefined` on failure / skip.
 */
export async function executeAutoPrCreation(
  worktreeStore: WorktreeStore,
  taskStore: TaskStore,
  params: {
    cardId: string;
    cardTitle: string;
    boardId: string;
    worktreeId: string;
  },
): Promise<string | undefined> {
  const { cardId, cardTitle, boardId: _boardId, worktreeId } = params;

  // Pre-flight: check if task already has a PR URL
  const preCheck = await taskStore.get(cardId);
  if (preCheck?.pullRequestUrl) {
    console.log(
      `[PrAutoCreate] Task ${cardId} already has PR: ${preCheck.pullRequestUrl}. Skipping.`,
    );
    return preCheck.pullRequestUrl;
  }

  // Pre-flight: check retry limit (check both direct prefix and embedded in circuit-breaker marker)
  const lastErr = preCheck?.lastSyncError ?? "";
  const prAttemptMatch = lastErr.match(/\(attempt (\d+)\/\d+\)/);
  if (lastErr.includes(PR_FAILURE_PREFIX) && prAttemptMatch) {
    const attempts = parseInt(prAttemptMatch[1], 10);
    if (attempts >= PR_RETRY_LIMIT) {
      console.warn(
        `[PrAutoCreate] Task ${cardId} exceeded ${PR_RETRY_LIMIT} PR creation attempts. Skipping.`,
      );
      return undefined;
    }
  }

  console.log(
    `[PrAutoCreate] Creating PR for task ${cardId}.`,
  );

  try {
    // 1. Resolve worktree
    const worktree = await worktreeStore.get(worktreeId);
    if (!worktree?.worktreePath) {
      console.warn(
        `[PrAutoCreate] Worktree ${worktreeId} not found or has no path. Skipping.`,
      );
      return undefined;
    }

    const cwd = worktree.worktreePath;
    const branch = worktree.branch;

    if (!branch) {
      console.warn(
        `[PrAutoCreate] Worktree ${worktreeId} has no branch. Skipping.`,
      );
      return undefined;
    }

    // 2. Check if branch already exists on remote — skip push if so
    let branchAlreadyOnRemote = false;
    try {
      const lsResult = await execCommand(
        `git ls-remote --heads origin ${shellQuote(branch)}`,
        cwd,
        30_000,
      );
      if (lsResult.stdout.trim()) {
        branchAlreadyOnRemote = true;
        console.log(
          `[PrAutoCreate] Branch ${branch} already exists on remote for task ${cardId}. Skipping push.`,
        );
      }
    } catch {
      // ls-remote failure is not fatal — proceed with push
    }

    // 3. Push the branch to origin (only if not already present)
    if (!branchAlreadyOnRemote) {
    try {
      await execCommand(
        `git push -u origin ${shellQuote(branch)}`,
        cwd,
        60_000,
      );
      console.log(
        `[PrAutoCreate] Pushed branch ${branch} for task ${cardId}.`,
      );
    } catch (pushErr) {
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      console.error(
        `[PrAutoCreate] Push failed for task ${cardId}:`,
        msg,
      );
      const task = await taskStore.get(cardId);
      if (task) {
        const prevAttempts = (task.lastSyncError ?? "").includes(PR_FAILURE_PREFIX)
          ? ((task.lastSyncError ?? "").match(/\(attempt (\d+)\/\d+\)/)?.[1] ?? "0")
          : "0";
        const attempt = parseInt(prevAttempts, 10) + 1;
        task.lastSyncError = `${PR_FAILURE_PREFIX}: git push failed — ${msg} (attempt ${attempt}/${PR_RETRY_LIMIT})`;
        task.updatedAt = new Date();
        await taskStore.save(task);
      }
      return undefined;
    }
    } // end if (!branchAlreadyOnRemote)

    // 3b. Verify the branch exists on the remote
    try {
      const lsResult = await execCommand(
        `git ls-remote --heads origin ${shellQuote(branch)}`,
        cwd,
        30_000,
      );
      if (!lsResult.stdout.trim()) {
        console.error(
          `[PrAutoCreate] Branch ${branch} not found on remote after push for task ${cardId}.`,
        );
        const task = await taskStore.get(cardId);
        if (task) {
          task.lastSyncError = `Auto PR creation failed: branch ${branch} not found on remote after push.`;
          task.updatedAt = new Date();
          await taskStore.save(task);
        }
        return undefined;
      }
    } catch (verifyErr) {
      console.warn(
        `[PrAutoCreate] Remote verification skipped for task ${cardId}:`,
        verifyErr instanceof Error ? verifyErr.message : verifyErr,
      );
    }

    // 3. Get the task for PR title/body
    const task = await taskStore.get(cardId);

    // 4. Create PR via gh CLI
    const prTitle = task?.title ?? cardTitle;
    const prBody = task?.objective ?? "Auto-created PR from kanban done-lane.";
    const baseBranch = worktree.baseBranch;

    // Use --body-file to avoid shell injection and multi-line issues.
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    const tmpFile = path.join(os.tmpdir(), `routa-pr-body-${cardId}.md`);
    await fs.writeFile(tmpFile, prBody, "utf-8");

    try {
      const ghArgs = [
        "pr", "create",
        "--title", shellQuote(prTitle),
        "--body-file", shellQuote(tmpFile),
        "--head", shellQuote(branch),
        ...(baseBranch ? ["--base", shellQuote(baseBranch)] : []),
      ];
      const ghCommand = ["gh", ...ghArgs].join(" ");

      let ghResult: { stdout: string; stderr: string };
      try {
        ghResult = await execCommand(ghCommand, cwd, 60_000);
      } catch (ghErr: unknown) {
        // Handle "already exists" — extract PR URL from error message
        const errMsg = ghErr instanceof Error ? ghErr.message : String(ghErr);
        const existingUrlMatch = errMsg.match(/already exists:\s*\n?(https:\/\/[^\s]+)/i);
        if (existingUrlMatch) {
          const existingUrl = existingUrlMatch[1].trim();
          console.log(
            `[PrAutoCreate] PR already exists for task ${cardId}: ${existingUrl}.`,
          );
          if (task) {
            task.pullRequestUrl = existingUrl;
            task.isPullRequest = true;
            task.lastSyncError = undefined;
            task.updatedAt = new Date();
            await taskStore.save(task);
          }
          return existingUrl;
        }
        throw ghErr;
      }

      // gh pr create outputs the PR URL on success
      const prUrl = ghResult.stdout.trim().split("\n").pop()?.trim();

      if (!prUrl || !prUrl.startsWith("http")) {
        console.error(
          `[PrAutoCreate] Unexpected gh pr create output for task ${cardId}:`,
          ghResult.stdout,
          ghResult.stderr,
        );

        if (task) {
          task.lastSyncError = `${PR_FAILURE_PREFIX}: ${
            ghResult.stderr?.trim() || "unexpected output"
          }`;
          task.updatedAt = new Date();
          await taskStore.save(task);
        }
        return undefined;
      }

      // 5. Update the task with the PR URL
      if (task) {
        task.pullRequestUrl = prUrl;
        task.isPullRequest = true;
        task.lastSyncError = undefined;
        task.updatedAt = new Date();
        await taskStore.save(task);
      }

      console.log(
        `[PrAutoCreate] Created PR for task ${cardId}: ${prUrl}`,
      );
      return prUrl;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  } catch (err) {
    console.error(
      `[PrAutoCreate] Failed to create PR for task ${cardId}:`,
      err,
    );

    // Store error on task so the UI surfaces it
    try {
      const task = await taskStore.get(cardId);
      if (task) {
        const prevAttempts = (task.lastSyncError ?? "").includes(PR_FAILURE_PREFIX)
          ? ((task.lastSyncError ?? "").match(/\(attempt (\d+)\/\d+\)/)?.[1] ?? "0")
          : "0";
        const attempt = parseInt(prevAttempts, 10) + 1;
        task.lastSyncError = `${PR_FAILURE_PREFIX}: ${
          err instanceof Error ? err.message : String(err)
        } (attempt ${attempt}/${PR_RETRY_LIMIT})`;
        task.updatedAt = new Date();
        await taskStore.save(task);
      }
    } catch {
      // Best-effort error recording
    }
    return undefined;
  }
}

/**
 * Start listening for PR_CREATE_REQUESTED events (backward compatibility).
 */
export function startPrAutoCreateListener(system: RoutaSystem): void {
  system.eventBus.on(HANDLER_KEY, async (event: AgentEvent) => {
    if (event.type !== AgentEventType.PR_CREATE_REQUESTED) return;

    const { cardId, cardTitle, boardId, worktreeId } = event.data as {
      cardId: string;
      cardTitle: string;
      boardId: string;
      worktreeId: string;
    };

    await executeAutoPrCreation(system.worktreeStore, system.taskStore, {
      cardId,
      cardTitle,
      boardId,
      worktreeId,
    });
  });
}
