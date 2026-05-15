/**
 * GET /api/github/file?owner=X&repo=Y&path=Z&ref=R — Read a file from an imported VCS repo.
 * Routes through VCS abstraction layer.
 *
 * Returns: { content: string, path: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCachedWorkspace, VCSWorkspaceError } from "@/core/vcs/vcs-workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("owner");
  const repo = request.nextUrl.searchParams.get("repo");
  const filePath = request.nextUrl.searchParams.get("path");
  const ref = request.nextUrl.searchParams.get("ref") || "HEAD";

  if (!owner || !repo || !filePath) {
    return NextResponse.json(
      { error: "Missing 'owner', 'repo', or 'path' query parameters" },
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

  try {
    const content = workspace.readFile(filePath);
    return NextResponse.json({ content, path: filePath });
  } catch (err) {
    if (err instanceof VCSWorkspaceError || (err instanceof Error && err.name === "VCSWorkspaceError")) {
      const code = (err as VCSWorkspaceError).code;
      const status = code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 500;
      return NextResponse.json({ error: err.message, code }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Read failed" },
      { status: 500 },
    );
  }
}
