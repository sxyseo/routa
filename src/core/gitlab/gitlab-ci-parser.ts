import * as yaml from "js-yaml";

// ── Public types ────────────────────────────────────────────────────────────

export type GitLabCIJob = {
  id: string;
  name: string;
  stage: string;
  script: string[];
  image: string | null;
  variables: Record<string, string | { value: string; description?: string }>;
  tags: string[];
  when: string;
  allowFailure: boolean | { exit_codes: number[] };
  needs: string[];
  extends: string[];
  artifacts?: unknown;
  cache?: unknown;
  services?: unknown[];
};

export type GitLabCIStage = {
  name: string;
  jobs: string[];
};

export type GitLabCIDependency = {
  from: string;
  to: string;
};

export type GitLabCIWorkflowRule = {
  if?: string;
  when?: string;
  variables?: Record<string, string>;
};

export type GitLabCIWorkflow = {
  rules: GitLabCIWorkflowRule[];
};

export type GitLabCIInclude = {
  local?: string;
  remote?: string;
  template?: string;
  project?: string;
  ref?: string;
  file?: string | string[];
};

export type GitLabCIPipeline = {
  stages: GitLabCIStage[];
  jobs: GitLabCIJob[];
  dependencies: GitLabCIDependency[];
  variables: Record<string, string | { value: string; description?: string }>;
  workflow: GitLabCIWorkflow | null;
  includes: GitLabCIInclude[];
};

export type GitLabCIParseResult = {
  pipeline: GitLabCIPipeline;
  warnings: string[];
};

// ── Internal raw types ──────────────────────────────────────────────────────

type RawVariables = Record<string, unknown>;

type RawJob = {
  stage?: unknown;
  script?: unknown;
  image?: unknown;
  variables?: unknown;
  tags?: unknown;
  when?: unknown;
  allow_failure?: unknown;
  needs?: unknown;
  extends?: unknown;
  artifacts?: unknown;
  cache?: unknown;
  services?: unknown;
  before_script?: unknown;
  after_script?: unknown;
  rules?: unknown;
  // hide intermediate keys
  [key: string]: unknown;
};

type RawPipeline = {
  stages?: unknown;
  variables?: unknown;
  workflow?: unknown;
  include?: unknown;
  [key: string]: unknown;
};

// ── Reserved top-level keys that are NOT job definitions ────────────────────

const RESERVED_TOP_LEVEL_KEYS = new Set([
  "stages",
  "variables",
  "workflow",
  "include",
  "image",
  "before_script",
  "after_script",
  "services",
  "cache",
  "default",
]);

const DEFAULT_STAGES = ["build", "test", "deploy"];

// ── Helpers ─────────────────────────────────────────────────────────────────

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function normalizeWhen(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return "on_success";
}

function normalizeAllowFailure(value: unknown): boolean | { exit_codes: number[] } {
  if (typeof value === "boolean") {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const codes = (value as Record<string, unknown>).exit_codes;
    if (Array.isArray(codes)) {
      return { exit_codes: codes.filter((c): c is number => typeof c === "number") };
    }
  }
  return false;
}

function normalizeImage(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

function normalizeVariables(value: unknown): Record<string, string | { value: string; description?: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string | { value: string; description?: string }> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      result[key] = String(val);
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      const v = obj.value ?? "";
      const desc = obj.description;
      result[key] = {
        value: String(v),
        ...(typeof desc === "string" ? { description: desc } : {}),
      };
    }
  }
  return result;
}

function extractNeeds(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          return typeof (entry as Record<string, unknown>).job === "string"
            ? (entry as Record<string, unknown>).job as string
            : null;
        }
        return null;
      })
      .filter((entry): entry is string => entry !== null);
  }
  return [];
}

function extractExtends(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function extractIncludes(value: unknown): GitLabCIInclude[] {
  if (!value) {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item): GitLabCIInclude | null => {
      if (typeof item === "string") {
        return { local: item };
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        return {
          ...(typeof obj.local === "string" ? { local: obj.local } : {}),
          ...(typeof obj.remote === "string" ? { remote: obj.remote } : {}),
          ...(typeof obj.template === "string" ? { template: obj.template } : {}),
          ...(typeof obj.project === "string" ? { project: obj.project } : {}),
          ...(typeof obj.ref === "string" ? { ref: obj.ref } : {}),
          ...(typeof obj.file === "string" || Array.isArray(obj.file)
            ? { file: obj.file as string | string[] }
            : {}),
        };
      }
      return null;
    })
    .filter((item): item is GitLabCIInclude => item !== null);
}

function extractStages(value: unknown, warnings: string[]): string[] {
  if (!value) {
    return [...DEFAULT_STAGES];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  warnings.push("stages 字段不是数组，使用默认 stages");
  return [...DEFAULT_STAGES];
}

// ── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse a .gitlab-ci.yml source string into a structured pipeline representation.
 */
export function parseGitLabCI(source: string): GitLabCIParseResult {
  const warnings: string[] = [];

  let parsed: RawPipeline;
  try {
    const loaded = (yaml.load as (input: string, opts?: Record<string, unknown>) => unknown)(source, { schema: (yaml as Record<string, unknown>).DEFAULT_SCHEMA });
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      return {
        pipeline: emptyPipeline(),
        warnings: ["YAML 内容解析结果不是有效的对象"],
      };
    }
    parsed = loaded as RawPipeline;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ParseError(`YAML 解析失败: ${message}`, extractLineFromError(message));
  }

  const stageNames = extractStages(parsed.stages, warnings);
  const globalVariables = normalizeVariables(parsed.variables);
  const includes = extractIncludes(parsed.include);
  const workflow = extractWorkflow(parsed.workflow, warnings);

  // Identify job entries: top-level keys that are not reserved keywords,
  // not hidden templates (starting with "."), and whose values are objects.
  const jobEntries: [string, RawJob][] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (RESERVED_TOP_LEVEL_KEYS.has(key)) {
      continue;
    }
    // Hidden jobs/templates start with "." in GitLab — skip them
    if (key.startsWith(".")) {
      continue;
    }
    // A job must be a non-null object and not an array
    if (value && typeof value === "object" && !Array.isArray(value)) {
      jobEntries.push([key, value as RawJob]);
    }
  }

  // Build job objects
  const jobs: GitLabCIJob[] = jobEntries.map(([jobId, raw]) => {
    const stage = typeof raw.stage === "string" && raw.stage.trim()
      ? raw.stage.trim()
      : "test"; // GitLab default stage is "test"

    // Validate stage reference
    if (!stageNames.includes(stage)) {
      warnings.push(`Job "${jobId}" 引用了未定义的 stage "${stage}"`);
    }

    const job: GitLabCIJob = {
      id: jobId,
      name: jobId,
      stage,
      script: toStringArray(raw.script),
      image: normalizeImage(raw.image),
      variables: normalizeVariables(raw.variables),
      tags: toStringArray(raw.tags),
      when: normalizeWhen(raw.when),
      allowFailure: normalizeAllowFailure(raw.allow_failure),
      needs: extractNeeds(raw.needs),
      extends: extractExtends(raw.extends),
    };
    if (raw.artifacts !== undefined) job.artifacts = raw.artifacts;
    if (raw.cache !== undefined) job.cache = raw.cache;
    if (raw.services !== undefined) job.services = raw.services as unknown[];
    return job;
  });

  // Build stages with their job assignments
  const stageMap = new Map<string, string[]>();
  for (const stageName of stageNames) {
    stageMap.set(stageName, []);
  }
  for (const job of jobs) {
    const list = stageMap.get(job.stage);
    if (list) {
      list.push(job.id);
    } else {
      // Auto-register stage if not in the explicit list
      stageMap.set(job.stage, [job.id]);
      warnings.push(`自动注册未定义的 stage "${job.stage}"`);
    }
  }
  const stages: GitLabCIStage[] = Array.from(stageMap.entries()).map(([name, jobIds]) => ({
    name,
    jobs: jobIds,
  }));

  // Build explicit dependencies from needs
  const dependencies: GitLabCIDependency[] = [];
  for (const job of jobs) {
    for (const needed of job.needs) {
      dependencies.push({ from: job.id, to: needed });
    }
  }

  return {
    pipeline: {
      stages,
      jobs,
      dependencies,
      variables: globalVariables,
      workflow,
      includes,
    },
    warnings,
  };
}

// ── Parse POST body ─────────────────────────────────────────────────────────

export type ParseGitLabCIBody = {
  content?: string;
  filePath?: string;
};

/**
 * Parse a .gitlab-ci.yml from the POST body, supporting both direct content
 * and file path inputs.
 */
export async function parseGitLabCIFromInput(body: ParseGitLabCIBody): Promise<GitLabCIParseResult> {
  const { promises: fsp } = await import("fs");
  const path = await import("path");

  let source: string;

  if (body.content) {
    source = body.content;
  } else if (body.filePath) {
    const resolved = path.resolve(body.filePath);
    try {
      source = await fsp.readFile(resolved, "utf-8");
    } catch (err) {
      throw new ParseError(
        `无法读取文件 ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    throw new ParseError("请求体必须包含 content 或 filePath 字段", undefined, 400);
  }

  return parseGitLabCI(source);
}

// ── Error class ─────────────────────────────────────────────────────────────

export class ParseError extends Error {
  public readonly line?: number;
  public readonly statusCode: number;

  constructor(message: string, line?: number, statusCode: number = 422) {
    super(message);
    this.name = "ParseError";
    this.line = line;
    this.statusCode = statusCode;
  }
}

// ── Internals ───────────────────────────────────────────────────────────────

function emptyPipeline(): GitLabCIPipeline {
  return {
    stages: DEFAULT_STAGES.map((name) => ({ name, jobs: [] })),
    jobs: [],
    dependencies: [],
    variables: {},
    workflow: null,
    includes: [],
  };
}

function extractWorkflow(value: unknown, warnings: string[]): GitLabCIWorkflow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const rules = obj.rules;
  if (!Array.isArray(rules)) {
    warnings.push("workflow.rules 不是数组，已忽略");
    return null;
  }
  return {
    rules: rules
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r))
      .map((r) => ({
        ...(typeof r.if === "string" ? { if: r.if } : {}),
        ...(typeof r.when === "string" ? { when: r.when } : {}),
        ...(r.variables && typeof r.variables === "object" && !Array.isArray(r.variables)
          ? { variables: normalizeVariables(r.variables) as Record<string, string> }
          : {}),
      })),
  };
}

function extractLineFromError(message: string): number | undefined {
  // js-yaml error messages often include "at line X, column Y"
  const match = message.match(/at line (\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}
