import { HookMetric } from "./metrics.js";
import { runCommand, tailOutput } from "./process.js";

export type MetricExecution = {
  durationMs: number;
  metric: HookMetric;
  output: string;
  passed: boolean;
};

export type MetricRunOptions = {
  streamOutput?: boolean;
  outputMode?: "human" | "jsonl";
};

export type MetricFailureSummary = {
  name: string;
  sourceFile: string;
  durationMs: number;
  outputTail: string;
};

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function evaluateMetric(metric: HookMetric, exitCode: number, output: string): boolean {
  if (!metric.pattern) {
    return exitCode === 0;
  }

  const matcher = new RegExp(metric.pattern, "i");
  return matcher.test(output);
}

export async function runMetric(
  metric: HookMetric,
  index: number,
  total: number,
  options: MetricRunOptions = {},
): Promise<MetricExecution> {
  const outputMode = options.outputMode ?? "human";
  const streamOutput = options.streamOutput ?? outputMode === "human";

  if (outputMode === "human") {
    console.log(`[fitness ${index}/${total}] ${metric.name}`);
    console.log(`  source: ${metric.sourceFile}`);
    if (metric.description) {
      console.log(`  note: ${metric.description}`);
    }
    console.log("");
  }

  const result = await runCommand(metric.command, { stream: streamOutput });
  const passed = evaluateMetric(metric, result.exitCode, result.output);

  if (outputMode === "human") {
    console.log("");
    console.log(
      `[fitness ${index}/${total}] ${metric.name} ${passed ? "PASS" : "FAIL"} in ${formatDuration(result.durationMs)}`,
    );
    console.log("");
  }

  return {
    metric,
    durationMs: result.durationMs,
    passed,
    output: result.output,
  };
}

export function summarizeFailures(results: MetricExecution[]): MetricFailureSummary[] {
  const failures = results.filter((result) => !result.passed);
  return failures.map((failure) => ({
    name: failure.metric.name,
    sourceFile: failure.metric.sourceFile,
    durationMs: failure.durationMs,
    outputTail: tailOutput(failure.output).trim(),
  }));
}

export function printFailureSummary(results: MetricExecution[]): void {
  const failures = summarizeFailures(results);
  if (failures.length === 0) {
    return;
  }

  console.log("===============================================================");
  console.log("Pre-push fitness checks failed");
  console.log("===============================================================");
  console.log("");

  for (const failure of failures) {
    console.log(`- ${failure.name} (${formatDuration(failure.durationMs)})`);
    if (failure.outputTail) {
      console.log(failure.outputTail);
      console.log("");
    }
  }
}
