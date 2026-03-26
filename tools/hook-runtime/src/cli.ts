#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LOCAL_VALIDATE_METRICS,
  DEFAULT_PARALLEL_JOBS,
  DEFAULT_PRE_PUSH_METRICS,
  DEFAULT_TAIL_LINES,
  HOOK_PROFILE_LOCAL_VALIDATE,
  HOOK_PROFILE_PRE_COMMIT,
  HOOK_PROFILE_PRE_PUSH,
  isHookProfileName,
  PROFILE_DEFAULT,
  parseMetricNames,
  parsePositiveInt,
  resolveProfileDefaults,
  type HookProfileName,
} from "./config.js";
import {
  runHookRuntime,
  type HookRuntimeOptions,
  type HookRuntimeProfile,
  type RuntimePhase,
} from "./runtime.js";

export { formatReviewPhaseLabel } from "./runtime.js";

const RUNTIME_PROFILES: Record<HookProfileName, HookRuntimeProfile> = {
  [HOOK_PROFILE_PRE_PUSH]: {
    name: HOOK_PROFILE_PRE_PUSH,
    phases: ["submodule", "fitness", "review"],
    fallbackMetrics: DEFAULT_PRE_PUSH_METRICS,
  },
  [HOOK_PROFILE_PRE_COMMIT]: {
    name: HOOK_PROFILE_PRE_COMMIT,
    phases: ["fitness-fast"],
    fallbackMetrics: resolveProfileDefaults(HOOK_PROFILE_PRE_COMMIT),
  },
  [HOOK_PROFILE_LOCAL_VALIDATE]: {
    name: HOOK_PROFILE_LOCAL_VALIDATE,
    phases: ["fitness", "review"],
    fallbackMetrics: DEFAULT_LOCAL_VALIDATE_METRICS,
  },
};

type CliOptions = HookRuntimeOptions & {
  profilePhases: readonly RuntimePhase[];
};

function parseOutputMode(raw: string | undefined): "human" | "jsonl" {
  if (raw === "jsonl") {
    return "jsonl";
  }
  return "human";
}

function normalizeProfile(raw: string | undefined): HookProfileName {
  if (!raw) {
    return PROFILE_DEFAULT;
  }

  const normalized = raw.trim().toLowerCase();
  return isHookProfileName(normalized) ? normalized : PROFILE_DEFAULT;
}

function parseProfileFromArgv(argv: string[]): HookProfileName | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile" && i + 1 < argv.length) {
      return normalizeProfile(argv[i + 1]);
    }
    if (arg.startsWith("--profile=")) {
      return normalizeProfile(arg.slice("--profile=".length));
    }
  }
  return undefined;
}

export function parseArgs(argv: string[]): CliOptions {
  const profileFromArg = parseProfileFromArgv(argv);
  const envProfile = normalizeProfile(process.env.ROUTA_HOOK_RUNTIME_PROFILE);
  const requestedProfile = profileFromArg ?? envProfile ?? PROFILE_DEFAULT;
  const profileDefinition = RUNTIME_PROFILES[requestedProfile];

  const options: CliOptions = {
    autoFix: false,
    dryRun: false,
    failFast: true,
    jobs: parsePositiveInt(process.env.ROUTA_HOOK_RUNTIME_JOBS, DEFAULT_PARALLEL_JOBS),
    metricNames: parseMetricNames(process.env.ROUTA_HOOK_RUNTIME_METRICS, profileDefinition.fallbackMetrics),
    outputMode: parseOutputMode(process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE),
    profile: requestedProfile,
    profilePhases: profileDefinition.phases,
    tailLines: parsePositiveInt(process.env.ROUTA_HOOK_RUNTIME_TAIL_LINES, DEFAULT_TAIL_LINES),
  };
  let hasExplicitMetrics = Boolean(process.env.ROUTA_HOOK_RUNTIME_METRICS);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile" && i + 1 < argv.length) {
      options.profile = normalizeProfile(argv[i + 1]);
      const selectedProfile = RUNTIME_PROFILES[options.profile];
      options.profilePhases = selectedProfile.phases;

      if (!hasExplicitMetrics && !process.env.ROUTA_HOOK_RUNTIME_METRICS) {
        options.metricNames = parseMetricNames(undefined, selectedProfile.fallbackMetrics);
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = normalizeProfile(arg.slice("--profile=".length));
      const selectedProfile = RUNTIME_PROFILES[options.profile];
      options.profilePhases = selectedProfile.phases;

      if (!hasExplicitMetrics && !process.env.ROUTA_HOOK_RUNTIME_METRICS) {
        options.metricNames = parseMetricNames(undefined, selectedProfile.fallbackMetrics);
      }
      continue;
    }
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
    if (arg === "--metrics" && i + 1 < argv.length) {
      options.metricNames = parseMetricNames(argv[i + 1]);
      hasExplicitMetrics = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--metrics=")) {
      options.metricNames = parseMetricNames(arg.slice("--metrics=".length));
      hasExplicitMetrics = true;
      continue;
    }
    if (arg === "--jobs" && i + 1 < argv.length) {
      options.jobs = parsePositiveInt(argv[i + 1], options.jobs);
      i += 1;
      continue;
    }
    if (arg.startsWith("--jobs=")) {
      options.jobs = parsePositiveInt(arg.slice("--jobs=".length), options.jobs);
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
    if (arg === "--tail-lines" && i + 1 < argv.length) {
      options.tailLines = parsePositiveInt(argv[i + 1], options.tailLines);
      i += 1;
      continue;
    }
    if (arg.startsWith("--tail-lines=")) {
      options.tailLines = parsePositiveInt(arg.slice("--tail-lines=".length), options.tailLines);
      continue;
    }
  }

  const finalProfile = RUNTIME_PROFILES[options.profile];
  options.profilePhases = finalProfile.phases;

  if (!options.metricNames.length) {
    options.metricNames = parseMetricNames(
      process.env.ROUTA_HOOK_RUNTIME_METRICS,
      finalProfile.fallbackMetrics,
    );
  }

  return options;
}

export function handleCliError(error: unknown, argv: string[] = process.argv.slice(2)): void {
  const { outputMode } = parseArgs(argv);
  const message = error instanceof Error ? error.message : String(error);
  if (outputMode === "jsonl") {
    console.log(
      JSON.stringify({
        event: "hook.error",
        status: "failed",
        message,
        ts: new Date().toISOString(),
      }),
    );
  }

  if (outputMode === "human") {
    console.error(message);
  }
  process.exitCode = 1;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runtimeProfile = RUNTIME_PROFILES[options.profile];
  await runHookRuntime(options, runtimeProfile);
}

const modulePath = path.resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === modulePath) {
  void main().catch((error) => {
    handleCliError(error);
  });
}
