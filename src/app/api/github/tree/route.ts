/**
 * GET /api/github/tree?owner=X&repo=Y&ref=Z — Get file tree for an imported VCS repo.
 * Routes through VCS abstraction layer.
 *
 * Returns: { tree: VirtualFileEntry[], fileCount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCachedWorkspace } from "@/core/vcs/vcs-workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("owner");
  const repo = request.nextUrl.searchParams.get("repo");
  const ref = request.nextUrl.searchParams.get("ref") || "HEAD";

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Missing 'owner' and 'repo' query parameters" },
      { status: 400 },
    );
  }

  const workspace = getCachedWorkspace(owner, repo, ref);
  if (!workspace) {
    return NextResponse.json(
      { error: `Workspace not imported. POST /api/github/import first for ${owner}/${repo}` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    tree: workspace.getTree(),
    fileCount: workspace.fileCount,
  });
}
