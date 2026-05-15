/**
 * Orphan Branch Cleanup — startup scan that deletes remote branches from
 * already-merged PRs. Acts as a safety net when the pr-merge-listener's
 * branch deletion was skipped (missing worktreeId, server restart, etc.).
 */

import { getServerBridge } from "../platform";

const PROTECTED_BRANCHES = new Set(["main", "master", "private", "develop"]);

export interface OrphanBranchCleanupResult {
  deleted: number;
  skipped: number;
  errors: number;
}

/**
 * Delete remote feature branches that have no open PR.
 * Called once at startup, before periodic ticks begin.
 *
 * @param branchPrefixes Optional list of branch prefixes to consider.
 *   Defaults to ["issue/"] if not provided. Collect these from all boards'
 *   KanbanBranchRules.naming.prefix values.
 */
export async function cleanupOrphanBranchesOnStartup(
  branchPrefixes?: string[],
): Promise<OrphanBranchCleanupResult> {
  const prefixes = branchPrefixes?.length ? branchPrefixes : ["issue/"];
  const result: OrphanBranchCleanupResult = { deleted: 0, skipped: 0, errors: 0 };

  const bridge = getServerBridge();
  if (!bridge.process.isAvailable()) {
    return result;
  }

  try {
    // 1. Resolve current repo (owner/name)
    const { stdout: repoOut } = await bridge.process.exec(
      `gh repo view --json owner,name --jq "\\""+.owner.login+\\"/\\"+.name+\\"""`,
      { cwd: process.cwd(), timeout: 30_000 },
    );
    const repo = repoOut.trim().replace(/"/g, "");
    if (!repo || !repo.includes("/")) return result;

    // 2. List all remote branches
    const { stdout: branchOut } = await bridge.process.exec(
      `gh api "repos/${repo}/branches?per_page=100" --jq ".[].name"`,
      { cwd: process.cwd(), timeout: 30_000 },
    );
    const allBranches = branchOut.trim().split("\n").filter(Boolean);

    // 3. List open PR head branches (these must NOT be deleted)
    const { stdout: prOut } = await bridge.process.exec(
      `gh pr list --state open --json headRefName --jq ".[].headRefName"`,
      { cwd: process.cwd(), timeout: 30_000 },
    );
    const openPrBranches = new Set(prOut.trim().split("\n").filter(Boolean));

    // 4. Delete orphan branches
    for (const branch of allBranches) {
      if (PROTECTED_BRANCHES.has(branch)) continue;
      if (openPrBranches.has(branch)) continue;
      if (!prefixes.some((p) => branch.startsWith(p))) continue;

      try {
        await bridge.process.exec(
          `gh api "repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}" -X DELETE`,
          { cwd: process.cwd(), timeout: 15_000 },
        );
        result.deleted++;
        console.log(`[OrphanBranchCleanup] Deleted: ${branch}`);
      } catch {
        result.skipped++;
      }
    }
  } catch (err) {
    result.errors++;
    console.error(
      "[OrphanBranchCleanup] Error:",
      err instanceof Error ? err.message : err,
    );
  }

  if (result.deleted > 0) {
    console.log(
      `[OrphanBranchCleanup] Startup complete: deleted=${result.deleted}, skipped=${result.skipped}, errors=${result.errors}`,
    );
  }

  return result;
}
