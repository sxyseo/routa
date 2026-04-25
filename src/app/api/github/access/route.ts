/**
 * GET /api/github/access — Check VCS access status.
 * Routes through VCS abstraction layer (GitHub or GitLab based on platform param or PLATFORM env).
 */

import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { getVCSProviderForSource } from "@/core/vcs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get("boardId")?.trim();
  const platform = searchParams.get("platform")?.trim();
  const board = boardId
    ? await getRoutaSystem().kanbanBoardStore.get(boardId)
    : undefined;
  const provider = getVCSProviderForSource(platform);
  const status = provider.getAccessStatus({ boardToken: board?.githubToken });
  return NextResponse.json(status);
}
