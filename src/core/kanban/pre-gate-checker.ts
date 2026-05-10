/**
 * Pre-Gate Checker — cross-platform deterministic verification.
 *
 * Pure Node.js — no shell commands for file scanning (Windows-safe).
 * Only tsc/entrix use execSync (optional, graceful degradation).
 *
 * Rules sourced from:
 *   1. Constitution compiler (iron rules C1–C10)
 *   2. spec-files.json forbiddenTerms
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  compileConstitutionRules,
  getIronRules,
  type ConstitutionRule,
} from "../constitution/constitution-compiler";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PreGateViolation {
  rule: string;
  severity: "BLOCKER" | "WARNING";
  file: string;
  line?: number;
  message: string;
}

export interface PreGateResult {
  passed: boolean;
  blockers: PreGateViolation[];
  warnings: PreGateViolation[];
}

export interface PreGateConfig {
  repoRoot: string;
  forbiddenTerms?: Record<string, string>;
  /** Extensions to check for empty shells */
  emptyShellExtensions?: string[];
  /** Line count threshold for "empty" */
  emptyShellMinLines?: number;
  skipTsc?: boolean;
  /** Directory names to skip during recursive walk (in addition to built-in defaults) */
  excludeDirs?: string[];
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_EMPTY_SHELL_EXTENSIONS = [".vue", ".tsx", ".jsx", ".svelte"];
const DEFAULT_EMPTY_SHELL_MIN_LINES = 15;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const BUILTIN_EXCLUDE_DIRS = new Set(["node_modules", ".nuxt", "dist", ".git"]);

// ─── Cross-platform file scanner ───────────────────────────────────────────

/**
 * Recursively walk a directory, yielding file paths.
 * Excludes built-in directories (node_modules, .nuxt, dist, .git) plus any extra names.
 */
function* walkFiles(dir: string, excludeDirs?: ReadonlySet<string>): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (BUILTIN_EXCLUDE_DIRS.has(entry.name) || excludeDirs?.has(entry.name)) continue;
      yield* walkFiles(path.join(dir, entry.name), excludeDirs);
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

/** Check if a file path is a test or config file (should be excluded from production checks). */
function isTestOrConfig(filePath: string): boolean {
  return filePath.includes("__tests__")
    || filePath.includes(".test.")
    || filePath.includes(".spec.")
    || filePath.includes(".d.ts");
}

/** Check if file extension matches source patterns. */
function isSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath);
  return SOURCE_EXTENSIONS.has(ext);
}

// ─── Scanners (pure Node.js, no shell) ─────────────────────────────────────

function scanForPattern(
  repoRoot: string,
  pattern: RegExp,
  options: {
    fileFilter?: (filePath: string) => boolean;
    fileGlob?: string;
    severity: "BLOCKER" | "WARNING";
    ruleId: string;
    messageFn: (filePath: string, lineNum: number, lineContent: string, match: RegExpExecArray) => string;
  },
  excludeDirs?: ReadonlySet<string>,
): PreGateViolation[] {
  const violations: PreGateViolation[] = [];
  const srcDir = path.join(repoRoot, "src");
  const scanDir = fs.existsSync(srcDir) ? srcDir : repoRoot;

  for (const filePath of walkFiles(scanDir, excludeDirs)) {
    // File glob filter (e.g., "schema.ts" means only check that file)
    if (options.fileGlob && path.basename(filePath) !== options.fileGlob) continue;
    // Source file filter
    if (options.fileFilter && !options.fileFilter(filePath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = pattern.exec(line);
      if (match) {
        violations.push({
          rule: options.ruleId,
          severity: options.severity,
          file: path.relative(repoRoot, filePath),
          line: i + 1,
          message: options.messageFn(filePath, i + 1, line, match),
        });
      }
    }
  }

  return violations;
}

function checkForbiddenTerms(
  repoRoot: string,
  terms: Record<string, string>,
  excludeDirs?: ReadonlySet<string>,
): PreGateViolation[] {
  const violations: PreGateViolation[] = [];

  for (const [term, reason] of Object.entries(terms)) {
    const pattern = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    const termViolations = scanForPattern(repoRoot, pattern, {
      fileFilter: (fp) => isSourceFile(fp) && !isTestOrConfig(fp),
      severity: "BLOCKER",
      ruleId: "forbidden-term",
      messageFn: (fp, ln, line, _m) =>
        `Forbidden term "${term}" at line ${ln}: ${reason}. Content: ${line.trim()}`,
    }, excludeDirs);
    violations.push(...termViolations);
  }

  return violations;
}

function checkEmptyFiles(
  repoRoot: string,
  extensions: string[],
  minLines: number,
  excludeDirs?: ReadonlySet<string>,
): PreGateViolation[] {
  const violations: PreGateViolation[] = [];
  const extSet = new Set(extensions);

  for (const filePath of walkFiles(repoRoot, excludeDirs)) {
    if (!extSet.has(path.extname(filePath))) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lineCount = content.split("\n").length;
    if (lineCount <= minLines) {
      const isShell = /待实现|placeholder|todo.*implement|TBD|待实现页面/i.test(content);
      violations.push({
        rule: "empty-file",
        severity: isShell ? "BLOCKER" : "WARNING",
        file: path.relative(repoRoot, filePath),
        message: `${path.basename(filePath)} has only ${lineCount} lines${isShell ? " (placeholder/shell)" : ""}. Minimum expected: ${minLines + 1}`,
      });
    }
  }

  return violations;
}

function checkConsoleLog(repoRoot: string, excludeDirs?: ReadonlySet<string>): PreGateViolation[] {
  return scanForPattern(repoRoot, /console\.log\s*\(/, {
    fileFilter: (fp) => isSourceFile(fp) && !isTestOrConfig(fp),
    severity: "WARNING",
    ruleId: "C10",
    messageFn: (_fp, _ln, line, _m) =>
      `console.log found in production code (C10: use logger instead): ${line.trim()}`,
  }, excludeDirs);
}

function checkResSend(repoRoot: string, excludeDirs?: ReadonlySet<string>): PreGateViolation[] {
  return scanForPattern(repoRoot, /res\.send\s*\(/, {
    fileFilter: (fp) => isSourceFile(fp) && !isTestOrConfig(fp),
    severity: "BLOCKER",
    ruleId: "C9",
    messageFn: (_fp, _ln, line, _m) =>
      `res.send() used instead of res.json() (C9: unified response format): ${line.trim()}`,
  }, excludeDirs);
}

function checkTsc(repoRoot: string): PreGateViolation[] {
  const violations: PreGateViolation[] = [];
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return violations;

  try {
    execSync("npx tsc --noEmit 2>&1", {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    const output = (err as any).stdout ?? (err as any).message ?? "";
    const errorCount = (output.match(/error TS/g) || []).length;
    if (errorCount > 0) {
      violations.push({
        rule: "tsc",
        severity: errorCount > 5 ? "BLOCKER" : "WARNING",
        file: "tsconfig.json",
        message: `TypeScript compilation failed with ${errorCount} error(s). First errors:\n${output.split("\n").slice(0, 5).join("\n")}`,
      });
    }
  }

  return violations;
}

// ─── Constitution-driven checks ─────────────────────────────────────────────

function checkConstitutionRules(
  repoRoot: string,
  rules: ConstitutionRule[],
  excludeDirs?: ReadonlySet<string>,
): PreGateViolation[] {
  const violations: PreGateViolation[] = [];

  for (const rule of rules) {
    switch (rule.checkType) {
      case "forbidden_term": {
        if (!rule.forbiddenTerms) break;
        const terms: Record<string, string> = {};
        for (const term of rule.forbiddenTerms) {
          terms[term] = rule.description;
        }
        violations.push(...checkForbiddenTerms(repoRoot, terms, excludeDirs));
        break;
      }
      case "grep": {
        if (!rule.pattern) break;
        const regex = new RegExp(rule.pattern.replace(/\(/g, "\\(").replace(/\)/g, "\\)"));
        violations.push(...scanForPattern(repoRoot, regex, {
          fileFilter: (fp) => isSourceFile(fp) && !isTestOrConfig(fp),
          fileGlob: rule.fileGlob,
          severity: rule.severity === "iron" ? "BLOCKER" : "WARNING",
          ruleId: rule.id,
          messageFn: (_fp, _ln, line, _m) =>
            `${rule.title}: ${rule.description}: ${line.trim()}`,
        }, excludeDirs));
        break;
      }
      case "regex": {
        if (!rule.pattern) break;
        const regex = new RegExp(rule.pattern);
        violations.push(...scanForPattern(repoRoot, regex, {
          fileFilter: (fp) => isSourceFile(fp) && !isTestOrConfig(fp),
          fileGlob: rule.fileGlob,
          severity: rule.severity === "iron" ? "BLOCKER" : "WARNING",
          ruleId: rule.id,
          messageFn: (_fp, _ln, line, _m) =>
            `${rule.title}: ${rule.description}: ${line.trim()}`,
        }, excludeDirs));
        break;
      }
      // "command" type rules (like tsc) are handled separately
    }
  }

  return violations;
}

// ─── Entrix Integration (optional, uses execSync) ──────────────────────────

function runEntrixChecks(repoRoot: string): PreGateViolation[] {
  const violations: PreGateViolation[] = [];
  try {
    const output = execSync("entrix check --format sarif-json 2>&1", {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    let sarif: any;
    try { sarif = JSON.parse(output); } catch { return violations; }
    const results = sarif?.runs?.[0]?.results;
    if (!Array.isArray(results)) return violations;
    for (const result of results) {
      const level = result.level ?? "warning";
      const ruleId = result.ruleId ?? "entrix";
      const message = result.message?.text ?? "Entrix fitness check violation";
      const severity: "BLOCKER" | "WARNING" = level === "error" ? "BLOCKER" : "WARNING";
      const artifactLocation = result.locations?.[0]?.physicalLocation?.artifactLocation;
      const filePath = artifactLocation?.uri
        ? path.relative(repoRoot, artifactLocation.uri.replace("file://", ""))
        : "unknown";
      const lineNum = result.locations?.[0]?.physicalLocation?.region?.startLine;
      violations.push({ rule: `entrix:${ruleId}`, severity, file: filePath, line: lineNum, message });
    }
  } catch {
    // Entrix not installed — graceful degradation
  }
  return violations;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runPreGateChecks(
  task: { worktreeId?: string; workspaceId?: string },
  config: PreGateConfig,
): Promise<PreGateResult> {
  const {
    repoRoot,
    forbiddenTerms,
    emptyShellExtensions,
    emptyShellMinLines,
    skipTsc,
    excludeDirs,
  } = config;

  if (!repoRoot || !fs.existsSync(repoRoot)) {
    return { passed: true, blockers: [], warnings: [] };
  }

  const violations: PreGateViolation[] = [];
  const excludeSet = excludeDirs?.length ? new Set(excludeDirs) : undefined;

  // 1. Constitution-compiled rules (C1–C10 + spec-files.json)
  const constitutionRules = compileConstitutionRules({ forbiddenTerms });
  const ironRules = getIronRules(constitutionRules);
  violations.push(...checkConstitutionRules(repoRoot, ironRules, excludeSet));

  // 2. Empty shell files (cross-platform walk)
  violations.push(
    ...checkEmptyFiles(
      repoRoot,
      emptyShellExtensions ?? DEFAULT_EMPTY_SHELL_EXTENSIONS,
      emptyShellMinLines ?? DEFAULT_EMPTY_SHELL_MIN_LINES,
      excludeSet,
    ),
  );

  // 3. Built-in fast checks (already covered by constitution for C9/C10,
  //    but keep as safety net in case constitution rules are misconfigured)
  violations.push(...checkConsoleLog(repoRoot, excludeSet));
  violations.push(...checkResSend(repoRoot, excludeSet));

  // 4. tsc --noEmit (optional, uses execSync but tsc is cross-platform)
  if (!skipTsc) {
    violations.push(...checkTsc(repoRoot));
  }

  // 5. Entrix (optional, graceful no-op if not installed)
  violations.push(...runEntrixChecks(repoRoot));

  const blockers = violations.filter((v) => v.severity === "BLOCKER");
  const warnings = violations.filter((v) => v.severity === "WARNING");

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function loadSpecFilesConfig(
  repoRoot: string,
): { forbiddenTerms?: Record<string, string>; excludeDirs?: string[] } {
  const specFilesPath = path.join(repoRoot, ".routa", "spec-files.json");
  if (!fs.existsSync(specFilesPath)) return {};
  try {
    const content = fs.readFileSync(specFilesPath, "utf-8");
    const parsed = JSON.parse(content) as {
      forbiddenTerms?: Record<string, string>;
      excludeDirs?: string[];
    };
    return { forbiddenTerms: parsed.forbiddenTerms, excludeDirs: parsed.excludeDirs };
  } catch {
    return {};
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
