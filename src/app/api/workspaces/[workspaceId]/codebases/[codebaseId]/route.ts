/**
 * /api/workspaces/[workspaceId]/codebases/[codebaseId]
 *
 * DELETE /api/workspaces/:workspaceId/codebases/:codebaseId → Remove codebase
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> }
) {
  const { workspaceId, codebaseId } = await params;
  const system = getRoutaSystem();

  const existing = await system.codebaseStore.get(codebaseId);
  if (!existing || existing.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Codebase not found" }, { status: 404 });
  }

  await system.codebaseStore.remove(codebaseId);

  return new NextResponse(null, { status: 204 });
}
