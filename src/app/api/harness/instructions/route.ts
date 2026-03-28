import { promises as fsp } from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isContextError, parseContext, resolveRepoRoot } from "../hooks/shared";

type HarnessInstructionsResponse = {
  generatedAt: string;
  repoRoot: string;
  fileName: string;
  relativePath: string;
  source: string;
  fallbackUsed: boolean;
};

const CANDIDATE_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);

    let matched: { fileName: string; absolutePath: string } | null = null;
    for (const fileName of CANDIDATE_FILES) {
      const absolutePath = path.join(repoRoot, fileName);
      try {
        const stat = await fsp.stat(absolutePath);
        if (stat.isFile()) {
          matched = { fileName, absolutePath };
          break;
        }
      } catch {
        continue;
      }
    }

    if (!matched) {
      return NextResponse.json(
        {
          error: "未找到仓库指导文档",
          details: `Expected one of: ${CANDIDATE_FILES.join(", ")}`,
        },
        { status: 404 },
      );
    }

    const source = await fsp.readFile(matched.absolutePath, "utf-8");

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      repoRoot,
      fileName: matched.fileName,
      relativePath: path.relative(repoRoot, matched.absolutePath),
      source,
      fallbackUsed: matched.fileName !== CANDIDATE_FILES[0],
    } satisfies HarnessInstructionsResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Harness 指导文档上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 Harness 指导文档失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
