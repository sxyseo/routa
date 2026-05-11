/**
 * GitHub PR REST API Utilities
 *
 * Provides PR merge, status check, and close operations via GitHub REST API.
 * Replaces `gh` CLI calls to avoid Windows Bash tool ENOENT failures.
 */

import { parsePrUrl } from "../kanban/pr-status-verifier";

const GITHUB_API_HEADERS = (token: string) => ({
  Authorization: `token ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
});

const REQUEST_TIMEOUT_MS = 30_000;

// ─── Merge ──────────────────────────────────────────────────────────────────

export interface MergeResult {
  ok: boolean;
  sha?: string;
  message?: string;
  /** HTTP status from GitHub (405 = not mergeable, 409 = conflict) */
  status?: number;
}

/**
 * Merge a pull request via GitHub REST API.
 * PUT /repos/{owner}/{repo}/pulls/{number}/merge
 */
export async function mergePullRequest(opts: {
  prUrl: string;
  token: string;
  mergeMethod?: "merge" | "squash" | "rebase";
  commitTitle?: string;
}): Promise<MergeResult> {
  const { prUrl, token, mergeMethod = "merge", commitTitle } = opts;

  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    return { ok: false, message: `Cannot parse PR URL: ${prUrl}` };
  }

  const { owner, repo, prNumber } = parsed;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`;

  const body: Record<string, unknown> = { merge_method: mergeMethod };
  if (commitTitle) {
    body.commit_title = commitTitle;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "PUT",
        headers: GITHUB_API_HEADERS(token),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 200) {
      const data = (await response.json()) as { sha?: string; message?: string };
      return { ok: true, sha: data.sha, message: data.message };
    }

    const errorBody = await response.text();
    let message: string;

    if (response.status === 405) {
      message = `PR not mergeable: ${errorBody}`;
    } else if (response.status === 409) {
      message = `Merge conflict: ${errorBody}`;
    } else {
      message = `GitHub API ${response.status}: ${errorBody}`;
    }

    return { ok: false, message, status: response.status };
  } catch (err) {
    return {
      ok: false,
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Status ─────────────────────────────────────────────────────────────────

export interface PrStatusResult {
  verified: boolean;
  merged: boolean;
  mergedAt?: string;
  closedAt?: string;
  /** "open" | "closed" */
  state?: string;
  mergeable?: boolean;
  headRefName?: string;
  baseRefName?: string;
}

/**
 * Get PR merge status via GitHub REST API.
 * GET /repos/{owner}/{repo}/pulls/{number}
 *
 * Never throws — returns `{ verified: false }` on any error.
 */
export async function getPullRequestStatus(opts: {
  prUrl: string;
  token: string;
}): Promise<PrStatusResult> {
  const { prUrl, token } = opts;
  const fallback: PrStatusResult = { verified: false, merged: false };

  const parsed = parsePrUrl(prUrl);
  if (!parsed) return fallback;

  const { owner, repo, prNumber } = parsed;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "GET",
        headers: GITHUB_API_HEADERS(token),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return fallback;
    }

    const data = await response.json() as {
      state?: string;
      merged?: boolean;
      merged_at?: string | null;
      closed_at?: string | null;
      mergeable?: boolean | null;
      head?: { ref?: string };
      base?: { ref?: string };
    };

    const merged = data.state === "closed" && data.merged === true;

    return {
      verified: true,
      merged,
      mergedAt: data.merged_at ?? undefined,
      closedAt: data.closed_at ?? undefined,
      state: data.state?.toLowerCase(),
      mergeable: data.mergeable === null ? undefined : data.mergeable ?? undefined,
      headRefName: data.head?.ref,
      baseRefName: data.base?.ref,
    };
  } catch {
    return fallback;
  }
}

// ─── Close ──────────────────────────────────────────────────────────────────

export interface ClosePrResult {
  closed: boolean;
  branchName?: string;
}

/**
 * Close a PR and optionally add a comment via GitHub REST API.
 * PATCH /repos/{owner}/{repo}/pulls/{number} + POST .../issues/{number}/comments
 *
 * Never throws — returns `{ closed: false }` on any error.
 */
export async function closePullRequestViaApi(opts: {
  prUrl: string;
  token: string;
  comment?: string;
}): Promise<ClosePrResult> {
  const { prUrl, token, comment } = opts;
  const parsed = parsePrUrl(prUrl);
  if (!parsed) return { closed: false };

  const { owner, repo, prNumber } = parsed;
  const baseApiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    // 1. Get head branch name before closing
    const controller1 = new AbortController();
    const timeout1 = setTimeout(() => controller1.abort(), REQUEST_TIMEOUT_MS);
    let detailResponse: Response;
    try {
      detailResponse = await fetch(`${baseApiUrl}/pulls/${prNumber}`, {
        method: "GET",
        headers: GITHUB_API_HEADERS(token),
        signal: controller1.signal,
      });
    } finally {
      clearTimeout(timeout1);
    }

    if (!detailResponse.ok) return { closed: false };

    const detail = await detailResponse.json() as {
      head?: { ref?: string };
    };
    const branchName = detail.head?.ref;

    // 2. Close the PR
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), REQUEST_TIMEOUT_MS);
    let closeResponse: Response;
    try {
      closeResponse = await fetch(`${baseApiUrl}/pulls/${prNumber}`, {
        method: "PATCH",
        headers: GITHUB_API_HEADERS(token),
        body: JSON.stringify({ state: "closed" }),
        signal: controller2.signal,
      });
    } finally {
      clearTimeout(timeout2);
    }

    if (!closeResponse.ok) return { closed: false };

    // 3. Add explanatory comment (best-effort)
    if (comment) {
      try {
        const controller3 = new AbortController();
        const timeout3 = setTimeout(() => controller3.abort(), REQUEST_TIMEOUT_MS);
        try {
          await fetch(`${baseApiUrl}/issues/${prNumber}/comments`, {
            method: "POST",
            headers: GITHUB_API_HEADERS(token),
            body: JSON.stringify({ body: comment }),
            signal: controller3.signal,
          });
        } finally {
          clearTimeout(timeout3);
        }
      } catch {
        // Comment failure is non-critical
      }
    }

    return { closed: true, branchName };
  } catch {
    return { closed: false };
  }
}
