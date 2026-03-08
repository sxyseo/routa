/**
 * /api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees
 *
 * GET  — List worktrees for a codebase
 * POST — Create a new worktree
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { GitWorktreeService } from "@/core/git/git-worktree-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> }
) {
  const { codebaseId } = await params;
  const system = getRoutaSystem();

  const worktrees = await system.worktreeStore.listByCodebase(codebaseId);
  return NextResponse.json({ worktrees });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> }
) {
  const { codebaseId } = await params;
  const body = await request.json();
  const { branch, baseBranch, label } = body;

  const system = getRoutaSystem();
  const service = new GitWorktreeService(system.worktreeStore, system.codebaseStore);

  try {
    const worktree = await service.createWorktree(codebaseId, {
      branch,
      baseBranch,
      label,
    });
    return NextResponse.json({ worktree }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already in use")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
