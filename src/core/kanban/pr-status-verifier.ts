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
  /** PR state: "open" | "closed" | "merged". */
  state?: string;
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
      `gh pr view ${prNumber} --repo ${owner}/${repo} --json state,mergedAt,mergeable --jq "."`,
      cwd,
      timeout,
    );

    const data = JSON.parse(stdout.trim());

    const merged = data.state === "MERGED" || Boolean(data.mergedAt);
    const mergedAt = data.mergedAt ?? undefined;
    const mergeable = data.mergeable === true
      ? true
      : data.mergeable === false
        ? false
        : undefined;

    return {
      merged,
      mergedAt,
      state: data.state?.toLowerCase(),
      mergeable,
      verified: true,
    };
  } catch {
    return fallback;
  }
}
