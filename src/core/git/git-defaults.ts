/**
 * Git-related shared constants and helpers.
 *
 * Single source of truth for default values used across git operations.
 */

/** Default branch name used as fallback when no branch is configured. */
export const GIT_DEFAULT_BRANCH = "main";

/**
 * Check if a branch exists on the remote origin.
 *
 * Returns false on any error (network failure, missing repo, etc.) —
 * callers treat "not found" the same as "doesn't exist".
 */
export async function remoteBranchExists(
  repoPath: string,
  branch: string,
): Promise<boolean> {
  try {
    const { getServerBridge } = await import("../platform");
    const bridge = getServerBridge();
    if (!bridge.process.isAvailable()) return false;
    const result = await bridge.process.exec(
      `git ls-remote --heads origin ${branch}`,
      { cwd: repoPath, timeout: 15_000 },
    );
    return result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
