/**
 * PR Status Verifier
 *
 * Verifies the merge status of a GitHub Pull Request via the `gh` CLI.
 * Used by the lane scanner, workflow orchestrator, and done-lane recovery tick
 * to detect webhook-lost merges and merge conflicts.
 *
 * Designed to never throw — returns `{ verified: false }` when `gh` is
 * unavailable so callers can fall back gracefully.
 */

import { getServerBridge } from "../platform";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PrMergeVerification {
  /** Whether the PR has been merged on GitHub. */
  merged: boolean;
  /** ISO 8601 timestamp of the merge, if available. */
  mergedAt?: string;
  /** ISO 8601 timestamp of closure, if closed (not merged). */
  closedAt?: string;
  /** PR state: "open" | "closed" | "merged". */
  state?: string;
  /** PR base branch name. */
  baseRefName?: string;
  /** PR head branch name. */
  headRefName?: string;
  /** Whether GitHub considers the PR mergeable. */
  mergeable?: boolean;
  /** Conflict files reported by GitHub (if any). */
  conflictFiles?: string[];
  /** `true` if we actually queried GitHub. `false` means gh CLI was unavailable. */
  verified: boolean;
}

export interface ParsedPrUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

// ── URL parsing ────────────────────────────────────────────────────────────

const GITHUB_PR_URL_RE = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;

/**
 * Parse a GitHub PR URL into owner, repo, and PR number.
 *
 * Supports:
 *   - https://github.com/owner/repo/pull/123
 *   - http://github.com/owner/repo/pull/123
 */
export function parsePrUrl(url: string): ParsedPrUrl | undefined {
  const match = url.match(GITHUB_PR_URL_RE);
  if (!match) return undefined;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}

// ── Command execution ──────────────────────────────────────────────────────

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

// ── Merge status verification ──────────────────────────────────────────────

/**
 * Verify the merge status of a PR via `gh pr view --json`.
 *
 * Never throws — returns `{ verified: false }` on any error.
 */
export async function verifyPrMergeStatus(
  pullRequestUrl: string,
  options?: { cwd?: string; timeout?: number },
): Promise<PrMergeVerification> {
  const fallback: PrMergeVerification = { merged: false, verified: false };

  const parsed = parsePrUrl(pullRequestUrl);
  if (!parsed) return fallback;

  const { owner, repo, prNumber } = parsed;
  const cwd = options?.cwd ?? process.cwd();
  const timeout = options?.timeout ?? 30_000;

  try {
    const { stdout } = await execCommand(
      `gh pr view ${prNumber} --repo ${owner}/${repo} --json state,mergedAt,closedAt,mergeable,mergeStateStatus,baseRefName,headRefName --jq "."`,
      cwd,
      timeout,
    );

    const data = JSON.parse(stdout.trim());

    const merged = data.state === "MERGED" || Boolean(data.mergedAt);
    const mergedAt = data.mergedAt ?? undefined;
    const closedAt = data.closedAt ?? undefined;

    // gh returns mergeable as string: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
    // and mergeStateStatus as: "CLEAN" | "DIRTY" | "UNSTABLE" | "BLOCKED" | ...
    const rawMergeable = String(data.mergeable ?? "").toUpperCase();
    const rawMergeState = String(data.mergeStateStatus ?? "").toUpperCase();
    const mergeable =
      rawMergeable === "MERGEABLE" || rawMergeState === "CLEAN"
        ? true
        : rawMergeable === "CONFLICTING" || rawMergeState === "DIRTY"
          ? false
          : undefined;

    return {
      merged,
      mergedAt,
      closedAt,
      state: data.state?.toLowerCase(),
      baseRefName: data.baseRefName ?? undefined,
      headRefName: data.headRefName ?? undefined,
      mergeable,
      verified: true,
    };
  } catch {
    return fallback;
  }
}

// ── PR close ──────────────────────────────────────────────────────────────────

/**
 * Close a GitHub PR and return the head branch name.
 *
 * Used by the "Close + Recreate" strategy when conflict-resolver fails
 * and the PR needs to be closed so the task can be re-developed from
 * the latest main branch.
 *
 * Returns `{ closed: false }` on any error (never throws).
 */
export async function closePullRequest(
  prUrl: string,
): Promise<{ closed: boolean; branchName?: string }> {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) return { closed: false };

  try {
    const { owner, repo, prNumber } = parsed;

    // 1. Get head branch name before closing
    const { stdout } = await execCommand(
      `gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefName --jq ".headRefName"`,
      process.cwd(),
    );
    const branchName = stdout.trim();

    // 2. Close PR with explanatory comment
    await execCommand(
      `gh pr close ${prNumber} --repo ${owner}/${repo} --comment "Closed by routa: recreating from latest main due to persistent merge conflicts."`,
      process.cwd(),
    );

    return { closed: true, branchName: branchName || undefined };
  } catch {
    return { closed: false };
  }
}
