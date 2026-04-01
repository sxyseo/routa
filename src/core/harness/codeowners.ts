import { execSync } from "child_process";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { minimatch } from "minimatch";
import yaml from "js-yaml";
import type {
  CodeownersOwner,
  CodeownersResponse,
  CodeownersRule,
  OwnerGroupSummary,
  OwnerKind,
  OwnershipMatch,
} from "./codeowners-types";

const CODEOWNERS_CANDIDATES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

const SENSITIVE_PATH_PREFIXES = [
  "src/core/acp/",
  "src/core/orchestration/",
  "crates/routa-server/src/api/",
];

const SENSITIVE_FILES = [
  "api-contract.yaml",
  "docs/fitness/manifest.yaml",
  "docs/fitness/review-triggers.yaml",
  ".github/workflows/defense.yaml",
];

function classifyOwner(raw: string): CodeownersOwner {
  const trimmed = raw.trim();
  let kind: OwnerKind;
  if (trimmed.includes("@") && trimmed.includes("/")) {
    kind = "team";
  } else if (trimmed.includes("@") && trimmed.includes(".")) {
    kind = "email";
  } else {
    kind = "user";
  }
  return { name: trimmed, kind };
}

export function parseCodeownersContent(content: string): { rules: CodeownersRule[]; warnings: string[] } {
  const rules: CodeownersRule[] = [];
  const warnings: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;

    const tokens = line.split(/\s+/);
    if (tokens.length < 2) {
      warnings.push(`Line ${i + 1}: pattern without owners — "${line}"`);
      continue;
    }

    const [pattern, ...ownerTokens] = tokens;
    const owners = ownerTokens.map(classifyOwner);

    rules.push({
      pattern,
      owners,
      line: i + 1,
      precedence: rules.length,
    });
  }

  return { rules, warnings };
}

function normalizePattern(pattern: string): string {
  if (pattern.startsWith("/")) {
    return pattern.slice(1);
  }
  if (!pattern.includes("/")) {
    return `**/${pattern}`;
  }
  return pattern;
}

export function matchFileToRule(filePath: string, rules: CodeownersRule[]): CodeownersRule | null {
  let bestMatch: CodeownersRule | null = null;
  for (const rule of rules) {
    const normalized = normalizePattern(rule.pattern);
    const isDir = rule.pattern.endsWith("/");
    const matchPattern = isDir ? `${normalized}**` : normalized;

    if (minimatch(filePath, matchPattern, { dot: true })) {
      if (!bestMatch || rule.precedence > bestMatch.precedence) {
        bestMatch = rule;
      }
    }
  }
  return bestMatch;
}

function findAllMatchingRules(filePath: string, rules: CodeownersRule[]): CodeownersRule[] {
  return rules.filter((rule) => {
    const normalized = normalizePattern(rule.pattern);
    const isDir = rule.pattern.endsWith("/");
    const matchPattern = isDir ? `${normalized}**` : normalized;
    return minimatch(filePath, matchPattern, { dot: true });
  });
}

export function resolveOwnership(filePaths: string[], rules: CodeownersRule[]): OwnershipMatch[] {
  return filePaths.map((filePath) => {
    const matchingRules = findAllMatchingRules(filePath, rules);
    const bestRule = matchFileToRule(filePath, rules);
    const overlap = matchingRules.length > 1;

    return {
      filePath,
      owners: bestRule?.owners ?? [],
      matchedRule: bestRule,
      overlap,
      covered: bestRule !== null,
    };
  });
}

function isSensitivePath(filePath: string): boolean {
  return (
    SENSITIVE_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    SENSITIVE_FILES.includes(filePath)
  );
}

function loadSensitivePathsFromTriggers(repoRoot: string, warnings: string[]): string[] {
  const triggersPath = path.join(repoRoot, "docs", "fitness", "review-triggers.yaml");
  if (!fs.existsSync(triggersPath)) return [];

  try {
    const raw = fs.readFileSync(triggersPath, "utf-8");
    const parsed = yaml.load(raw) as { review_triggers?: Array<{ paths?: string[] }> } | null;
    if (!parsed?.review_triggers) return [];

    const paths = new Set<string>();
    for (const trigger of parsed.review_triggers) {
      if (trigger.paths) {
        for (const p of trigger.paths) {
          paths.add(p.replace(/\*\*.*$/, "").replace(/\*$/, ""));
        }
      }
    }
    return [...paths].filter((p) => p.length > 0);
  } catch {
    warnings.push("Failed to parse review-triggers.yaml for sensitive path extraction.");
    return [];
  }
}

function collectTrackedFiles(repoRoot: string, warnings: string[]): string[] {
  try {
    const output = execSync("git ls-files", { cwd: repoRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    return output.trim().split("\n").filter((line: string) => line.length > 0);
  } catch {
    warnings.push("Failed to list git-tracked files. Coverage analysis may be incomplete.");
    return [];
  }
}

export async function detectCodeowners(repoRoot: string): Promise<CodeownersResponse> {
  const warnings: string[] = [];

  const codeownersFile = CODEOWNERS_CANDIDATES.find((candidate) =>
    fs.existsSync(path.join(repoRoot, candidate)),
  ) ?? null;

  if (!codeownersFile) {
    return {
      generatedAt: new Date().toISOString(),
      repoRoot,
      codeownersFile: null,
      owners: [],
      rules: [],
      coverage: {
        unownedFiles: [],
        overlappingFiles: [],
        sensitiveUnownedFiles: [],
      },
      warnings: ["No CODEOWNERS file found. Checked: " + CODEOWNERS_CANDIDATES.join(", ")],
    };
  }

  const content = await fsp.readFile(path.join(repoRoot, codeownersFile), "utf-8");
  const { rules, warnings: parseWarnings } = parseCodeownersContent(content);
  warnings.push(...parseWarnings);

  const trackedFiles = collectTrackedFiles(repoRoot, warnings);
  const matches = resolveOwnership(trackedFiles, rules);

  const ownerCounts = new Map<string, { kind: OwnerKind; count: number }>();
  for (const match of matches) {
    for (const owner of match.owners) {
      const existing = ownerCounts.get(owner.name);
      if (existing) {
        existing.count++;
      } else {
        ownerCounts.set(owner.name, { kind: owner.kind, count: 1 });
      }
    }
  }

  const ownerGroups: OwnerGroupSummary[] = [...ownerCounts.entries()]
    .map(([name, { kind, count }]) => ({ name, kind, matchedFileCount: count }))
    .sort((a, b) => b.matchedFileCount - a.matchedFileCount);

  const unownedFiles = matches
    .filter((m) => !m.covered)
    .map((m) => m.filePath);

  const overlappingFiles = matches
    .filter((m) => m.overlap)
    .map((m) => m.filePath);

  const sensitiveUnownedFiles = unownedFiles.filter(isSensitivePath);

  const dynamicSensitivePrefixes = loadSensitivePathsFromTriggers(repoRoot, warnings);
  for (const file of unownedFiles) {
    if (!sensitiveUnownedFiles.includes(file)) {
      if (dynamicSensitivePrefixes.some((prefix) => file.startsWith(prefix))) {
        sensitiveUnownedFiles.push(file);
      }
    }
  }

  const MAX_REPORT_FILES = 50;

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    codeownersFile,
    owners: ownerGroups,
    rules: rules.map((r) => ({
      pattern: r.pattern,
      owners: r.owners.map((o) => o.name),
      line: r.line,
      precedence: r.precedence,
    })),
    coverage: {
      unownedFiles: unownedFiles.slice(0, MAX_REPORT_FILES),
      overlappingFiles: overlappingFiles.slice(0, MAX_REPORT_FILES),
      sensitiveUnownedFiles,
    },
    warnings,
  };
}
