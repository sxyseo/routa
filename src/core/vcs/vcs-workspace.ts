/**
 * VCS Virtual Workspace
 *
 * Platform-agnostic workspace management for browsing VCS repositories.
 * Uses the VCS Provider abstraction to download archives from GitHub or GitLab,
 * then extracts and caches them locally for file browsing, search, etc.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { safeTmpdir } from "@/core/utils/safe-tmpdir";

import { getVCSProvider } from "./vcs-provider";

// ─── Types ───────────────────────────────────────────────────────────────

export interface VCSImportOptions {
  owner: string;
  repo: string;
  ref?: string;
  token?: string;
  maxSizeMB?: number;
}

export interface VirtualFileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  children?: VirtualFileEntry[];
}

export interface VCSWorkspace {
  owner: string;
  repo: string;
  ref: string;
  extractedPath: string;
  importedAt: Date;
  fileCount: number;

  getTree(): VirtualFileEntry[];
  readFile(filePath: string): string;
  exists(filePath: string): boolean;
  search(query: string, limit?: number): Array<{ path: string; name: string; score: number }>;
  dispose(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_MAX_SIZE_MB = 200;
const WORKSPACE_TTL_MS = 60 * 60 * 1000; // 1 hour
const EXTRACT_BASE = path.join(safeTmpdir(), "routa-vcs");

const IGNORE_PATTERNS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".cache",
  "coverage", ".turbo", "target", "__pycache__", ".venv", "venv",
]);

// ─── In-memory workspace registry ────────────────────────────────────────

interface WorkspaceEntry {
  workspace: VCSWorkspace;
  expiresAt: number;
}

const REGISTRY_KEY = "__routa_vcs_registry__";
const CLEANUP_TIMER_KEY = "__routa_vcs_cleanup_timer__";
if (!(globalThis as Record<string, unknown>)[REGISTRY_KEY]) {
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] = new Map<string, WorkspaceEntry>();
}
const registry = (globalThis as Record<string, unknown>)[REGISTRY_KEY] as Map<string, WorkspaceEntry>;

export function workspaceKey(owner: string, repo: string, ref: string): string {
  return `${owner}/${repo}@${ref}`;
}

/** Get a cached workspace if still valid */
export function getCachedWorkspace(owner: string, repo: string, ref: string): VCSWorkspace | null {
  const key = workspaceKey(owner, repo, ref);
  const entry = registry.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    entry.workspace.dispose();
    registry.delete(key);
    return null;
  }
  return entry.workspace;
}

/** Evict expired workspaces */
export function cleanupExpired(): number {
  let cleaned = 0;
  for (const [key, entry] of registry) {
    if (Date.now() > entry.expiresAt) {
      entry.workspace.dispose();
      registry.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

/** Start periodic cleanup (every 30 minutes) */
export function startVCSWorkspaceCleanup(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[CLEANUP_TIMER_KEY]) return;
  g[CLEANUP_TIMER_KEY] = setInterval(() => { cleanupExpired(); }, 30 * 60 * 1000);
}

/** Stop periodic cleanup */
export function stopVCSWorkspaceCleanup(): void {
  const g = globalThis as Record<string, unknown>;
  const timer = g[CLEANUP_TIMER_KEY] as ReturnType<typeof setInterval> | undefined;
  if (timer) {
    clearInterval(timer);
    g[CLEANUP_TIMER_KEY] = undefined;
  }
}

// ─── Core: Download & Extract ────────────────────────────────────────────

/**
 * Import a VCS repository by downloading its archive via the VCS provider.
 * Returns a VCSWorkspace for browsing files.
 */
export async function importVCSRepo(options: VCSImportOptions): Promise<VCSWorkspace> {
  const { owner, repo, ref = "HEAD", token, maxSizeMB = DEFAULT_MAX_SIZE_MB } = options;

  // Check cache first
  const cached = getCachedWorkspace(owner, repo, ref);
  if (cached) return cached;

  // Evict stale entries before importing
  cleanupExpired();

  // Download archive via VCS provider
  const provider = getVCSProvider();
  const zipBuffer = await downloadArchive(provider, owner, repo, ref, token, maxSizeMB);

  // Extract to /tmp
  const extractedPath = await extractZip(zipBuffer, owner, repo);

  // Build workspace
  const fileIndex = buildFileIndex(extractedPath);
  const workspace = createWorkspaceHandle(owner, repo, ref, extractedPath, fileIndex);

  // Cache it
  registry.set(workspaceKey(owner, repo, ref), {
    workspace,
    expiresAt: Date.now() + WORKSPACE_TTL_MS,
  });

  return workspace;
}

async function downloadArchive(
  provider: ReturnType<typeof getVCSProvider>,
  owner: string,
  repo: string,
  ref: string,
  token?: string,
  maxSizeMB = DEFAULT_MAX_SIZE_MB,
): Promise<Buffer> {
  const fullRepo = `${owner}/${repo}`;
  const buf = await provider.downloadArchive({ repo: fullRepo, ref, token });

  const actualMB = buf.byteLength / (1024 * 1024);
  if (actualMB > maxSizeMB) {
    throw new VCSWorkspaceError(
      `Repository too large: ${actualMB.toFixed(1)}MB exceeds ${maxSizeMB}MB limit`,
      "TOO_LARGE",
    );
  }

  return buf;
}

async function extractZip(zipBuffer: Buffer, owner: string, repo: string): Promise<string> {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(zipBuffer);

  // Ensure base extraction directory exists
  fs.mkdirSync(EXTRACT_BASE, { recursive: true });

  const targetDir = path.join(EXTRACT_BASE, `${owner}--${repo}`);

  // Clean previous extraction if exists
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  // Extract to a temp dir first, then find the repo root
  const tmpDir = fs.mkdtempSync(path.join(safeTmpdir(), "routa-vcs-extract-"));
  try {
    zip.extractAllTo(tmpDir, true);

    // Archives typically have a single top-level directory
    const topDirs = fs.readdirSync(tmpDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (topDirs.length === 0) {
      // No top-level dir — files are at root
      return tmpDir;
    }

    const repoRoot = path.join(tmpDir, topDirs[0].name);

    // Move to stable path — renameSync fails across devices (EXDEV)
    try {
      fs.renameSync(repoRoot, targetDir);
    } catch (renameErr: unknown) {
      if ((renameErr as NodeJS.ErrnoException).code === "EXDEV") {
        fs.cpSync(repoRoot, targetDir, { recursive: true });
        fs.rmSync(repoRoot, { recursive: true, force: true });
      } else {
        throw renameErr;
      }
    }

    return targetDir;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

// ─── File Index ──────────────────────────────────────────────────────────

interface FileIndex {
  tree: VirtualFileEntry[];
  paths: string[];
  fileCount: number;
}

function buildFileIndex(rootDir: string): FileIndex {
  const paths: string[] = [];
  const tree = scanDirectory(rootDir, rootDir, paths);
  return { tree, paths, fileCount: paths.length };
}

function scanDirectory(dir: string, rootDir: string, paths: string[]): VirtualFileEntry[] {
  const entries: VirtualFileEntry[] = [];

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return entries;
  }

  dirEntries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of dirEntries) {
    if (IGNORE_PATTERNS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      const children = scanDirectory(fullPath, rootDir, paths);
      entries.push({
        path: relativePath,
        name: entry.name,
        isDirectory: true,
        children,
      });
    } else if (entry.isFile()) {
      let size: number | undefined;
      try {
        size = fs.statSync(fullPath).size;
      } catch {
        // skip
      }
      paths.push(relativePath);
      entries.push({
        path: relativePath,
        name: entry.name,
        isDirectory: false,
        size,
      });
    }
  }

  return entries;
}

// ─── Workspace Handle ────────────────────────────────────────────────────

function createWorkspaceHandle(
  owner: string,
  repo: string,
  ref: string,
  extractedPath: string,
  index: FileIndex,
): VCSWorkspace {
  return {
    owner,
    repo,
    ref,
    extractedPath,
    importedAt: new Date(),
    fileCount: index.fileCount,

    getTree() {
      return index.tree;
    },

    readFile(filePath: string): string {
      const absPath = path.resolve(extractedPath, filePath);
      if (!absPath.startsWith(extractedPath + path.sep) && absPath !== extractedPath) {
        throw new VCSWorkspaceError(`Path traversal denied: ${filePath}`, "FORBIDDEN");
      }
      if (!fs.existsSync(absPath)) {
        throw new VCSWorkspaceError(`File not found: ${filePath}`, "NOT_FOUND");
      }
      return fs.readFileSync(absPath, "utf-8");
    },

    exists(filePath: string): boolean {
      const absPath = path.resolve(extractedPath, filePath);
      if (!absPath.startsWith(extractedPath + path.sep) && absPath !== extractedPath) {
        return false;
      }
      return fs.existsSync(absPath);
    },

    search(query: string, limit = 20): Array<{ path: string; name: string; score: number }> {
      if (!query.trim()) {
        return index.paths.slice(0, limit).map((p) => ({
          path: p,
          name: path.basename(p),
          score: 0,
        }));
      }

      const queryLower = query.toLowerCase();
      const results: Array<{ path: string; name: string; score: number }> = [];

      for (const filePath of index.paths) {
        const score = fuzzyScore(queryLower, filePath.toLowerCase(), path.basename(filePath).toLowerCase());
        if (score > 0) {
          results.push({ path: filePath, name: path.basename(filePath), score });
        }
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    },

    dispose() {
      try {
        if (fs.existsSync(extractedPath)) {
          fs.rmSync(extractedPath, { recursive: true, force: true });
        }
      } catch {
        // best-effort
      }
    },
  };
}

// ─── Fuzzy Search ────────────────────────────────────────────────────────

function fuzzyScore(query: string, target: string, fileName: string): number {
  if (target === query) return 1000;
  if (target.includes(query)) {
    if (fileName.startsWith(query)) return 900;
    if (fileName.includes(query)) return 800;
    return 700;
  }

  let score = 0;
  let qi = 0;
  let consecutive = 0;

  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] === query[qi]) {
      score += 10 + consecutive;
      consecutive += 5;
      qi++;
    } else {
      consecutive = 0;
    }
  }

  return qi < query.length ? 0 : score + Math.max(0, 100 - target.length);
}

// ─── Error ───────────────────────────────────────────────────────────────

export type VCSWorkspaceErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "DOWNLOAD_FAILED"
  | "TOO_LARGE"
  | "EXTRACT_FAILED";

export class VCSWorkspaceError extends Error {
  constructor(
    message: string,
    public code: VCSWorkspaceErrorCode,
  ) {
    super(message);
    this.name = "VCSWorkspaceError";
  }
}

// ─── Utility: list all active workspaces ─────────────────────────────────

export function listActiveWorkspaces(): Array<{
  key: string;
  owner: string;
  repo: string;
  ref: string;
  fileCount: number;
  importedAt: Date;
  expiresAt: Date;
}> {
  cleanupExpired();
  const result: Array<{
    key: string;
    owner: string;
    repo: string;
    ref: string;
    fileCount: number;
    importedAt: Date;
    expiresAt: Date;
  }> = [];

  for (const [key, entry] of registry) {
    const ws = entry.workspace;
    result.push({
      key,
      owner: ws.owner,
      repo: ws.repo,
      ref: ws.ref,
      fileCount: ws.fileCount,
      importedAt: ws.importedAt,
      expiresAt: new Date(entry.expiresAt),
    });
  }

  return result;
}
