/**
 * Git Utilities
 *
 * Shared utility functions for git operations in routa-js.
 * Provides helpers for repo validation, branch listing, and GitHub URL parsing.
 *
 * Uses the platform bridge for process execution and file system access,
 * enabling support across Web (Node.js), Tauri, and Electron environments.
 *
 * NOTE: The sync functions (isGitRepository, getCurrentBranch, etc.) use
 * bridge.process.execSync() which is only available on Web/Electron.
 * For Tauri, use bridge.git.* (async) instead.
 */

import * as path from "path";
import * as fs from "fs";
import { LRUCache } from "lru-cache";

import { getServerBridge } from "@/core/platform";
import { gitExec } from "@/core/utils/safe-exec";

// ─── GitHub URL Parsing ──────────────────────────────────────────────────

const GITHUB_URL_PATTERNS = [
  /^https?:\/\/(?:[^/@]+@)?github\.com\/([^/]+)\/([^/\s#?.]+)/i,
  /^git@github\.com:([^/]+)\/([^/\s#?.]+)/i,
  /^github\.com\/([^/]+)\/([^/\s#?.]+)/i,
];

const SIMPLE_OWNER_REPO = /^([a-zA-Z0-9\-_]+)\/([a-zA-Z0-9\-_.]+)$/;

// Performance limits for file statistics calculation
const MAX_UNTRACKED_FILES_WITH_SYNTHETIC_STATS = 25;
const MAX_CHANGED_FILES_WITH_DETAILED_STATS = 500; // Global limit for all file types

export interface ParsedVCSUrl {
  owner: string;
  repo: string;
  host?: string;
  platform?: "github" | "gitlab" | "other";
}

/**
 * Check if a string looks like a GitHub URL or owner/repo format.
 */
export function isGitHubUrl(url: string): boolean {
  const trimmed = url.trim();
  if (GITHUB_URL_PATTERNS.some((p) => p.test(trimmed))) return true;
  if (SIMPLE_OWNER_REPO.test(trimmed) && !trimmed.includes("\\") && !trimmed.includes(":")) return true;
  return false;
}

/**
 * Parse a GitHub URL into owner and repo.
 */
export function parseGitHubUrl(url: string): ParsedVCSUrl | null {
  const trimmed = url.trim();

  for (const pattern of GITHUB_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
    }
  }

  const simpleMatch = trimmed.match(SIMPLE_OWNER_REPO);
  if (simpleMatch && !trimmed.includes("\\") && !trimmed.includes(":")) {
    return { owner: simpleMatch[1], repo: simpleMatch[2] };
  }

  return null;
}

// ─── GitLab URL Parsing ──────────────────────────────────────────────────

const GITLAB_URL_PATTERNS = [
  /^https?:\/\/(?:[^/@]+@)?gitlab\.com\/([^/]+)\/([^/\s#?.]+)/i,
  /^git@gitlab\.com:([^/]+)\/([^/\s#?.]+)/i,
  /^gitlab\.com\/([^/]+)\/([^/\s#?.]+)/i,
];

/**
 * Get custom GitLab host from GITLAB_URL env var.
 * Returns the hostname (e.g., "localhost:8080") or null.
 */
function getCustomGitLabHost(): string | null {
  const gitlabUrl = process.env.GITLAB_URL?.trim().replace(/\/+$/, "");
  if (!gitlabUrl) return null;
  try {
    const parsed = new URL(gitlabUrl);
    const host = parsed.host; // includes port if present
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Build URL patterns for a custom GitLab host (self-hosted instance).
 */
function buildCustomGitLabPatterns(host: string): RegExp[] {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`^https?:\\/\\/([^/@]+@)?${escaped}\\/([^/]+)\\/([^/\\s#?.]+)`, "i"),
    new RegExp(`^git@${escaped}:([^/]+)\\/([^/\\s#?.]+)`, "i"),
  ];
}

/**
 * Check if a string looks like a GitLab URL.
 * Supports gitlab.com and custom GITLAB_URL instances.
 */
export function isGitLabUrl(url: string): boolean {
  const trimmed = url.trim();
  if (GITLAB_URL_PATTERNS.some((p) => p.test(trimmed))) return true;

  // Check against custom GITLAB_URL host
  const customHost = getCustomGitLabHost();
  if (customHost) {
    const customPatterns = buildCustomGitLabPatterns(customHost);
    if (customPatterns.some((p) => p.test(trimmed))) return true;
  }

  return false;
}

/**
 * Check if a string looks like a VCS URL (GitHub or GitLab) or owner/repo format.
 */
export function isVCSUrl(url: string): boolean {
  return isGitHubUrl(url) || isGitLabUrl(url);
}

/**
 * Build a clone URL from a parsed VCS URL.
 * For GitLab with custom GITLAB_URL, embed token for private repos.
 * For GitHub, embed GITHUB_TOKEN for private repos.
 */
export function buildCloneUrl(parsed: ParsedVCSUrl): string {
  // GitLab: embed token for authentication
  if (parsed.platform === "gitlab") {
    const gitlabUrl = process.env.GITLAB_URL?.trim().replace(/\/+$/, "");
    const token = process.env.GITLAB_TOKEN;
    if (gitlabUrl) {
      if (token) {
        // Embed token for private repo clone: http://oauth2:<token>@host/path.git
        try {
          const urlObj = new URL(gitlabUrl);
          return `${urlObj.protocol}//oauth2:${token}@${urlObj.host}/${parsed.owner}/${parsed.repo}.git`;
        } catch {
          return `${gitlabUrl}/${parsed.owner}/${parsed.repo}.git`;
        }
      }
      return `${gitlabUrl}/${parsed.owner}/${parsed.repo}.git`;
    }
  }

  // GitHub: embed token for authentication
  if (parsed.platform === "github") {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
      return `https://${token}@github.com/${parsed.owner}/${parsed.repo}.git`;
    }
  }

  const host = parsed.host || "github.com";
  return `https://${host}/${parsed.owner}/${parsed.repo}.git`;
}

/**
 * Parse a VCS URL (GitHub or GitLab) into owner, repo, host, and platform.
 * Falls back to simple owner/repo format (assumes GitHub).
 */
export function parseVCSUrl(url: string): ParsedVCSUrl | null {
  const trimmed = url.trim();

  // Try GitHub patterns
  for (const pattern of GITHUB_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, ""), host: "github.com", platform: "github" };
    }
  }

  // Try GitLab.com patterns
  for (const pattern of GITLAB_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, ""), host: "gitlab.com", platform: "gitlab" };
    }
  }

  // Try custom GitLab instance patterns (from GITLAB_URL env var)
  const customGitLabHost = getCustomGitLabHost();
  if (customGitLabHost) {
    const customPatterns = buildCustomGitLabPatterns(customGitLabHost);
    for (const pattern of customPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        return { owner: match[1], repo: match[2].replace(/\.git$/, ""), host: customGitLabHost, platform: "gitlab" };
      }
    }
  }

  // Try generic HTTPS URL (any domain with /owner/repo pattern)
  const genericMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/\s#?.]+)/);
  if (genericMatch) {
    // If PLATFORM=gitlab and no specific match, treat generic URL as gitlab
    const detectedPlatform = process.env.PLATFORM === "gitlab" ? "gitlab" : "other";
    return { owner: genericMatch[2], repo: genericMatch[3].replace(/\.git$/, ""), host: genericMatch[1], platform: detectedPlatform };
  }

  // Simple owner/repo format (assume GitHub for backward compat)
  const simpleMatch = trimmed.match(SIMPLE_OWNER_REPO);
  if (simpleMatch && !trimmed.includes("\\") && !trimmed.includes(":")) {
    return { owner: simpleMatch[1], repo: simpleMatch[2], host: "github.com", platform: "github" };
  }

  return null;
}

// ─── Bridge Helper ──────────────────────────────────────────────────────

/**
 * Execute a git command synchronously via the platform bridge.
 * Uses argv-based execution to avoid shell parsing of git format strings.
 */
function gitExecSync(args: string[], cwd: string): string {
  // Preserve leading whitespace because `git status --porcelain` encodes
  // worktree state in fixed columns at the start of each line.
  return gitExec(args, { cwd }).trimEnd();
}

/**
 * Quote a value for safe interpolation into a shell command string.
 *
 * Uses POSIX single-quotes on Unix and double-quotes on Windows (cmd.exe
 * does not recognise single-quote quoting and would pass the quotes
 * literally to git, creating refs whose *names* contain quote characters).
 */
export function shellQuote(value: string): string {
  if (process.platform === "win32") {
    // cmd.exe: use double-quotes and escape embedded double-quotes.
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  // Unix (bash/zsh): use strong single-quote quoting.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hasGitRef(repoPath: string, ref: string): boolean {
  try {
    gitExecSync(["rev-parse", "--verify", ref], repoPath);
    return true;
  } catch {
    return false;
  }
}

export function getRepoRefSha(repoPath: string, ref: string): string | null {
  try {
    return gitExecSync(["rev-parse", ref], repoPath);
  } catch {
    return null;
  }
}

function resolveBaseRef(
  repoPath: string,
  baseBranch?: string | null,
  codebaseDefaultBranch?: string | null,
): string | undefined {
  const normalizedBaseBranch = baseBranch?.trim();
  const normalizedCodebaseBranch = codebaseDefaultBranch?.trim();
  const candidates = Array.from(new Set([
    normalizedBaseBranch ? `origin/${normalizedBaseBranch}` : null,
    normalizedBaseBranch ?? null,
    normalizedCodebaseBranch ? `origin/${normalizedCodebaseBranch}` : null,
    normalizedCodebaseBranch ?? null,
    "origin/main",
    "main",
    "origin/master",
    "master",
  ].filter((candidate): candidate is string => Boolean(candidate))));

  return candidates.find((candidate) => hasGitRef(repoPath, candidate));
}

// ─── Git Repository Inspection ──────────────────────────────────────────

export interface RepoBranchInfo {
  current: string;
  branches: string[];
}

export type FileChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "typechange"
  | "conflicted";

export interface GitFileChange {
  path: string;
  status: FileChangeStatus;
  previousPath?: string;
  additions?: number;
  deletions?: number;
}

export interface RepoChanges {
  branch: string;
  status: RepoStatus;
  files: GitFileChange[];
}

// 🚀 Performance: Cache repo changes to avoid repeated expensive git operations
// TTL of 5 seconds is fresh enough for UI interactions while preventing rapid re-computation
const repoChangesCache = new LRUCache<string, RepoChanges>({
  max: 100, // Cache up to 100 different repo paths
  ttl: 5000, // 5 seconds - balances freshness with performance
});

export interface RepoFileDiff {
  path: string;
  previousPath?: string;
  status: FileChangeStatus;
  patch: string;
  additions?: number;
  deletions?: number;
}

export interface RepoCommitChange {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authoredAt: string;
  additions: number;
  deletions: number;
}

export interface RepoCommitDiff {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authoredAt: string;
  patch: string;
  additions: number;
  deletions: number;
}

export interface RepoDeliveryStatus {
  branch: string;
  baseBranch?: string;
  baseRef?: string;
  status: RepoStatus;
  commitsSinceBase: number;
  hasCommitsSinceBase: boolean;
  /** True when HEAD is an ancestor of base (changes already merged back). */
  isMergedIntoBase: boolean;
  hasUncommittedChanges: boolean;
  remoteUrl: string | null;
  isGitHubRepo: boolean;
  isGitLabRepo: boolean;
  canCreatePullRequest: boolean;
}

/**
 * Check if a directory is a git repository.
 */
export function isGitRepository(dir: string): boolean {
  try {
    gitExecSync(["rev-parse", "--git-dir"], dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a git repository path is a bare repository without a worktree.
 */
export function isBareGitRepository(dir: string): boolean {
  try {
    return gitExecSync(["rev-parse", "--is-bare-repository"], dir) === "true";
  } catch {
    return false;
  }
}

function supportsGitWorktreeOperations(repoPath: string): boolean {
  return isGitRepository(repoPath) && !isBareGitRepository(repoPath);
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(repoPath: string): string | null {
  try {
    const branch = gitExecSync(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * Get the full SHA of the current HEAD commit.
 */
export function getHeadSha(repoPath: string): string | null {
  try {
    const sha = gitExecSync(["rev-parse", "HEAD"], repoPath);
    return sha || null;
  } catch {
    return null;
  }
}

export interface HeadCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authoredAt: string;
}

/**
 * Get HEAD commit details: SHA, message, author, date.
 */
export function getHeadCommitInfo(repoPath: string): HeadCommitInfo | null {
  try {
    const output = gitExecSync(
      ["show", "-s", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI", "HEAD"],
      repoPath,
    );
    if (!output) return null;
    const [sha, shortSha, message, authorName, authoredAt] = output.split("\x1f");
    if (!sha || !shortSha) return null;
    return { sha, shortSha, message: message ?? "", authorName: authorName ?? "", authoredAt: authoredAt ?? "" };
  } catch {
    return null;
  }
}

/**
 * Get commit details for an arbitrary ref (e.g. "origin/main", "origin/private").
 */
export function getRefCommitInfo(repoPath: string, ref: string): HeadCommitInfo | null {
  try {
    const output = gitExecSync(
      ["show", "-s", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI", ref],
      repoPath,
    );
    if (!output) return null;
    const [sha, shortSha, message, authorName, authoredAt] = output.split("\x1f");
    if (!sha || !shortSha) return null;
    return { sha, shortSha, message: message ?? "", authorName: authorName ?? "", authoredAt: authoredAt ?? "" };
  } catch {
    return null;
  }
}

/**
 * List local branches.
 */
export function listBranches(repoPath: string): string[] {
  try {
    const output = gitExecSync(["branch", "--format=%(refname:short)"], repoPath);
    return output
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get branch info for a repo: current branch + all local branches.
 */
export function getBranchInfo(repoPath: string): RepoBranchInfo {
  return {
    current: getCurrentBranch(repoPath) ?? "unknown",
    branches: listBranches(repoPath),
  };
}

/**
 * Checkout a branch. Returns false if the branch doesn't exist locally.
 * Use createAndCheckoutBranch() if you need to create a new branch.
 */
export function checkoutBranch(repoPath: string, branch: string): boolean {
  if (!supportsGitWorktreeOperations(repoPath)) {
    return false;
  }

  try {
    gitExecSync(["checkout", branch], repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create and checkout a new branch from the specified start point.
 * Callers must explicitly opt-in to branch creation — no implicit fallback.
 */
export function createAndCheckoutBranch(
  repoPath: string,
  branch: string,
  startPoint?: string,
): boolean {
  if (!supportsGitWorktreeOperations(repoPath)) {
    return false;
  }
  try {
    const args = startPoint
      ? ["checkout", "-b", branch, startPoint]
      : ["checkout", "-b", branch];
    gitExecSync(args, repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the worktree directory path for a given branch.
 * Returns null if the branch is not checked out by any worktree.
 */
function findWorktreePathForBranch(repoPath: string, branch: string): string | null {
  try {
    const output = gitExecSync(["worktree", "list", "--porcelain"], repoPath);
    let currentPath = "";
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.substring("worktree ".length);
      } else if (line === `branch refs/heads/${branch}`) {
        return currentPath;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete a local branch. Handles bare repos and worktree-occupied branches.
 * Refuses to delete the currently checked out branch.
 */
export function deleteBranch(repoPath: string, branch: string): { success: boolean; error?: string } {
  const currentBranch = getCurrentBranch(repoPath);
  if (currentBranch === branch) {
    return { success: false, error: `Cannot delete the current branch '${branch}'` };
  }

  const localBranches = listBranches(repoPath);
  if (!localBranches.includes(branch)) {
    return { success: false, error: `Branch '${branch}' not found` };
  }

  try {
    gitExecSync(["branch", "-D", branch], repoPath);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Branch is checked out by a worktree — detach it first, then retry.
    // Git 2.x emits "checked out at '<path>'" (not always "worktree").
    if (msg.includes("worktree") || msg.includes("checked out at")) {
      const wtPath = findWorktreePathForBranch(repoPath, branch);
      if (wtPath) {
        try {
          gitExecSync(["worktree", "remove", "--force", wtPath], repoPath);
          gitExecSync(["worktree", "prune"], repoPath);
          gitExecSync(["branch", "-D", branch], repoPath);
          return { success: true };
        } catch (retryErr) {
          return {
            success: false,
            error: retryErr instanceof Error
              ? retryErr.message
              : `Failed to delete branch '${branch}' after worktree removal`,
          };
        }
      }
    }

    return {
      success: false,
      error: msg || `Failed to delete branch '${branch}'`,
    };
  }
}

/**
 * Get short repo status summary.
 */
export interface RepoStatus {
  clean: boolean;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
}

export function getRepoStatus(repoPath: string): RepoStatus {
  const status: RepoStatus = {
    clean: true,
    ahead: 0,
    behind: 0,
    modified: 0,
    untracked: 0,
  };

  if (supportsGitWorktreeOperations(repoPath)) {
    try {
      const output = gitExecSync(["status", "--porcelain", "-uall"], repoPath);
      const lines = output.split("\n").filter(Boolean);
      status.modified = lines.filter((l) => !l.startsWith("??")).length;
      status.untracked = lines.filter((l) => l.startsWith("??")).length;
      status.clean = lines.length === 0;
    } catch {
      // ignore
    }
  }

  try {
    const aheadBehind = gitExecSync(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], repoPath);
    const [ahead, behind] = aheadBehind.split(/\s+/).map(Number);
    status.ahead = ahead || 0;
    status.behind = behind || 0;
  } catch {
    // no upstream
  }

  return status;
}

function mapPorcelainStatus(code: string): FileChangeStatus {
  if (code === "??") return "untracked";
  const [indexStatus = " ", worktreeStatus = " "] = code.split("");

  if (indexStatus === "U" || worktreeStatus === "U" || code === "AA" || code === "DD") {
    return "conflicted";
  }
  if (indexStatus === "R" || worktreeStatus === "R") return "renamed";
  if (indexStatus === "C" || worktreeStatus === "C") return "copied";
  if (indexStatus === "A" || worktreeStatus === "A") return "added";
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
  if (indexStatus === "T" || worktreeStatus === "T") return "typechange";
  return "modified";
}

export function parseGitStatusPorcelain(output: string): GitFileChange[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line): GitFileChange[] => {
      if (line.length < 3) return [];

      const code = line.slice(0, 2);
      if (code === "!!") return [];

      const rawPath = line.slice(3);
      const status = mapPorcelainStatus(code);

      if ((status === "renamed" || status === "copied") && rawPath.includes(" -> ")) {
        const [previousPath, nextPath] = rawPath.split(" -> ");
        if (previousPath && nextPath) {
          return [{ path: nextPath, previousPath, status }];
        }
      }

      return [{ path: rawPath, status }];
    });
}

export function getRepoChanges(repoPath: string): RepoChanges {
  // 🚀 Check cache first (5-second TTL)
  const cacheKey = `${repoPath}:${Math.floor(Date.now() / 5000)}`; // 5-second buckets
  const cached = repoChangesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const branch = getCurrentBranch(repoPath) ?? "unknown";
  const status = getRepoStatus(repoPath);

  if (!supportsGitWorktreeOperations(repoPath)) {
    return {
      branch,
      status,
      files: [],
    };
  }

  try {
    const output = gitExecSync(["status", "--porcelain", "-uall"], repoPath);
    const parsedFiles = parseGitStatusPorcelain(output);

    // 🚀 Performance optimization: batch fetch all file stats at once
    // instead of running git diff for each file individually
    const batchStats = batchGetRepoFileStats(repoPath);

    let syntheticUntrackedStatsCount = 0;
    let totalStatsCalculated = 0;

    const files = parsedFiles.map((file) => {
      // 🛡️ Global limit: Skip detailed stats if we've processed too many files
      if (totalStatsCalculated >= MAX_CHANGED_FILES_WITH_DETAILED_STATS) {
        return file;
      }

      // First try to get stats from batch result
      const batchStat = batchStats.get(file.path);
      if (batchStat) {
        totalStatsCalculated++;
        return {
          ...file,
          ...batchStat,
        };
      }

      // Fallback to synthetic stats for special cases
      if (file.status === "untracked") {
        syntheticUntrackedStatsCount += 1;
        if (syntheticUntrackedStatsCount > MAX_UNTRACKED_FILES_WITH_SYNTHETIC_STATS) {
          return file; // Skip stats for too many untracked files
        }
      }

      // For files not in batch results (e.g., untracked, renamed),
      // compute stats using individual file logic
      try {
        totalStatsCalculated++;
        return {
          ...file,
          ...getRepoFileLineStats(repoPath, file),
        };
      } catch {
        return file;
      }
    });

    const result: RepoChanges = {
      branch,
      status,
      files,
    };

    // 🚀 Store in cache
    repoChangesCache.set(cacheKey, result);

    return result;
  } catch {
    return {
      branch,
      status,
      files: [],
    };
  }
}

function buildSyntheticAddedDiff(repoPath: string, file: GitFileChange): string {
  const absolutePath = path.join(repoPath, file.path);
  const content = fs.readFileSync(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  const lineCount = content.length === 0 ? 0 : lines.length;
  const hunkHeader = `@@ -0,0 +1,${lineCount} @@`;

  return [
    `diff --git a/${file.path} b/${file.path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file.path}`,
    hunkHeader,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

function buildSyntheticRenameDiff(file: GitFileChange): string {
  return [
    `diff --git a/${file.previousPath ?? file.path} b/${file.path}`,
    "similarity index 100%",
    `rename from ${file.previousPath ?? file.path}`,
    `rename to ${file.path}`,
  ].join("\n");
}

function getFirstNonEmptyGitDiff(repoPath: string, commands: string[][]): string {
  for (const command of commands) {
    try {
      const patch = gitExecSync(command, repoPath);
      if (patch.trim()) {
        return patch;
      }
    } catch {
      // Ignore and try the next diff variant.
    }
  }

  return "";
}

function countDiffPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }

  return { additions, deletions };
}

const NUMSTAT_EXCLUDED_PATTERNS = [
  /^node_modules\//,
  /\/node_modules\//,
  /^\.next\//,
  /\/\.next\//,
  /^target\//,
  /\/target\//,
  /^storybook-static\//,
  /\/storybook-static\//,
  /^\.routa\//,
  /\/\.routa\//,
  /^\.worktrees\//,
  /\/\.worktrees\//,
  /^\.entrix\//,
  /\/\.entrix\//,
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
];

function isNumstatExcludedPath(filePath: string): boolean {
  return NUMSTAT_EXCLUDED_PATTERNS.some((p) => p.test(filePath));
}

function countNumstatTotals(output: string, { excludeGenerated = true }: { excludeGenerated?: boolean } = {}): { additions: number; deletions: number } {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (!excludeGenerated) return true;
      const parts = line.split(/\s+/);
      const filePath = parts[2];
      return filePath ? !isNumstatExcludedPath(filePath) : true;
    })
    .reduce((totals, line) => {
      const [rawAdditions, rawDeletions] = line.split(/\s+/);
      const additions = rawAdditions === "-" ? 0 : Number.parseInt(rawAdditions ?? "", 10);
      const deletions = rawDeletions === "-" ? 0 : Number.parseInt(rawDeletions ?? "", 10);
      return {
        additions: totals.additions + (Number.isNaN(additions) ? 0 : additions),
        deletions: totals.deletions + (Number.isNaN(deletions) ? 0 : deletions),
      };
    }, { additions: 0, deletions: 0 });
}

function parseNumstat(output: string): { additions: number; deletions: number } | null {
  const firstLine = output
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;

  const [rawAdditions, rawDeletions] = firstLine.split(/\s+/);
  const additions = rawAdditions === "-" ? 0 : Number.parseInt(rawAdditions ?? "", 10);
  const deletions = rawDeletions === "-" ? 0 : Number.parseInt(rawDeletions ?? "", 10);

  if (Number.isNaN(additions) || Number.isNaN(deletions)) return null;
  return { additions, deletions };
}

/**
 * Parse numstat output into a map of file path -> stats.
 * Handles renamed files by using the new path as the key.
 *
 * Example numstat output:
 *   10  5   src/foo.ts
 *   20  0   src/bar.ts
 *   15  3   src/{old.ts => new.ts}
 */
function parseNumstatToMap(output: string): Map<string, { additions: number; deletions: number }> {
  const statsMap = new Map<string, { additions: number; deletions: number }>();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;

    const [rawAdditions, rawDeletions, ...pathParts] = parts;
    const additions = rawAdditions === "-" ? 0 : Number.parseInt(rawAdditions, 10);
    const deletions = rawDeletions === "-" ? 0 : Number.parseInt(rawDeletions, 10);

    if (Number.isNaN(additions) || Number.isNaN(deletions)) continue;

    const pathStr = pathParts.join(" ");

    // Handle renamed files: "src/{old.ts => new.ts}" -> "src/new.ts"
    const renameMatch = pathStr.match(/^(.*)?\{.*\s*=>\s*([^}]+)\}(.*)$/);
    if (renameMatch) {
      const [, prefix = "", newName, suffix = ""] = renameMatch;
      const newPath = `${prefix}${newName.trim()}${suffix}`;
      statsMap.set(newPath, { additions, deletions });
    } else {
      statsMap.set(pathStr, { additions, deletions });
    }
  }

  return statsMap;
}

/**
 * Batch fetch file statistics for all changed files using a single git diff command.
 * This is dramatically faster than calling git diff for each file individually.
 *
 * Strategy:
 * 1. Try unstaged changes (git diff --numstat)
 * 2. If no results, try staged changes (git diff --cached --numstat)
 * 3. If no results, try all changes vs HEAD (git diff HEAD --numstat)
 *
 * Returns a map of file path -> { additions, deletions }
 */
function batchGetRepoFileStats(repoPath: string): Map<string, { additions: number; deletions: number }> {
  const commands = [
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "--numstat"],
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "--cached", "--numstat"],
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "HEAD", "--numstat"],
  ];

  const combinedStats = new Map<string, { additions: number; deletions: number }>();

  for (const command of commands) {
    try {
      const output = gitExecSync(command, repoPath);
      if (output.trim()) {
        const stats = parseNumstatToMap(output);
        // Merge stats, preferring earlier (more specific) results
        for (const [path, stat] of stats.entries()) {
          if (!combinedStats.has(path)) {
            combinedStats.set(path, stat);
          }
        }
      }
    } catch {
      // Ignore errors and try next command
    }
  }

  return combinedStats;
}

function getRepoFileLineStats(repoPath: string, file: GitFileChange): { additions: number; deletions: number } {
  const numstat = getFirstNonEmptyGitDiff(repoPath, [
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "--numstat", "--", file.path],
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "--cached", "--numstat", "--", file.path],
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "HEAD", "--numstat", "--", file.path],
  ]);
  const parsedNumstat = parseNumstat(numstat);
  if (parsedNumstat) return parsedNumstat;

  if (file.status === "untracked" || file.status === "added") {
    return countDiffPatchLines(buildSyntheticAddedDiff(repoPath, file));
  }

  if (file.status === "renamed" && file.previousPath) {
    return countDiffPatchLines(buildSyntheticRenameDiff(file));
  }

  return { additions: 0, deletions: 0 };
}

export function getRepoFileDiff(repoPath: string, file: GitFileChange): RepoFileDiff {
  const patch = getFirstNonEmptyGitDiff(repoPath, [
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "--", file.path],
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "--cached", "--", file.path],
    ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "HEAD", "--", file.path],
  ]);

  if (patch) {
    const counts = countDiffPatchLines(patch);
    return {
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      patch,
      additions: counts.additions,
      deletions: counts.deletions,
    };
  }

  if (file.status === "untracked" || file.status === "added") {
    const syntheticPatch = buildSyntheticAddedDiff(repoPath, file);
    const counts = countDiffPatchLines(syntheticPatch);
    return {
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      patch: syntheticPatch,
      additions: counts.additions,
      deletions: counts.deletions,
    };
  }

  if (file.status === "renamed" && file.previousPath) {
    const syntheticPatch = buildSyntheticRenameDiff(file);
    const counts = countDiffPatchLines(syntheticPatch);
    return {
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      patch: syntheticPatch,
      additions: counts.additions,
      deletions: counts.deletions,
    };
  }

  return {
    path: file.path,
    previousPath: file.previousPath,
    status: file.status,
    patch: "",
    additions: 0,
    deletions: 0,
  };
}

export function getRepoCommitChanges(
  repoPath: string,
  options: { baseRef: string; maxCount?: number },
): RepoCommitChange[] {
  const maxCount = Math.max(1, options.maxCount ?? 20);
  const range = `${options.baseRef}..HEAD`;
  const output = (() => {
    try {
      return gitExecSync(
        ["log", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI", range, "-n", String(maxCount)],
        repoPath,
      );
    } catch {
      return null;
    }
  })();
  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\u001f"))
    .flatMap((parts): RepoCommitChange[] => {
      const [sha, shortSha, summary, authorName, authoredAt] = parts;
      if (!sha || !shortSha || !summary || !authorName || !authoredAt) return [];

      const numstat = (() => {
        try {
          return gitExecSync(
            ["--no-pager", "show", "--format=", "--numstat", "--find-renames", "--find-copies", sha],
            repoPath,
          );
        } catch {
          return "";
        }
      })();
      const counts = countNumstatTotals(numstat);

      return [{
        sha,
        shortSha,
        summary,
        authorName,
        authoredAt,
        additions: counts.additions,
        deletions: counts.deletions,
      }];
    });
}

export function getRepoCommitDiff(
  repoPath: string,
  sha: string,
  options?: { context?: "preview" | "full" },
): RepoCommitDiff {
  const unifiedContext = options?.context === "full" ? 1_000_000 : 3;
  const summary = gitExecSync(["show", "-s", "--format=%s", sha], repoPath);
  const shortSha = gitExecSync(["rev-parse", "--short", sha], repoPath);
  const authorName = gitExecSync(["show", "-s", "--format=%an", sha], repoPath);
  const authoredAt = gitExecSync(["show", "-s", "--format=%aI", sha], repoPath);
  const patch = gitExecSync(
    ["--no-pager", "show", "--no-ext-diff", "--find-renames", "--find-copies", "--format=medium", `--unified=${unifiedContext}`, sha],
    repoPath,
  );
  const counts = countDiffPatchLines(patch);

  return {
    sha,
    shortSha,
    summary,
    authorName,
    authoredAt,
    patch,
    additions: counts.additions,
    deletions: counts.deletions,
  };
}

export function getRepoDeliveryStatus(
  repoPath: string,
  options?: {
    baseBranch?: string | null;
    codebaseDefaultBranch?: string | null;
    sourceType?: "local" | "github" | "gitlab";
    sourceUrl?: string | null;
  },
): RepoDeliveryStatus {
  const branch = getCurrentBranch(repoPath) ?? "unknown";
  const status = getRepoStatus(repoPath);
  const remoteUrl = getRemoteUrl(repoPath);
  const baseRef = resolveBaseRef(repoPath, options?.baseBranch, options?.codebaseDefaultBranch);
  const normalizedBaseBranch = options?.baseBranch?.trim() || baseRef?.replace(/^origin\//, "");
  let commitsSinceBase = status.ahead;

  if (baseRef) {
    try {
      commitsSinceBase = Number.parseInt(
        gitExecSync(["rev-list", "--count", `${baseRef}..HEAD`], repoPath),
        10,
      ) || 0;
    } catch {
      commitsSinceBase = status.ahead;
    }
  }

  const hasUncommittedChanges = !status.clean || status.modified > 0 || status.untracked > 0;
  const isGitHubRepo = options?.sourceType === "github"
    || Boolean(options?.sourceUrl && isGitHubUrl(options.sourceUrl))
    || Boolean(remoteUrl && isGitHubUrl(remoteUrl));
  const isGitLabRepo = options?.sourceType === "gitlab"
    || Boolean(options?.sourceUrl && isGitLabUrl(options.sourceUrl))
    || Boolean(remoteUrl && isGitLabUrl(remoteUrl));
  const isVCSRepo = isGitHubRepo || isGitLabRepo;
  const hasCommitsSinceBase = commitsSinceBase > 0;
  const canCreatePullRequest = isVCSRepo
    && hasCommitsSinceBase
    && !hasUncommittedChanges
    && Boolean(branch)
    && Boolean(normalizedBaseBranch)
    && branch !== normalizedBaseBranch;

  // Detect if changes have already been merged back into the base branch.
  // When HEAD is an ancestor of baseRef, `git merge-base --is-ancestor` succeeds
  // meaning the feature branch content exists in the base already.
  let isMergedIntoBase = false;
  if (baseRef) {
    try {
      gitExecSync(["merge-base", "--is-ancestor", "HEAD", baseRef], repoPath);
      isMergedIntoBase = true;
    } catch {
      // Not an ancestor — changes not yet merged
    }
  }

  return {
    branch,
    baseBranch: normalizedBaseBranch,
    baseRef,
    status,
    commitsSinceBase,
    hasCommitsSinceBase,
    isMergedIntoBase,
    hasUncommittedChanges,
    remoteUrl,
    isGitHubRepo,
    isGitLabRepo,
    canCreatePullRequest,
  };
}

// ─── Repo Directory Helpers ─────────────────────────────────────────────

const CLONE_BASE_DIR = ".routa/repos";

/**
 * Get the base directory for cloned repos.
 * On serverless environments (Vercel), uses /tmp since the deployment is read-only.
 */
export function getCloneBaseDir(): string {
  const pathMod = require("path");
  const os = require("os");

  // Check if we're in a serverless environment (Vercel sets VERCEL env var)
  const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    // On serverless, use /tmp which is the only writable location
    // Note: This is ephemeral and won't persist across invocations
    return pathMod.join(os.tmpdir(), CLONE_BASE_DIR);
  }

  // On local/traditional servers, use the current directory
  const bridge = getServerBridge();
  return pathMod.join(bridge.env.currentDir(), CLONE_BASE_DIR);
}

/**
 * Convert owner/repo to directory name.
 */
export function repoToDirName(owner: string, repo: string): string {
  return `${owner}--${repo}`;
}

/**
 * Convert directory name back to owner/repo.
 */
export function dirNameToRepo(dirName: string): string {
  const parts = dirName.split("--");
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : dirName;
}

export interface ClonedRepoInfo {
  name: string;
  path: string;
  dirName: string;
  branch: string;
  branches: string[];
  status: RepoStatus;
}

/**
 * List all cloned repos with their branch/status info.
 */
export function listClonedRepos(): ClonedRepoInfo[] {
  const pathMod = require("path");
  const bridge = getServerBridge();
  const baseDir = getCloneBaseDir();
  if (!bridge.fs.existsSync(baseDir)) return [];

  const entries = bridge.fs.readDirSync(baseDir);
  return entries
    .filter((e) => e.isDirectory)
    .map((e) => {
      const fullPath = pathMod.join(baseDir, e.name);
      const branchInfo = getBranchInfo(fullPath);
      const repoStatus = getRepoStatus(fullPath);
      return {
        name: dirNameToRepo(e.name),
        path: fullPath,
        dirName: e.name,
        branch: branchInfo.current,
        branches: branchInfo.branches,
        status: repoStatus,
      };
    });
}

// ─── Remote Branches ────────────────────────────────────────────────────

/**
 * List remote branches (requires fetch first).
 */
export function listRemoteBranches(repoPath: string): string[] {
  try {
    const output = gitExecSync(["branch", "-r", "--format=%(refname:short)"], repoPath);
    return output
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
      .filter((b) => !b.includes("HEAD"))
      .map((b) => b.replace(/^origin\//, ""));
  } catch {
    return [];
  }
}

/**
 * Fetch remote branches from origin.
 */
export function fetchRemote(repoPath: string): boolean {
  try {
    gitExecSync(["fetch", "--all", "--prune"], repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch remote refs, then fast-forward every local branch to its
 * corresponding remote tracking branch (origin/<branch>).
 *
 * Bare repos: uses `git update-ref` to move branch pointers directly
 * since merge/checkout/reset require a working tree.
 *
 * Regular repos: --ff-only refuses to move if divergent; forceReset
 * falls back to hard reset.
 *
 * Designed for base repos where routa never commits directly — keeping
 * `main`/`private` in sync ensures new worktrees start from latest code.
 */
export function fetchAndFastForward(
  repoPath: string,
  options?: { forceReset?: boolean },
): { fetched: boolean; synced: string[]; forced: string[]; skipped: string[] } {
  let fetched = false;
  try {
    gitExecSync(["fetch", "--all", "--prune"], repoPath);
    fetched = true;
  } catch { /* proceed with existing refs */ }

  const synced: string[] = [];
  const forced: string[] = [];
  const skipped: string[] = [];
  const branches = listBranches(repoPath);

  for (const branch of branches) {
    if (isGhostBranchPattern(branch)) {
      skipped.push(branch);
      continue;
    }

    const remoteRef = `refs/remotes/origin/${branch}`;
    const localRef = `refs/heads/${branch}`;

    if (!hasGitRef(repoPath, remoteRef)) {
      skipped.push(branch);
      continue;
    }

    try {
      if (options?.forceReset) {
        gitExecSync(["update-ref", localRef, remoteRef], repoPath);
        forced.push(branch);
      } else {
        const localSha = gitExecSync(["rev-parse", localRef], repoPath);
        const remoteSha = gitExecSync(["rev-parse", remoteRef], repoPath);
        if (isAncestorOf(repoPath, localSha, remoteSha)) {
          gitExecSync(["update-ref", localRef, remoteRef], repoPath);
          synced.push(branch);
        } else {
          skipped.push(branch);
        }
      }
    } catch {
      skipped.push(branch);
    }
  }

  normalizeHeadToDefault(repoPath);

  return { fetched, synced, forced, skipped };
}

function isAncestorOf(repoPath: string, ancestor: string, descendant: string): boolean {
  try {
    gitExecSync(["merge-base", "--is-ancestor", ancestor, descendant], repoPath);
    return true;
  } catch {
    return false;
  }
}

function isGhostBranchPattern(branch: string): boolean {
  const ghostPatterns = [
    /^remote-/,
    /^origin\//,
    /-origin$/,
    /^main-(?!$)/,
  ];
  return ghostPatterns.some((p) => p.test(branch));
}

function normalizeHeadToDefault(repoPath: string): void {
  try {
    const current = gitExecSync(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
    if (current !== "main") {
      gitExecSync(["checkout", "main"], repoPath);
    }
  } catch {
    try {
      gitExecSync(["checkout", "main"], repoPath);
    } catch { /* best-effort */ }
  }
}

export function cleanupGhostBranches(repoPath: string): string[] {
  const deleted: string[] = [];
  const localBranches = listBranches(repoPath);

  for (const branch of localBranches) {
    if (!isGhostBranchPattern(branch)) continue;

    const remoteRef = `refs/remotes/origin/${branch}`;
    if (hasGitRef(repoPath, remoteRef)) continue;

    try {
      const current = gitExecSync(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
      if (current === branch) {
        gitExecSync(["checkout", "main"], repoPath);
      }
    } catch { /* HEAD detached */ }

    try {
      gitExecSync(["branch", "-D", branch], repoPath);
      deleted.push(branch);
    } catch { /* skip */ }
  }

  return deleted;
}

/**
 * Get branch status: commits ahead/behind upstream.
 */
export interface BranchStatus {
  ahead: number;
  behind: number;
  hasUncommittedChanges: boolean;
}

export function getBranchStatus(
  repoPath: string,
  branch: string
): BranchStatus {
  const result: BranchStatus = {
    ahead: 0,
    behind: 0,
    hasUncommittedChanges: false,
  };

  try {
    const aheadBehind = gitExecSync(
      ["rev-list", "--left-right", "--count", `${branch}...origin/${branch}`],
      repoPath
    );
    const [ahead, behind] = aheadBehind.split(/\s+/).map(Number);
    result.ahead = ahead || 0;
    result.behind = behind || 0;
  } catch {
    // no upstream or branch doesn't exist on remote - this is expected
  }

  if (supportsGitWorktreeOperations(repoPath)) {
    try {
      const status = gitExecSync(["status", "--porcelain", "-uall"], repoPath);
      result.hasUncommittedChanges = status.trim().length > 0;
    } catch {
      // ignore
    }
  }

  return result;
}

/**
 * Pull latest changes for the current branch.
 */
export function pullBranch(repoPath: string): { success: boolean; error?: string } {
  try {
    gitExecSync(["pull", "--ff-only"], repoPath);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Pull failed",
    };
  }
}

/**
 * Safe pull: stash → pull --ff-only → stash pop.
 * Handles dirty working trees that would block a regular pull.
 */
export function stashPullPop(repoPath: string): { success: boolean; error?: string } {
  try {
    // Check if there are local changes that need stashing
    const statusOutput = gitExecSync(["status", "--porcelain"], repoPath);
    const hasLocalChanges = statusOutput.trim().length > 0;

    if (hasLocalChanges) {
      gitExecSync(["stash", "--include-untracked"], repoPath);
    }

    try {
      gitExecSync(["pull", "--ff-only"], repoPath);
    } finally {
      if (hasLocalChanges) {
        try {
          gitExecSync(["stash", "pop"], repoPath);
        } catch {
          // Stash pop conflict — leave stash intact, don't fail the pull
        }
      }
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Pull failed",
    };
  }
}

/**
 * Reset tracked and untracked local changes to match HEAD.
 */
export function resetLocalChanges(repoPath: string): { success: boolean; error?: string } {
  if (!supportsGitWorktreeOperations(repoPath)) {
    return { success: false, error: "Repository path points to a bare git repo. Reset requires a worktree." };
  }

  try {
    gitExecSync(["reset", "--hard", "HEAD"], repoPath);
    gitExecSync(["clean", "-fd"], repoPath);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Reset failed",
    };
  }
}

/**
 * Get the remote URL for the repo.
 */
export function getRemoteUrl(repoPath: string): string | null {
  try {
    return gitExecSync(["remote", "get-url", "origin"], repoPath) || null;
  } catch {
    return null;
  }
}

// ─── Branch Validation (consistent with intent-source) ──────────────────

export interface BranchValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

/**
 * Validate a branch name.
 */
export function validateBranchName(branch: string): BranchValidationResult {
  if (!branch || branch.trim().length === 0) {
    return { valid: false, error: "Branch name is required" };
  }

  const trimmed = branch.trim();

  // Invalid characters
  const invalidChars = /[\s~^:?*[\]\\]/;
  if (invalidChars.test(trimmed)) {
    return {
      valid: false,
      error: "Branch name contains invalid characters",
      suggestion: "Use only letters, numbers, hyphens, underscores, and forward slashes",
    };
  }

  // Reserved names
  if (["HEAD", ".", ".."].includes(trimmed)) {
    return { valid: false, error: "Branch name is reserved" };
  }

  // Consecutive dots or slashes
  if (trimmed.includes("..") || trimmed.includes("//")) {
    return { valid: false, error: "Branch name cannot contain consecutive dots or slashes" };
  }

  // Starts or ends with slash
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return { valid: false, error: "Branch name cannot start or end with a slash" };
  }

  // Ends with .lock
  if (trimmed.endsWith(".lock")) {
    return { valid: false, error: "Branch name cannot end with .lock" };
  }

  return { valid: true };
}

/**
 * Sanitize a branch name to make it valid.
 */
export function sanitizeBranchName(branch: string): string {
  return branch
    .trim()
    .replace(/[\s~^:?*[\]\\]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/|\/$/g, "")
    .replace(/\.lock$/, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

// ─── Workspace Validation ───────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
  warning?: string;
  isGitHub?: boolean;
  isRemote?: boolean;
  parsed?: ParsedVCSUrl;
}

/**
 * Expand `~` and resolve relative local repo paths against the current cwd.
 */
export function normalizeLocalRepoPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const bridge = getServerBridge();
  const homeDir = bridge.env.homeDir();

  if (trimmed === "~") {
    return homeDir;
  }

  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const suffix = trimmed.slice(2);
    return path.join(homeDir, suffix);
  }

  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }

  return path.resolve(bridge.env.currentDir(), trimmed);
}

/**
 * Validate a repository path or VCS URL (GitHub / GitLab).
 */
export function validateRepoInput(input: string): ValidationResult {
  if (!input || input.trim().length === 0) {
    return {
      valid: false,
      error: "Repository path or URL is required",
      suggestion: "Enter a repository URL (e.g. https://github.com/owner/repo, https://gitlab.com/owner/repo) or owner/repo",
    };
  }

  const trimmed = input.trim();

  // Check if it's a GitHub URL
  if (isGitHubUrl(trimmed)) {
    const parsed = parseGitHubUrl(trimmed);
    if (!parsed) {
      return {
        valid: false,
        error: "Invalid GitHub URL format",
        suggestion: "Use format: https://github.com/owner/repo or owner/repo",
      };
    }
    return {
      valid: true,
      isGitHub: true,
      isRemote: true,
      parsed,
    };
  }

  // Check if it's a GitLab URL
  if (isGitLabUrl(trimmed)) {
    const parsed = parseVCSUrl(trimmed);
    if (!parsed) {
      return {
        valid: false,
        error: "Invalid GitLab URL format",
        suggestion: "Use format: https://gitlab.com/owner/repo",
      };
    }
    return {
      valid: true,
      isRemote: true,
      parsed,
    };
  }

  // Local path
  const normalizedPath = normalizeLocalRepoPath(trimmed);
  const bridge = getServerBridge();
  if (bridge.fs.existsSync(normalizedPath)) {
    if (isGitRepository(normalizedPath)) {
      return { valid: true };
    }
    return {
      valid: false,
      error: "Directory exists but is not a git repository",
      suggestion: "Initialize a git repository first or choose a different directory",
    };
  }

  return {
    valid: false,
    error: "Path not found and not a recognized repository URL",
    suggestion: "Enter a repository URL (GitHub / GitLab) or an existing local path",
  };
}
