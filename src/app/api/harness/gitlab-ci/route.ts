import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { NextRequest, NextResponse } from "next/server";
import { isContextError, parseContext, resolveRepoRoot } from "../hooks/shared";

type GitLabCIJobKind = "build" | "test" | "deploy" | "security" | "review";

type GitLabCIJob = {
  id: string;
  name: string;
  stage: string;
  image: string | null;
  kind: GitLabCIJobKind;
  scriptCount: number;
  needs: string[];
  dependencies: string[];
  tags: string[];
  allowFailure: boolean;
  when: string;
};

type GitLabCIStage = {
  name: string;
  jobs: GitLabCIJob[];
};

type GitLabCIPipeline = {
  yaml: string;
  stages: GitLabCIStage[];
  jobs: GitLabCIJob[];
  defaultImage: string | null;
  totalStages: number;
  totalJobs: number;
};

type GitLabCIResponse = {
  generatedAt: string;
  repoRoot: string;
  ciFilePath: string | null;
  pipeline: GitLabCIPipeline | null;
  warnings: string[];
};

type RawGitLabCI = {
  stages?: unknown;
  default?: unknown;
  image?: unknown;
  variables?: unknown;
  workflow?: unknown;
  include?: unknown;
  [jobId: string]: unknown;
};

type RawGitLabJob = {
  stage?: unknown;
  image?: unknown;
  script?: unknown;
  needs?: unknown;
  dependencies?: unknown;
  tags?: unknown;
  allow_failure?: unknown;
  when?: unknown;
  before_script?: unknown;
  after_script?: unknown;
  extends?: unknown;
  artifacts?: unknown;
  only?: unknown;
  except?: unknown;
  rules?: unknown;
  cache?: unknown;
  services?: unknown;
  environment?: unknown;
  trigger?: unknown;
};

const GITLAB_CI_FILENAMES = [".gitlab-ci.yml", ".gitlab-ci.yaml"];
const GITLAB_RESERVED_KEYS = new Set([
  "stages", "default", "image", "variables", "workflow", "include",
  "before_script", "after_script", "services", "cache", "artifacts",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
  }
  return [];
}

function normalizeScriptCount(value: unknown): number {
  if (typeof value === "string") return 1;
  if (Array.isArray(value)) return value.length;
  return 0;
}

function inferJobKind(stage: string, jobId: string): GitLabCIJobKind {
  const combined = `${stage} ${jobId}`.toLowerCase();
  if (/deploy|release|publish|pages/.test(combined)) return "deploy";
  if (/test|spec|check|lint|validate|verify/.test(combined)) return "test";
  if (/security|scan|sast|dependency|audit/.test(combined)) return "security";
  if (/review|code-?quality/.test(combined)) return "review";
  return "build";
}

function parseNeeds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string") return [entry.trim()];
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        if (typeof record.job === "string") return [record.job.trim()];
      }
      return [];
    }).filter(Boolean);
  }
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  return [];
}

function isJobDefinition(key: string, value: unknown): value is RawGitLabJob {
  if (GITLAB_RESERVED_KEYS.has(key)) return false;
  if (value === null || value === undefined) return false;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  // A job must have at least one of: script, trigger, or extends (with script in extended)
  // For static analysis, check for script or trigger presence
  return typeof record.script !== "undefined"
    || typeof record.trigger !== "undefined"
    || typeof record.stage !== "undefined"
    || typeof record.extends !== "undefined";
}

function parsePipeline(source: string, relativePath: string): GitLabCIPipeline | null {
  const parsed = yaml.load(source) as RawGitLabCI | null;
  if (!parsed || typeof parsed !== "object") return null;

  // Extract stages list
  const stageList: string[] = Array.isArray(parsed.stages)
    ? parsed.stages.filter((s): s is string => typeof s === "string")
    : [".pre", "build", "test", "deploy", ".post"];

  // Extract default image
  const defaultImage = extractImage(parsed.default) ?? extractImage(parsed.image) ?? null;

  // Extract job definitions
  const jobs: GitLabCIJob[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!isJobDefinition(key, value)) continue;

    const rawJob = value as RawGitLabJob;
    const stage = typeof rawJob.stage === "string" ? rawJob.stage : "build";
    const image = extractImage(rawJob.image) ?? defaultImage;
    const needs = parseNeeds(rawJob.needs);
    const dependencies = normalizeStringArray(rawJob.dependencies);
    const tags = normalizeStringArray(rawJob.tags);

    jobs.push({
      id: key,
      name: key,
      stage,
      image,
      kind: inferJobKind(stage, key),
      scriptCount: normalizeScriptCount(rawJob.script),
      needs,
      dependencies: dependencies.length > 0 ? dependencies : needs,
      tags,
      allowFailure: rawJob.allow_failure === true,
      when: typeof rawJob.when === "string" ? rawJob.when : "on_success",
    });
  }

  if (jobs.length === 0) return null;

  // Build stages with their jobs
  const stages: GitLabCIStage[] = [];
  const jobsByStage = new Map<string, GitLabCIJob[]>();
  for (const job of jobs) {
    const list = jobsByStage.get(job.stage);
    if (list) {
      list.push(job);
    } else {
      jobsByStage.set(job.stage, [job]);
    }
  }

  // Create stages in declared order, then add any remaining stages from jobs
  const seenStages = new Set<string>();
  for (const stageName of stageList) {
    seenStages.add(stageName);
    stages.push({
      name: stageName,
      jobs: jobsByStage.get(stageName) ?? [],
    });
  }
  for (const [stageName, stageJobs] of jobsByStage.entries()) {
    if (!seenStages.has(stageName)) {
      seenStages.add(stageName);
      stages.push({ name: stageName, jobs: stageJobs });
    }
  }

  return {
    yaml: source,
    stages,
    jobs,
    defaultImage,
    totalStages: stages.filter((s) => s.jobs.length > 0).length,
    totalJobs: jobs.length,
  };
}

function extractImage(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string") return record.name;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const warnings: string[] = [];

    // Find .gitlab-ci.yml file
    let ciFilePath: string | null = null;
    let ciRelativePath: string | null = null;

    for (const filename of GITLAB_CI_FILENAMES) {
      const candidate = path.join(repoRoot, filename);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        ciFilePath = candidate;
        ciRelativePath = filename;
        break;
      }
    }

    if (!ciFilePath) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        repoRoot,
        ciFilePath: null,
        pipeline: null,
        warnings: ["No .gitlab-ci.yml file found in repository root."],
      } satisfies GitLabCIResponse);
    }

    try {
      const source = await fsp.readFile(ciFilePath, "utf-8");
      const pipeline = parsePipeline(source, ciRelativePath ?? ".gitlab-ci.yml");

      if (!pipeline) {
        warnings.push("The .gitlab-ci.yml file does not define any valid jobs.");
      }

      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        repoRoot,
        ciFilePath: ciRelativePath,
        pipeline,
        warnings,
      } satisfies GitLabCIResponse);
    } catch (error) {
      warnings.push(`Failed to parse .gitlab-ci.yml: ${toMessage(error)}`);
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        repoRoot,
        ciFilePath: ciRelativePath,
        pipeline: null,
        warnings,
      } satisfies GitLabCIResponse);
    }
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        { error: "GitLab CI 上下文无效", details: message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "读取 GitLab CI 配置失败", details: message },
      { status: 500 },
    );
  }
}
