/**
 * GET /api/github — List active VCS virtual workspaces.
 * Routes through VCS abstraction layer.
 *
 * Returns: { workspaces: Array<{ key, owner, repo, ref, fileCount, importedAt, expiresAt }> }
 */

import { NextResponse } from "next/server";
import { listActiveWorkspaces } from "@/core/vcs/vcs-workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspaces = listActiveWorkspaces();
  return NextResponse.json({ workspaces });
}
