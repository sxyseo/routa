import { isAiAgent, isInteractive } from "./ai.js";
import { runCommand } from "./process.js";
import { promptYesNo } from "./prompt.js";
import path from "node:path";

const REVIEW_UNAVAILABLE_BYPASS_ENV = "ROUTA_ALLOW_REVIEW_UNAVAILABLE";

type ReviewTrigger = {
  action: string;
  name: string;
  reasons?: string[];
  severity: string;
};

type ReviewReport = {
  triggers?: ReviewTrigger[];
  changed_files?: string[];
  diff_stats?: {
    file_count?: number;
    added_lines?: number;
    deleted_lines?: number;
  };
};

export type ReviewPhaseResult = {
  base: string;
  allowed: boolean;
  bypassed: boolean;
  status: "passed" | "blocked" | "unavailable" | "error";
  triggers: ReviewTrigger[];
  changedFiles?: string[];
  diffFileCount?: number;
  message: string;
};

async function resolveReviewBase(): Promise<string> {
  const upstream = await runCommand("git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'", {
    stream: false,
  });
  return upstream.exitCode === 0 ? upstream.output.trim() : "HEAD~1";
}

async function resolveReviewGitRoot(): Promise<string | null> {
  const root = await runCommand("git rev-parse --show-toplevel", {
    stream: false,
  });

  if (root.exitCode !== 0) {
    return null;
  }

  const trimmed = root.output.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function getReviewScopeMismatchMessage(rootPath: string): string {
  return `Review scope mismatch: hook-runtime expected to run in repository root "${rootPath}", but current directory is "${path.resolve(process.cwd())}".` +
    ` Set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 only if you intentionally want to proceed with potentially shifted scope.`;
}

function parseReport(reviewOutput: string): ReviewReport {
  if (!reviewOutput) {
    return { triggers: [], changed_files: [], diff_stats: { file_count: 0 } };
  }

  try {
    return JSON.parse(reviewOutput) as ReviewReport;
  } catch {
    return { triggers: [], changed_files: [], diff_stats: { file_count: 0 } };
  }
}

function printReviewReport(report: ReviewReport): void {
  console.log("Human review required before push:");
  for (const trigger of report.triggers ?? []) {
    console.log(`- [${trigger.severity}] ${trigger.name}`);
    for (const reason of trigger.reasons ?? []) {
      console.log(`  - ${reason}`);
    }
  }
  console.log("");
}

function buildResultBase(
  base: string,
  report: ReviewReport,
  status: ReviewPhaseResult["status"],
  allowed: boolean,
  bypassed: boolean,
  message: string,
): ReviewPhaseResult {
  return {
    allowed,
    bypassed,
    base,
    status,
    triggers: report.triggers ?? [],
    changedFiles: report.changed_files,
    diffFileCount: report.diff_stats?.file_count,
    message,
  };
}

async function parseDecision(report: ReviewReport, base: string, outputMode: "human" | "jsonl"): Promise<ReviewPhaseResult> {
  if (isAiAgent()) {
    const message =
      "Review-trigger matched. Human review is required before push. Rerun with ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 after review if you intentionally want to bypass this gate.";
    return buildResultBase(base, report, "blocked", false, false, message);
  }

  if (process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH === "1") {
    const message = "ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 set, bypassing review gate.";
    if (outputMode === "human") {
      console.log(message);
      console.log("");
    }
    return buildResultBase(base, report, "passed", true, true, message);
  }

  if (!isInteractive()) {
    const message =
      "Review-trigger matched in a non-interactive push. Complete human review first, then rerun with ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 to confirm.";
    return buildResultBase(base, report, "blocked", false, false, message);
  }

  const confirmed = await promptYesNo("These changes need human review. Confirm review is complete and continue push? [y/N]");
  if (!confirmed) {
    const message = "Push aborted. Complete review, then push again.";
    return buildResultBase(base, report, "blocked", false, false, message);
  }

  const message = "Human review acknowledged. Continuing push.";
  if (outputMode === "human") {
    console.log(message);
    console.log("");
  }
  return buildResultBase(base, report, "passed", true, false, message);
}

function shouldBypassUnavailableReviewGate(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REVIEW_UNAVAILABLE_BYPASS_ENV] === "1";
}

export async function runReviewTriggerPhase(outputMode: "human" | "jsonl" = "human"): Promise<ReviewPhaseResult> {
  const reviewBase = await resolveReviewBase();
  const reviewRoot = await resolveReviewGitRoot();

  if (reviewRoot && reviewRoot !== path.resolve(process.cwd())) {
    const message = getReviewScopeMismatchMessage(reviewRoot);
    if (shouldBypassUnavailableReviewGate()) {
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, { triggers: [], changed_files: [], diff_stats: { file_count: 0 } }, "unavailable", true, true, message);
    }

    return buildResultBase(reviewBase, { triggers: [], changed_files: [], diff_stats: { file_count: 0 } }, "unavailable", false, false, message);
  }

  if (!reviewRoot) {
    const message =
      `No git repository root found from current directory (${path.resolve(process.cwd())}). ` +
      `Review phase requires git context and is blocked by default. Set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`;

    if (shouldBypassUnavailableReviewGate()) {
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, { triggers: [], changed_files: [], diff_stats: { file_count: 0 } }, "unavailable", true, true, message);
    }

    return buildResultBase(reviewBase, { triggers: [], changed_files: [], diff_stats: { file_count: 0 } }, "unavailable", false, false, message);
  }

  if (outputMode === "human") {
    console.log(`[review] Base: ${reviewBase}`);
    console.log("");
  }

  const review = await runCommand(
    `PYTHONPATH=tools/entrix python3 -m entrix.cli review-trigger --base "${reviewBase}" --json --fail-on-trigger`,
    { stream: false, cwd: reviewRoot },
  );

  if (review.exitCode === 0) {
    if (outputMode === "human") {
      console.log("No review trigger matched.");
      console.log("");
    }
    return buildResultBase(
      reviewBase,
      { triggers: [], changed_files: [], diff_stats: { file_count: 0 } },
      "passed",
      true,
      false,
      "No review trigger matched.",
    );
  }

  const report = parseReport(review.output);
  if (review.exitCode !== 3) {
    if (shouldBypassUnavailableReviewGate()) {
      const message = `${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 set, bypassing unavailable review gate.`;
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, report, "unavailable", true, true, message);
    }

    const message =
      `Unable to evaluate review triggers. Blocking push because the review gate could not be evaluated. ` +
      `Fix the review environment and rerun, or set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`;
    return buildResultBase(reviewBase, report, "unavailable", false, false, message);
  }

  if (outputMode === "human") {
    printReviewReport(report);
  }

  return parseDecision(report, reviewBase, outputMode);
}
