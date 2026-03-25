import { HookMetric } from "./metrics.js";
import { runCommand, tailOutput, type CommandOutputEvent } from "./process.js";

export type MetricExecution = {
  durationMs: number;
  exitCode: number;
  metric: HookMetric;
  output: string;
  passed: boolean;
};

export type MetricRunOptions = {
  onOutput?: (event: CommandOutputEvent) => void;
};

export type MetricFailureSummary = {
  name: string;
  sourceFile: string;
  durationMs: number;
  outputTail: string;
};

export function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function evaluateMetric(metric: HookMetric, exitCode: number, output: string): boolean {
  if (exitCode !== 0) {
    return false;
  }

  if (!metric.pattern) {
    return true;
  }

  const matcher = new RegExp(metric.pattern, "i");
  return matcher.test(output);
}

export async function runMetric(
  metric: HookMetric,
  options: MetricRunOptions = {},
): Promise<MetricExecution> {
  const result = await runCommand(metric.command, {
    stream: false,
    onOutput: options.onOutput,
  });
  const passed = evaluateMetric(metric, result.exitCode, result.output);

  return {
    metric,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
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
