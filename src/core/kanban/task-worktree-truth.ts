import type { Codebase } from "../models/codebase";
import type { Task } from "../models/task";
import type { Worktree } from "../models/worktree";
import { resolveEffectiveBaseBranch } from "./branch-plan";
import { GIT_DEFAULT_BRANCH } from "../git/git-defaults";

interface TaskWorktreeTruthSystem {
  codebaseStore: {
    get(codebaseId: string): Promise<Codebase | undefined>;
    getDefault(workspaceId: string): Promise<Codebase | undefined>;
    findByRepoPath?(workspaceId: string, repoPath: string): Promise<Codebase | undefined>;
  };
  worktreeStore: {
    get(worktreeId: string): Promise<Worktree | undefined>;
  };
}

export interface TaskWorktreeTruth {
  source: "task.worktreeId" | "repoPath" | "task.codebaseIds" | "defaultCodebase";
  worktreeId?: string;
  worktree?: Worktree;
  codebase?: Codebase;
  repoPath: string;
  cwd: string;
  branch?: string;
  baseBranch?: string;
}

export async function resolveTaskWorktreeTruth(
  task: Pick<Task, "workspaceId" | "codebaseIds" | "worktreeId">,
  system: TaskWorktreeTruthSystem,
  options?: { preferredRepoPath?: string },
): Promise<TaskWorktreeTruth | null> {
  if (task.worktreeId) {
    const worktree = await system.worktreeStore.get(task.worktreeId);
    if (worktree?.worktreePath) {
      const codebase = await system.codebaseStore.get(worktree.codebaseId);
      return {
        source: "task.worktreeId",
        worktreeId: task.worktreeId,
        worktree,
        codebase,
        repoPath: worktree.worktreePath,
        cwd: worktree.worktreePath,
        branch: worktree.branch,
        baseBranch: worktree.baseBranch || codebase?.branch,
      };
    }
  }

  const preferredRepoPath = options?.preferredRepoPath?.trim();
  if (preferredRepoPath && system.codebaseStore.findByRepoPath) {
    const codebase = await system.codebaseStore.findByRepoPath(task.workspaceId, preferredRepoPath);
    if (codebase?.repoPath) {
      return {
        source: "repoPath",
        codebase,
        repoPath: codebase.repoPath,
        cwd: codebase.repoPath,
        branch: codebase.branch,
        baseBranch: codebase.branch,
      };
    }
  }

  const primaryCodebaseId = task.codebaseIds[0];
  if (primaryCodebaseId) {
    const codebase = await system.codebaseStore.get(primaryCodebaseId);
    if (codebase?.repoPath) {
      return {
        source: "task.codebaseIds",
        codebase,
        repoPath: codebase.repoPath,
        cwd: codebase.repoPath,
        branch: codebase.branch,
        baseBranch: codebase.branch,
      };
    }
  }

  const defaultCodebase = await system.codebaseStore.getDefault(task.workspaceId);
  if (!defaultCodebase?.repoPath) {
    return null;
  }

  return {
    source: "defaultCodebase",
    codebase: defaultCodebase,
    repoPath: defaultCodebase.repoPath,
    cwd: defaultCodebase.repoPath,
    branch: defaultCodebase.branch,
    baseBranch: defaultCodebase.branch,
  };
}

/**
 * Async verification of a TaskWorktreeTruth's base branch against the remote.
 *
 * Uses the full fallback chain: worktree.baseBranch → codebase.branch → GIT_DEFAULT_BRANCH.
 * Returns the first candidate that exists on the remote.
 */
export async function resolveVerifiedBaseBranch(
  truth: TaskWorktreeTruth,
): Promise<string> {
  if (!truth.codebase?.repoPath) {
    return truth.baseBranch ?? GIT_DEFAULT_BRANCH;
  }
  return resolveEffectiveBaseBranch({
    worktree: { baseBranch: truth.baseBranch },
    codebase: { branch: truth.codebase.branch, repoPath: truth.codebase.repoPath },
  });
}
