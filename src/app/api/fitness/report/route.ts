import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { NextResponse } from "next/server";

const FITNESS_PROFILES = ["generic", "agent_orchestrator"] as const;

type FitnessProfile = (typeof FITNESS_PROFILES)[number];

type ReportApiProfileResult = {
  profile: FitnessProfile;
  status: "ok" | "missing" | "error";
  source: "snapshot";
  report?: unknown;
  error?: string;
};

type ReportResponse = {
  generatedAt: string;
  requestedProfiles: FitnessProfile[];
  profiles: ReportApiProfileResult[];
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function profileSnapshotPath(repoRoot: string, profile: FitnessProfile) {
  return path.join(
    repoRoot,
    "docs/fitness/reports",
    profile === "generic" ? "harness-fluency-latest.json" : "harness-fluency-agent-orchestrator-latest.json",
  );
}

export async function GET() {
  const repoRoot = locateRepoRoot();
  const results: ReportApiProfileResult[] = [];

  for (const profile of FITNESS_PROFILES) {
    const snapshotPath = profileSnapshotPath(repoRoot, profile);

    try {
      await fsp.access(snapshotPath);
      const raw = await fsp.readFile(snapshotPath, "utf-8");
      results.push({
        profile,
        source: "snapshot",
        status: "ok",
        report: JSON.parse(raw),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        results.push({
          profile,
          source: "snapshot",
          status: "missing",
          error: "快照文件不存在",
        });
        continue;
      }

      results.push({
        profile,
        source: "snapshot",
        status: "error",
        error: toMessage(error),
      });
    }
  }

  const response: ReportResponse = {
    generatedAt: new Date().toISOString(),
    requestedProfiles: [...FITNESS_PROFILES],
    profiles: results,
  };

  return NextResponse.json(response);
}
