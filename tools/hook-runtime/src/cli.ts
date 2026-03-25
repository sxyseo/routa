#!/usr/bin/env node

import { spawn } from "node:child_process";

import { isAiAgent } from "./ai.js";
import {
  MetricExecution,
  printFailureSummary,
  runMetric,
  summarizeFailures,
  type MetricRunOptions,
} from "./fitness.js";
import { loadHookMetrics } from "./metrics.js";
import { runCommand, tailOutput } from "./process.js";
import { promptYesNo } from "./prompt.js";
import { type ReviewPhaseResult, runReviewTriggerPhase } from "./review.js";

type CliOptions = {
  autoFix: boolean;
  dryRun: boolean;
  failFast: boolean;
  outputMode: "human" | "jsonl";
};

type HookPhaseResult = {
  phase: "submodule" | "fitness" | "review";
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  details?: string;
};

const LOCAL_METRICS = ["eslint_pass", "ts_typecheck_pass", "ts_test_pass"];

function parseOutputMode(raw: string | undefined): "human" | "jsonl" {
  if (raw === "jsonl") {
    return "jsonl";
  }
  return "human";
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    autoFix: false,
    dryRun: false,
    failFast: true,
    outputMode: parseOutputMode(process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fix") {
      options.autoFix = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--no-fail-fast") {
      options.failFast = false;
      continue;
    }
    if (arg === "--jsonl") {
      options.outputMode = "jsonl";
      continue;
    }
    if (arg === "--output" && i + 1 < argv.length) {
      options.outputMode = parseOutputMode(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.outputMode = parseOutputMode(arg.slice("--output=".length));
      continue;
    }
  }

  return options;
}

function emitEvent(outputMode: "human" | "jsonl", event: Record<string, unknown>): void {
  if (outputMode !== "jsonl") {
    return;
  }

  const payload = { ts: new Date().toISOString(), ...event };
  console.log(JSON.stringify(payload));
}

function logPhaseHeader(phase: string, step: number, outputMode: "human" | "jsonl", total = 3): void {
  if (outputMode === "human") {
    console.log(`[phase ${step}/${total}] ${phase}`);
  }
}

function createMetricOptions(outputMode: "human" | "jsonl"): MetricRunOptions {
  return {
    outputMode,
    streamOutput: outputMode === "human",
  };
}

function buildFixPrompt(results: MetricExecution[]): string {
  const sections = results
    .filter((result) => !result.passed)
    .map((result) => {
      const body = tailOutput(result.output, 8_000).trim();
      return `## ${result.metric.name}\n\`\`\`\n${body}\n\`\`\``;
    })
    .join("\n\n");

  return [
    "Pre-push fitness checks failed. Please fix the following issues:",
    "",
    sections,
    "",
    "After fixing all issues, rerun the pre-push hook and verify it passes.",
  ].join("\n");
}

async function runClaudeFix(prompt: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function handleFitnessFailure(
  results: MetricExecution[],
  options: CliOptions,
): Promise<never> {
  if (options.outputMode === "human") {
    printFailureSummary(results);
  }
  emitEvent(options.outputMode, {
    event: "fitness.failed",
    phase: "fitness",
    status: "failed",
    failures: summarizeFailures(results),
  });

  if (isAiAgent()) {
    throw new Error("Running in AI agent environment. Please fix the errors shown above.");
  }

  const claudeCheck = await runCommand("command -v claude", { stream: false });
  if (claudeCheck.exitCode !== 0) {
    throw new Error("Claude CLI not found. Please fix errors manually.");
  }

  let shouldFix = options.autoFix;
  if (!shouldFix) {
    shouldFix = await promptYesNo("Would you like Claude to fix these issues? [y/N]");
  }

  if (!shouldFix) {
    throw new Error("Aborted. Please fix errors manually.");
  }

  if (options.outputMode === "human") {
    console.log("Starting Claude to fix issues...");
    console.log("");
  }

  const exitCode = await runClaudeFix(buildFixPrompt(results));
  if (exitCode !== 0) {
    throw new Error("Claude fix attempt failed.");
  }

  throw new Error("Claude has attempted to fix the issues. Please review the changes and run 'git push' again.");
}

async function runSubmodulePhase(dryRun: boolean, outputMode: "human" | "jsonl"): Promise<HookPhaseResult> {
  const startedAt = Date.now();
  logPhaseHeader("submodule refs", 1, outputMode);
  emitEvent(outputMode, {
    event: "phase.start",
    phase: "submodule",
    index: 1,
  });

  if (dryRun) {
    emitEvent(outputMode, {
      event: "phase.skip",
      phase: "submodule",
      durationMs: Date.now() - startedAt,
      reason: "dry_run",
      command: "./scripts/check-submodule-refs.sh",
    });
    if (outputMode === "human") {
      console.log("[dry-run] ./scripts/check-submodule-refs.sh");
      console.log("");
    }
    return { phase: "submodule", status: "skipped", durationMs: Date.now() - startedAt };
  }

  const result = await runCommand("./scripts/check-submodule-refs.sh", { stream: outputMode === "human" });
  const durationMs = Date.now() - startedAt;

  emitEvent(outputMode, {
    event: "phase.complete",
    phase: "submodule",
    status: result.exitCode === 0 ? "passed" : "failed",
    durationMs,
    command: "./scripts/check-submodule-refs.sh",
    exitCode: result.exitCode,
  });

  if (result.exitCode !== 0) {
    throw new Error("Submodule ref check failed.");
  }

  return { phase: "submodule", status: "passed", durationMs };
}

async function runFitnessPhase(options: CliOptions): Promise<MetricExecution[]> {
  logPhaseHeader("local fitness", 2, options.outputMode);
  emitEvent(options.outputMode, {
    event: "phase.start",
    phase: "fitness",
    index: 2,
  });

  if (options.dryRun) {
    const metrics = await loadHookMetrics(LOCAL_METRICS);
    if (options.outputMode === "human") {
      console.log("[fitness] Metrics: eslint_pass, ts_typecheck_pass, ts_test_pass");
      for (const metric of metrics) {
        console.log(`[dry-run] ${metric.name} -> ${metric.command}`);
      }
      console.log("");
    }
    if (options.outputMode === "human") {
      console.log("");
    }
    emitEvent(options.outputMode, {
      event: "phase.skip",
      phase: "fitness",
      status: "skipped",
      durationMs: 0,
      reason: "dry_run",
      metrics: LOCAL_METRICS,
    });
    return [];
  }

  const metrics = await loadHookMetrics(LOCAL_METRICS);
  const results: MetricExecution[] = [];
  const metricOptions = createMetricOptions(options.outputMode);
  const startedAt = Date.now();

  for (const [index, metric] of metrics.entries()) {
    const result = await runMetric(metric, index + 1, metrics.length, metricOptions);
    results.push(result);
    emitEvent(options.outputMode, {
      event: "metric.complete",
      phase: "fitness",
      name: result.metric.name,
      index: index + 1,
      total: metrics.length,
      passed: result.passed,
      durationMs: result.durationMs,
      exitCode: result.passed ? 0 : 1,
      sourceFile: result.metric.sourceFile,
      command: result.metric.command,
      outputTail: tailOutput(result.output, 6_000),
    });
    if (!result.passed && options.failFast) {
      break;
    }
  }

  const durationMs = Date.now() - startedAt;
  emitEvent(options.outputMode, {
    event: "phase.complete",
    phase: "fitness",
    status: results.every((result) => result.passed) ? "passed" : "failed",
    durationMs,
    totalMetrics: metrics.length,
    runMetrics: results.length,
    metricFailures: summarizeFailures(results),
  });

  if (results.some((result) => !result.passed)) {
    await handleFitnessFailure(results, options);
  }

  return results;
}

async function runReviewPhase(dryRun: boolean, outputMode: "human" | "jsonl"): Promise<ReviewPhaseResult | null> {
  emitEvent(outputMode, {
    event: "phase.start",
    phase: "review",
    index: 3,
  });

  if (dryRun) {
    if (outputMode === "human") {
      console.log("Review trigger phase skipped in dry-run.");
      console.log("");
    }
    emitEvent(outputMode, {
      event: "phase.skip",
      phase: "review",
      status: "skipped",
      durationMs: 0,
      reason: "dry_run",
    });
    return null;
  }

  const startedAt = Date.now();
  const result = await runReviewTriggerPhase(outputMode);
  emitEvent(outputMode, {
    event: "phase.complete",
    phase: "review",
    status: result.allowed ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
    base: result.base,
    bypassed: result.bypassed,
    matched: result.triggers.length,
    changedFiles: result.changedFiles,
    diffFileCount: result.diffFileCount,
    message: result.message,
    statusCode: result.status,
  });

  return result;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  emitEvent(options.outputMode, {
    event: "hook.start",
    mode: options.outputMode,
    dryRun: options.dryRun,
    autoFix: options.autoFix,
    failFast: options.failFast,
  });

  await runSubmodulePhase(options.dryRun, options.outputMode);
  await runFitnessPhase(options);

  if (!options.dryRun) {
    const review = await runReviewPhase(false, options.outputMode);
    if (review && !review.allowed) {
      throw new Error(review.message);
    }
  }

  emitEvent(options.outputMode, {
    event: "hook.complete",
    status: "passed",
    durationMs: Date.now() - startedAt,
  });

  if (options.outputMode === "human") {
    console.log("All checks passed! Ready to push.");
  }
}

main().catch((error) => {
  const { outputMode } = parseArgs(process.argv.slice(2));
  emitEvent(outputMode, {
    event: "hook.error",
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
  });
  if (outputMode === "human") {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && message.includes("CLAUDE")) {
      console.error(message);
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return;
  }
  if (error instanceof Error && error.message.includes("CLAUDE")) {
    return;
  }
  process.exit(1);
});
