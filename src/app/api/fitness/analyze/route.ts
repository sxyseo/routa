import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";

const FITNESS_PROFILES = ["generic", "agent_orchestrator"] as const;
const DEFAULT_COMPARE_LAST = true;

type FitnessProfile = (typeof FITNESS_PROFILES)[number];

type ApiProfileStatus = "ok" | "missing" | "error";
type ApiProfileSource = "analysis";

type FitnessProfileResult = {
  profile: FitnessProfile;
  status: ApiProfileStatus;
  source: ApiProfileSource;
  durationMs?: number;
  report?: FitnessReport;
  error?: string;
};

type FitnessAnalyzeResponse = {
  generatedAt: string;
  requestedProfiles: FitnessProfile[];
  profiles: FitnessProfileResult[];
};

type FitnessCommandResult = {
  status: ApiProfileStatus;
  durationMs: number;
  report?: FitnessReport;
  error?: string;
};

type FitnessReport = {
  modelVersion: number;
  modelPath: string;
  profile: FitnessProfile;
  repoRoot: string;
  generatedAt: string;
  snapshotPath: string;
  overallLevel: string;
  overallLevelName: string;
  currentLevelReadiness: number;
  nextLevel?: string | null;
  nextLevelName?: string | null;
  nextLevelReadiness?: number | null;
  blockingTargetLevel?: string | null;
  blockingTargetLevelName?: string | null;
  dimensions: Record<string, FitnessDimensionResult>;
  cells: Array<unknown>;
  criteria: Array<unknown>;
  blockingCriteria: Array<unknown>;
  recommendations: Array<FitnessRecommendation>;
  comparison?: FitnessComparison | null;
};

type FitnessDimensionResult = {
  dimension: string;
  name: string;
  level: string;
  levelName: string;
  levelIndex: number;
  score: number;
  nextLevel?: string | null;
  nextLevelName?: string | null;
  nextLevelProgress?: number | null;
};

type FitnessRecommendation = {
  criterionId: string;
  action: string;
  whyItMatters: string;
  evidenceHint: string;
  critical: boolean;
  weight: number;
};

type FitnessDimensionChange = {
  dimension: string;
  previousLevel: string;
  currentLevel: string;
  change: "same" | "up" | "down";
};

type FitnessCriterionChange = {
  id: string;
  previousStatus?: string;
  currentStatus?: string;
};

type FitnessComparison = {
  previousGeneratedAt: string;
  previousOverallLevel: string;
  overallChange: "same" | "up" | "down";
  dimensionChanges: FitnessDimensionChange[];
  criteriaChanges: FitnessCriterionChange[];
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidProfile(value: string | undefined): value is FitnessProfile {
  return value === "generic" || value === "agent_orchestrator";
}

function normalizeProfiles(raw: unknown): FitnessProfile[] {
  if (!raw || typeof raw !== "object") {
    return ["generic"];
  }

  const payload = raw as {
    runBoth?: boolean;
    profile?: string;
    profiles?: unknown;
  };

  const configured: string[] = [];

  if (Array.isArray(payload.profiles)) {
    for (const profile of payload.profiles) {
      if (typeof profile === "string") configured.push(profile);
    }
  }

  if (configured.length === 0 && payload.profile) {
    configured.push(payload.profile);
  }

  const includeBoth = payload.runBoth === true || payload.runBoth === 1;
  if (includeBoth && configured.length === 0) {
    return [...FITNESS_PROFILES];
  }

  const normalized = configured
    .map((value) => (isValidProfile(value) ? value : undefined))
    .filter((value): value is FitnessProfile => value !== undefined);

  const deduped: FitnessProfile[] = [];
  for (const profile of normalized) {
    if (!deduped.includes(profile)) deduped.push(profile);
  }

  return deduped.length > 0 ? deduped : ["generic"];
}

function parseAnalyzeArgs(body: unknown) {
  const compareLast = body && typeof body === "object" && "compareLast" in body && typeof (body as { compareLast?: unknown }).compareLast === "boolean"
    ? (body as { compareLast?: boolean }).compareLast
    : DEFAULT_COMPARE_LAST;
  const noSave = body && typeof body === "object" && typeof (body as { noSave?: unknown }).noSave === "boolean"
    ? !!(body as { noSave?: boolean }).noSave
    : false;
  return {
    compareLast: compareLast ?? DEFAULT_COMPARE_LAST,
    noSave,
  };
}

function locateRepoRoot(): string {
  const startingDirectory = process.cwd();
  const checks: string[] = [
    startingDirectory,
    path.resolve(startingDirectory, ".."),
    path.resolve(startingDirectory, "..", ".."),
    path.resolve(startingDirectory, "..", "..", ".."),
    path.resolve(startingDirectory, "..", "..", "..", ".."),
  ];

  for (const candidate of checks) {
    if (candidate.includes("node_modules")) continue;
    if (fs.existsSync(path.join(candidate, "docs", "fitness", "harness-fluency.model.yaml"))
      && fs.existsSync(path.join(candidate, "crates", "routa-cli"))
    ) {
      return candidate;
    }
  }

  return startingDirectory;
}

function extractJsonOutput(raw: string): string {
  const candidate = raw.trim();
  if (!candidate) {
    throw new Error("Command produced no output");
  }

  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // Fall back to extracting the last JSON object when logs are printed before JSON.
  }

  const lastOpen = candidate.lastIndexOf("{");
  if (lastOpen < 0) {
    throw new Error("Unable to locate JSON output");
  }

  for (let index = lastOpen; index >= 0; index -= 1) {
    if (candidate[index] !== "{") continue;
    const snippet = candidate.slice(index).trim();
    if (!snippet.endsWith("}")) continue;
    try {
      JSON.parse(snippet);
      return snippet;
    } catch {
      // keep searching
    }
  }

  throw new Error("Unable to parse command JSON output");
}

async function runFitnessProfile(
  repoRoot: string,
  profile: FitnessProfile,
  compareLast: boolean,
  noSave: boolean,
): Promise<FitnessCommandResult> {
  const startTime = Date.now();
  const args = [
    "run",
    "-p",
    "routa-cli",
    "--",
    "fitness",
    "fluency",
    "--format",
    "json",
    "--profile",
    profile,
  ];

  if (compareLast) {
    args.push("--compare-last");
  }
  if (noSave) {
    args.push("--no-save");
  }

  return await new Promise<FitnessCommandResult>((resolve) => {
    const proc = spawn("cargo", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      resolve({
        status: "error",
        durationMs: Date.now() - startTime,
        error: toMessage(error),
      });
    });

    proc.on("close", (code, signal) => {
      const durationMs = Date.now() - startTime;

      if (signal) {
        resolve({
          status: "error",
          durationMs,
          error: `Command terminated by signal: ${signal}`,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          status: "error",
          durationMs,
          error: `Command failed (exit ${code}): ${stderr || "no stderr output"}`,
        });
        return;
      }

      try {
        const reportText = extractJsonOutput(stdout);
        const report = JSON.parse(reportText) as FitnessReport;
        resolve({
          status: "ok",
          durationMs,
          report,
        });
      } catch (error) {
        resolve({
          status: "error",
          durationMs,
          error: toMessage(error),
        });
      }
    });
  });
}

function buildResponse(profiles: FitnessProfile[], payload: { compareLast: boolean; noSave: boolean }) {
  const repoRoot = locateRepoRoot();
  const tasks = profiles.map(async (profile) => {
    const result = await runFitnessProfile(repoRoot, profile, payload.compareLast, payload.noSave);
    const entry: FitnessProfileResult = {
      profile,
      source: "analysis",
      status: result.status,
      durationMs: result.durationMs,
    };

    if (result.status === "ok" && result.report) {
      entry.report = result.report;
      return entry;
    }

    entry.error = result.error ?? "分析失败（未知错误）";
    return entry;
  });

  return Promise.all(tasks).then((collected) => ({
    generatedAt: new Date().toISOString(),
    requestedProfiles: profiles,
    profiles: collected,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const profiles = normalizeProfiles(body);
    const options = parseAnalyzeArgs(body);

    const payload = await buildResponse(profiles, options);
    return NextResponse.json(payload as FitnessAnalyzeResponse);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Fitness 分析调用失败",
        details: toMessage(error),
      },
      { status: 500 },
    );
  }
}
