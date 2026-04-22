import { gitExec } from "@/core/utils/safe-exec";
import { resolveGitHubRepo } from "@/core/kanban/github-issues";
import { readFeatureSurfaceIndex } from "@/core/spec/feature-surface-index";
import {
  loadTaskAdaptiveFrictionProfiles,
  refreshTaskAdaptiveFrictionProfiles,
  type TaskAdaptiveFrictionProfile,
  type TaskAdaptiveFrictionProfileSnapshot,
} from "@/core/harness/task-adaptive";

export const TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER = "<!-- routa:task-adaptive-issue-summary -->";

export type TaskAdaptiveIssueSummarySource = "cached" | "refreshed";

export interface TaskAdaptiveIssueFailureCategoryCount {
  category: string;
  count: number;
}

export interface TaskAdaptiveIssueFeatureSummary {
  featureId: string;
  featureName: string;
  sessionCount: number;
  fileCount: number;
  updatedAt: string;
  topFiles: string[];
  failureCategories: TaskAdaptiveIssueFailureCategoryCount[];
}

export interface TaskAdaptiveIssueFileSummary {
  filePath: string;
  featureIds: string[];
  sessionCount: number;
  updatedAt: string;
  failureCategories: TaskAdaptiveIssueFailureCategoryCount[];
}

export interface TaskAdaptiveIssueSummary {
  generatedAt: string;
  source: TaskAdaptiveIssueSummarySource;
  repo: {
    root: string;
    githubRepo?: string;
    branch?: string;
    commit?: string;
  };
  thresholds: {
    minFileSessions: number;
    minFeatureSessions: number;
  };
  counts: {
    featureProfiles: number;
    fileProfiles: number;
  };
  topFailureCategories: TaskAdaptiveIssueFailureCategoryCount[];
  topFeatures: TaskAdaptiveIssueFeatureSummary[];
  topFiles: TaskAdaptiveIssueFileSummary[];
  warnings: string[];
}

export interface BuildTaskAdaptiveIssueSummaryOptions {
  refresh?: boolean;
  maxFeatures?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_FEATURES = 8;
const DEFAULT_MAX_FILES = 12;
const MAX_TOP_FILES_PER_FEATURE = 5;

function trimTo<T>(values: T[], max: number): T[] {
  return values.slice(0, Math.max(0, max));
}

function uniquePreserveOrder(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function collectFailureCategories(
  failures: Array<{ message: string; command?: string }>,
): TaskAdaptiveIssueFailureCategoryCount[] {
  const counts = new Map<string, number>();

  for (const failure of failures) {
    const category = categorizeFailure(failure.message, failure.command);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

function categorizeFailure(message: string, command?: string): string {
  const combined = `${message} ${command ?? ""}`.toLowerCase();

  if (combined.includes("no matches found")) {
    return "shell_glob_path";
  }
  if (
    combined.includes("command not found")
    || combined.includes("cannot find package")
    || combined.includes("unresolved_import")
    || combined.includes("could not resolve")
  ) {
    return "missing_dependency";
  }
  if (combined.includes("node_modules") && combined.includes("no such file")) {
    return "missing_installation";
  }
  if (combined.includes("operation not permitted") || combined.includes("permission denied")) {
    return "permission_or_worktree";
  }
  if (
    combined.includes("no such file or directory")
    || combined.includes("not found")
    || combined.includes("enoent")
  ) {
    return "missing_file_or_path";
  }
  if (combined.includes("connection refused") || combined.includes("econnrefused")) {
    return "service_unavailable";
  }

  return "tooling_failure";
}

function summarizeFeatureProfile(profile: TaskAdaptiveFrictionProfile): TaskAdaptiveIssueFeatureSummary {
  return {
    featureId: profile.targetId,
    featureName: profile.featureName?.trim() || profile.targetLabel.trim() || profile.targetId,
    sessionCount: profile.matchedSessionIds.length,
    fileCount: profile.selectedFiles.length,
    updatedAt: profile.updatedAt,
    topFiles: trimTo(uniquePreserveOrder(profile.selectedFiles), MAX_TOP_FILES_PER_FEATURE),
    failureCategories: collectFailureCategories(profile.failures),
  };
}

function buildFeatureIdsByFile(snapshot: TaskAdaptiveFrictionProfileSnapshot): Map<string, string[]> {
  const featureIdsByFile = new Map<string, string[]>();

  for (const profile of Object.values(snapshot.featureProfiles)) {
    for (const filePath of profile.selectedFiles) {
      const existing = featureIdsByFile.get(filePath) ?? [];
      if (!existing.includes(profile.targetId)) {
        existing.push(profile.targetId);
      }
      featureIdsByFile.set(filePath, existing);
    }
  }

  return featureIdsByFile;
}

function buildSurfaceFeatureIdsByFile(surfaceIndex: Awaited<ReturnType<typeof readFeatureSurfaceIndex>>): Map<string, string[]> {
  const featureIdsByFile = new Map<string, string[]>();

  for (const feature of surfaceIndex.metadata?.features ?? []) {
    const featureId = feature.id?.trim();
    if (!featureId) {
      continue;
    }

    for (const filePath of feature.sourceFiles ?? []) {
      const normalized = filePath.trim();
      if (!normalized) {
        continue;
      }
      const existing = featureIdsByFile.get(normalized) ?? [];
      if (!existing.includes(featureId)) {
        existing.push(featureId);
      }
      featureIdsByFile.set(normalized, existing);
    }
  }

  return featureIdsByFile;
}

function summarizeFileProfile(
  profile: TaskAdaptiveFrictionProfile,
  profileFeatureIdsByFile: Map<string, string[]>,
  surfaceFeatureIdsByFile: Map<string, string[]>,
): TaskAdaptiveIssueFileSummary {
  return {
    filePath: profile.targetId,
    featureIds: uniquePreserveOrder([
      ...(profileFeatureIdsByFile.get(profile.targetId) ?? []),
      ...(surfaceFeatureIdsByFile.get(profile.targetId) ?? []),
    ]),
    sessionCount: profile.matchedSessionIds.length,
    updatedAt: profile.updatedAt,
    failureCategories: collectFailureCategories(profile.failures),
  };
}

function aggregateTopFailureCategories(snapshot: TaskAdaptiveFrictionProfileSnapshot): TaskAdaptiveIssueFailureCategoryCount[] {
  const counts = new Map<string, number>();

  for (const profile of [
    ...Object.values(snapshot.featureProfiles),
    ...Object.values(snapshot.fileProfiles),
  ]) {
    for (const category of collectFailureCategories(profile.failures)) {
      counts.set(category.category, (counts.get(category.category) ?? 0) + category.count);
    }
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

function resolveGitValue(repoRoot: string, args: string[]): string | undefined {
  try {
    const value = gitExec(args, { cwd: repoRoot }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

async function resolveSnapshot(
  repoRoot: string,
  options: BuildTaskAdaptiveIssueSummaryOptions,
): Promise<{ snapshot: TaskAdaptiveFrictionProfileSnapshot; source: TaskAdaptiveIssueSummarySource }> {
  const shouldRefresh = options.refresh !== false;

  if (shouldRefresh) {
    return {
      snapshot: await refreshTaskAdaptiveFrictionProfiles(repoRoot),
      source: "refreshed",
    };
  }

  const cached = loadTaskAdaptiveFrictionProfiles(repoRoot);
  if (cached) {
    return {
      snapshot: cached,
      source: "cached",
    };
  }

  return {
    snapshot: await refreshTaskAdaptiveFrictionProfiles(repoRoot),
    source: "refreshed",
  };
}

export async function buildTaskAdaptiveIssueSummary(
  repoRoot: string,
  options: BuildTaskAdaptiveIssueSummaryOptions = {},
): Promise<TaskAdaptiveIssueSummary> {
  const maxFeatures = options.maxFeatures ?? DEFAULT_MAX_FEATURES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const [{ snapshot, source }, surfaceIndex] = await Promise.all([
    resolveSnapshot(repoRoot, options),
    readFeatureSurfaceIndex(repoRoot),
  ]);

  const profileFeatureIdsByFile = buildFeatureIdsByFile(snapshot);
  const surfaceFeatureIdsByFile = buildSurfaceFeatureIdsByFile(surfaceIndex);

  const topFeatures = trimTo(
    Object.values(snapshot.featureProfiles)
      .map(summarizeFeatureProfile)
      .sort((left, right) =>
        right.sessionCount - left.sessionCount
        || right.fileCount - left.fileCount
        || right.updatedAt.localeCompare(left.updatedAt)
        || left.featureId.localeCompare(right.featureId),
      ),
    maxFeatures,
  );

  const topFiles = trimTo(
    Object.values(snapshot.fileProfiles)
      .map((profile) => summarizeFileProfile(profile, profileFeatureIdsByFile, surfaceFeatureIdsByFile))
      .sort((left, right) =>
        right.sessionCount - left.sessionCount
        || right.updatedAt.localeCompare(left.updatedAt)
        || left.filePath.localeCompare(right.filePath),
      ),
    maxFiles,
  );

  return {
    generatedAt: snapshot.generatedAt,
    source,
    repo: {
      root: repoRoot,
      githubRepo: resolveGitHubRepo(undefined, repoRoot),
      branch: resolveGitValue(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: resolveGitValue(repoRoot, ["rev-parse", "--short", "HEAD"]),
    },
    thresholds: {
      minFileSessions: snapshot.thresholds.minFileSessions,
      minFeatureSessions: snapshot.thresholds.minFeatureSessions,
    },
    counts: {
      featureProfiles: Object.keys(snapshot.featureProfiles).length,
      fileProfiles: Object.keys(snapshot.fileProfiles).length,
    },
    topFailureCategories: aggregateTopFailureCategories(snapshot),
    topFeatures,
    topFiles,
    warnings: [...surfaceIndex.warnings],
  };
}

function formatFailureCategories(categories: TaskAdaptiveIssueFailureCategoryCount[]): string {
  if (categories.length === 0) {
    return "none";
  }

  return categories
    .slice(0, 3)
    .map((entry) => `${entry.category} x${entry.count}`)
    .join(", ");
}

function formatList(values: string[]): string {
  return values.length > 0
    ? values.map((value) => `\`${value}\``).join(", ")
    : "none";
}

export function formatTaskAdaptiveIssueSummaryMarkdown(summary: TaskAdaptiveIssueSummary): string {
  const lines: string[] = [
    TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER,
    "## Task-Adaptive Local Summary",
    "",
    "- This report is sanitized for GitHub sharing. It excludes raw session ids, prompt text, command text, and local absolute paths.",
    `- Generated at: \`${summary.generatedAt || "unknown"}\``,
    `- Source: \`${summary.source}\``,
    `- Repo: \`${summary.repo.githubRepo ?? "unknown"}\``,
    `- Branch: \`${summary.repo.branch ?? "unknown"}\``,
    `- Commit: \`${summary.repo.commit ?? "unknown"}\``,
    `- Feature profiles: \`${summary.counts.featureProfiles}\``,
    `- File profiles: \`${summary.counts.fileProfiles}\``,
    `- Thresholds: file>=\`${summary.thresholds.minFileSessions}\`, feature>=\`${summary.thresholds.minFeatureSessions}\``,
    "",
    "### Top Failure Categories",
  ];

  if (summary.topFailureCategories.length === 0) {
    lines.push("- none");
  } else {
    for (const category of summary.topFailureCategories.slice(0, 8)) {
      lines.push(`- \`${category.category}\`: ${category.count}`);
    }
  }

  lines.push("", "### Top Feature Hotspots");
  if (summary.topFeatures.length === 0) {
    lines.push("- none");
  } else {
    for (const feature of summary.topFeatures) {
      lines.push(`- ${feature.featureName} (\`${feature.featureId}\`)`);
      lines.push(`  - sessions: ${feature.sessionCount}, files: ${feature.fileCount}, updated: \`${feature.updatedAt || "unknown"}\``);
      lines.push(`  - top files: ${formatList(feature.topFiles)}`);
      lines.push(`  - failure categories: ${formatFailureCategories(feature.failureCategories)}`);
    }
  }

  lines.push("", "### Top File Hotspots");
  if (summary.topFiles.length === 0) {
    lines.push("- none");
  } else {
    for (const file of summary.topFiles) {
      lines.push(`- \`${file.filePath}\``);
      lines.push(`  - sessions: ${file.sessionCount}, updated: \`${file.updatedAt || "unknown"}\``);
      lines.push(`  - feature ids: ${formatList(file.featureIds)}`);
      lines.push(`  - failure categories: ${formatFailureCategories(file.failureCategories)}`);
    }
  }

  if (summary.warnings.length > 0) {
    lines.push("", "### Warnings");
    for (const warning of summary.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}
