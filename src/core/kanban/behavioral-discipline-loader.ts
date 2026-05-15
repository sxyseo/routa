/**
 * Behavioral Discipline Loader
 *
 * Loads agent behavioral rules with a three-tier priority system
 * (mirrors the specialist loading architecture):
 *
 *   1. Workspace metadata DB field (UI-edited)         — highest
 *   2. Project directory file                           — medium
 *   3. Bundled default (resources/prompts/)             — lowest
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BehavioralDisciplineSource {
  /** Where the discipline was loaded from, for diagnostics. */
  source: "database" | "project-file" | "bundled" | "none";
  /** The discipline content (empty string if none found). */
  content: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Project-level file paths to check, in order. */
const PROJECT_FILE_CANDIDATES = [
  ".routa/agent-behavioral-discipline.md",
  "agent-behavioral-discipline.md",
];

/** Sentinel value that explicitly disables discipline injection. */
const DISABLE_SENTINEL = "NONE";

/** Section heading used to extract from AGENTS.md. */
const AGENTS_MD_SECTION_PATTERN = /##\s+Behavioral\s+Discipline/i;

/** Maximum discipline content length to prevent prompt overflow. */
const MAX_DISCIPLINE_LENGTH = 5000;

// ─── Cache ──────────────────────────────────────────────────────────────────

let _bundledCache: string | null = null;

function loadBundledDefault(): string {
  if (_bundledCache !== null) return _bundledCache;
  try {
    const filePath = resolve(__dirname, "../../resources/prompts/agent-behavioral-discipline.md");
    _bundledCache = readFileSync(filePath, "utf-8").trim();
  } catch {
    _bundledCache = "";
  }
  return _bundledCache;
}

/** Invalidate the bundled discipline cache (for hot-reload scenarios). */
export function invalidateBundledDisciplineCache(): void {
  _bundledCache = null;
}

// ─── Extraction Helpers ─────────────────────────────────────────────────────

/**
 * Check if content is the explicit disable sentinel.
 */
function isDisabled(content: string): boolean {
  return content.trim().toUpperCase() === DISABLE_SENTINEL;
}

/**
 * Truncate content to the maximum allowed length.
 */
function clampLength(content: string): string {
  if (content.length <= MAX_DISCIPLINE_LENGTH) return content;
  return content.slice(0, MAX_DISCIPLINE_LENGTH) + "\n...[truncated]";
}

/**
 * Extract the "## Behavioral Discipline" section from an AGENTS.md file.
 * Returns everything from that heading to the next ## heading (same level) or EOF.
 */
function extractFromAgentsMd(content: string): string {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((line) => AGENTS_MD_SECTION_PATTERN.test(line));
  if (startIdx === -1) return "";

  const result: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    // Stop at the next top-level heading (## but not ### or deeper)
    if (i > startIdx && /^## [^#]/.test(lines[i]) && !AGENTS_MD_SECTION_PATTERN.test(lines[i])) {
      break;
    }
    result.push(lines[i]);
  }
  return result.join("\n").trim();
}

/**
 * Try to load discipline from project directory files.
 */
function loadFromProjectDir(cwd: string): string | null {
  // Check dedicated files first
  for (const candidate of PROJECT_FILE_CANDIDATES) {
    const filePath = join(cwd, candidate);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8").trim();
        if (content) return content;
      } catch { /* fall through */ }
    }
  }

  // Fall back to extracting from AGENTS.md
  const agentsMdPath = join(cwd, "AGENTS.md");
  if (existsSync(agentsMdPath)) {
    try {
      const content = readFileSync(agentsMdPath, "utf-8");
      const section = extractFromAgentsMd(content);
      if (section) return section;
    } catch { /* fall through */ }
  }

  return null;
}

// ─── Main Loader ────────────────────────────────────────────────────────────

/**
 * Load behavioral discipline with three-tier priority.
 *
 * @param workspaceMetadata - workspace.metadata record (for database tier)
 * @param cwd               - project working directory (for file tier)
 * @returns source and content
 */
export function resolveBehavioralDiscipline(
  workspaceMetadata?: Record<string, string>,
  cwd?: string,
): BehavioralDisciplineSource {
  // Tier 1: Database (UI-edited)
  if (workspaceMetadata) {
    const dbContent = workspaceMetadata["behavioralDiscipline"]?.trim();
    if (dbContent) {
      if (isDisabled(dbContent)) {
        return { source: "database", content: "" };
      }
      return { source: "database", content: clampLength(dbContent) };
    }
  }

  // Tier 2: Project directory files
  if (cwd) {
    const projectContent = loadFromProjectDir(cwd);
    if (projectContent) {
      if (isDisabled(projectContent)) {
        return { source: "project-file", content: "" };
      }
      return { source: "project-file", content: clampLength(projectContent) };
    }
  }

  // Tier 3: Bundled default
  const bundled = loadBundledDefault();
  if (bundled) {
    return { source: "bundled", content: bundled };
  }

  return { source: "none", content: "" };
}
