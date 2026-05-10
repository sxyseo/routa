/**
 * Frontend Coverage Scanner — deterministic check for empty shell pages.
 *
 * Scans worktree for frontend page files (.vue, .tsx, etc.), identifies empty
 * shells, and reports which pages lack corresponding implementation tasks.
 * Used by workflow-orchestrator to auto-create missing frontend tasks.
 */

import * as fs from "fs";
import * as path from "path";

// Note: uses a local walkFiles implementation (same pattern as pre-gate-checker)

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FrontendPageInfo {
  filePath: string;
  pageName: string;
  isEmpty: boolean;
  lineCount: number;
}

export interface FrontendCoverageReport {
  totalPages: number;
  emptyPages: FrontendPageInfo[];
  implementedPages: FrontendPageInfo[];
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = [".vue", ".tsx", ".jsx", ".svelte"];
const DEFAULT_MIN_LINES = 15;
const BUILTIN_EXCLUDE = new Set(["node_modules", ".nuxt", "dist", ".git", "demo"]);
const SHELL_PATTERN = /待实现|placeholder|todo.*implement|TBD|待实现页面/i;

function* walkFiles(dir: string, excludeDirs?: ReadonlySet<string>): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (BUILTIN_EXCLUDE.has(entry.name) || excludeDirs?.has(entry.name)) continue;
      yield* walkFiles(path.join(dir, entry.name), excludeDirs);
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

function basenameWithoutExt(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function guessPageName(filePath: string): string {
  const name = basenameWithoutExt(filePath);
  // Convert kebab/camelCase to readable: "order-detail" → "Order Detail"
  return name
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Main scanner ───────────────────────────────────────────────────────────

export function scanFrontendCoverage(
  repoRoot: string,
  options?: {
    extensions?: string[];
    minLines?: number;
    excludeDirs?: string[];
  },
): FrontendCoverageReport {
  const extensions = new Set(options?.extensions ?? DEFAULT_EXTENSIONS);
  const minLines = options?.minLines ?? DEFAULT_MIN_LINES;
  const excludeSet = options?.excludeDirs?.length ? new Set(options.excludeDirs) : undefined;

  if (!repoRoot || !fs.existsSync(repoRoot)) {
    return { totalPages: 0, emptyPages: [], implementedPages: [] };
  }

  const emptyPages: FrontendPageInfo[] = [];
  const implementedPages: FrontendPageInfo[] = [];

  for (const filePath of walkFiles(repoRoot, excludeSet)) {
    if (!extensions.has(path.extname(filePath))) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lineCount = content.split("\n").length;
    const isEmpty = lineCount <= minLines || SHELL_PATTERN.test(content);

    const info: FrontendPageInfo = {
      filePath: path.relative(repoRoot, filePath),
      pageName: guessPageName(filePath),
      isEmpty,
      lineCount,
    };

    if (isEmpty) {
      emptyPages.push(info);
    } else {
      implementedPages.push(info);
    }
  }

  return {
    totalPages: emptyPages.length + implementedPages.length,
    emptyPages,
    implementedPages,
  };
}

/**
 * Generate a task title and objective for an empty frontend page.
 */
export function generateTaskDescription(page: FrontendPageInfo): {
  title: string;
  objective: string;
} {
  const title = `[前端] 实现 ${page.pageName} 页面`;
  const objective =
    `实现 ${page.filePath} 页面。当前为空壳文件（${page.lineCount} 行），` +
    `需要替换为完整的 Vue3/uni-app 页面实现，渲染真实 API 数据，无"待实现"占位符。` +
    `参考 demo/handoff/02-组件映射表.md 中对应页面的数据来源和交互要求。`;
  return { title, objective };
}
