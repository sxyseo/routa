import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isContextError, parseContext, resolveRepoRoot } from "../hooks/shared";
import { parseGitLabCI, parseGitLabCIFromInput, ParseError } from "@/core/gitlab/gitlab-ci-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITLAB_CI_FILENAMES = [".gitlab-ci.yml", ".gitlab-ci.yaml"];

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type GitLabCIResponse = {
  generatedAt: string;
  repoRoot: string;
  filePath: string | null;
  pipeline: ReturnType<typeof parseGitLabCI>["pipeline"];
  warnings: string[];
};

/**
 * GET /api/harness/gitlab-ci
 *
 * Read .gitlab-ci.yml from the repository and return the parsed pipeline structure.
 * Query params: workspaceId | codebaseId | repoPath (same as github-actions route).
 */
export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const warnings: string[] = [];

    // Locate .gitlab-ci.yml
    let foundPath: string | null = null;
    for (const filename of GITLAB_CI_FILENAMES) {
      const candidate = path.join(repoRoot, filename);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        foundPath = candidate;
        break;
      }
    }

    if (!foundPath) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        repoRoot,
        filePath: null,
        pipeline: {
          stages: [],
          jobs: [],
          dependencies: [],
          variables: {},
          workflow: null,
          includes: [],
        },
        warnings: ["未找到 .gitlab-ci.yml 文件"],
      } satisfies GitLabCIResponse);
    }

    const source = await fsp.readFile(foundPath, "utf-8");
    const result = parseGitLabCI(source);
    const relativePath = path.relative(repoRoot, foundPath);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      repoRoot,
      filePath: relativePath,
      pipeline: result.pipeline,
      warnings: [...warnings, ...result.warnings],
    } satisfies GitLabCIResponse);
  } catch (error) {
    if (error instanceof ParseError) {
      return NextResponse.json(
        {
          error: "GitLab CI/CD 解析失败",
          details: error.message,
          ...(error.line !== undefined ? { line: error.line } : {}),
        },
        { status: error.statusCode },
      );
    }

    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "GitLab CI/CD 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 GitLab CI/CD 配置失败",
        details: message,
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/harness/gitlab-ci
 *
 * Accept .gitlab-ci.yml content directly in the request body and return parsed result.
 * Body: { content: string } | { filePath: string }
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ParseError("请求体不是有效的 JSON", undefined, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ParseError("请求体必须是 JSON 对象", undefined, 400);
    }

    const typedBody = body as { content?: string; filePath?: string };
    const result = await parseGitLabCIFromInput(typedBody);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      repoRoot: "",
      filePath: typedBody.filePath ?? null,
      pipeline: result.pipeline,
      warnings: result.warnings,
    } satisfies GitLabCIResponse);
  } catch (error) {
    if (error instanceof ParseError) {
      return NextResponse.json(
        {
          error: "GitLab CI/CD 解析失败",
          details: error.message,
          ...(error.line !== undefined ? { line: error.line } : {}),
        },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      {
        error: "处理 GitLab CI/CD 请求失败",
        details: toMessage(error),
      },
      { status: 500 },
    );
  }
}
