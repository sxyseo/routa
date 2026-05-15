/**
 * PR Status Verifier
 *
 * Verifies the merge status of a GitHub Pull Request.
 * Strategy: REST API first (no CLI dependency), `gh` CLI fallback.
 *
 * Used by the lane scanner, workflow orchestrator, and done-lane recovery tick
 * to detect webhook-lost merges and merge conflicts.
 *
 * Designed to never throw — returns `{ verified: false }` when both
 * REST API and `gh` CLI are unavailable so callers can fall back gracefully.
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
  /** `true` if we actually queried GitHub. `false` means both REST API and gh CLI were unavailable. */
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

// ── Command execution (fallback) ──────────────────────────────────────────

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
 * Verify the merge status of a PR.
 *
 * Strategy: REST API first (no CLI dependency), `gh pr view` fallback.
 * Never throws — returns `{ verified: false }` on any error.
 */
export async function verifyPrMergeStatus(
  pullRequestUrl: string,
  options?: { cwd?: string; timeout?: number },
): Promise<PrMergeVerification> {
  const fallback: PrMergeVerification = { merged: false, verified: false };

  // Strategy 1: GitHub REST API (preferred — no CLI dependency)
  const token = process.env.GH_TOKEN;
  if (token) {
    try {
      const { getPullRequestStatus } = await import("../github/github-merge");
      const status = await getPullRequestStatus({ prUrl: pullRequestUrl, token });
      if (status.verified) {
        return {
          merged: status.merged,
          mergedAt: status.mergedAt,
          closedAt: status.closedAt,
          state: status.state,
          baseRefName: status.baseRefName,
          headRefName: status.headRefName,
          mergeable: status.mergeable,
          verified: true,
        };
      }
    } catch {
      // REST API failed — fall through to CLI
    }
  }

  // Strategy 2: gh CLI fallback
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
 * Strategy: REST API first, `gh pr close` fallback.
 * Never throws — returns `{ closed: false }` on any error.
 */
export async function closePullRequest(
  prUrl: string,
): Promise<{ closed: boolean; branchName?: string }> {
  // Strategy 1: REST API
  const token = process.env.GH_TOKEN;
  if (token) {
    try {
      const { closePullRequestViaApi } = await import("../github/github-merge");
      const result = await closePullRequestViaApi({
        prUrl,
        token,
        comment: "Closed by routa: recreating from latest main due to persistent merge conflicts.",
      });
      if (result.closed) return result;
    } catch {
      // REST API failed — fall through to CLI
    }
  }

  // Strategy 2: gh CLI fallback
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
