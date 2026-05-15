/**
 * POST /api/github/import — Import a VCS repo as a virtual workspace.
 *
 * Body: { owner: string, repo: string, ref?: string } or { url: string }
 * Returns: { success: true, owner, repo, ref, fileCount, extractedPath, importedAt }
 *
 * Routes through VCS abstraction layer (GitHub or GitLab based on PLATFORM env).
 */

import { NextRequest, NextResponse } from "next/server";
import { importVCSRepo, VCSWorkspaceError } from "@/core/vcs/vcs-workspace";
import { parseVCSUrl } from "@/core/git/git-utils";
import { getVCSProvider, getPlatform } from "@/core/vcs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { owner, repo } = body as { owner?: string; repo?: string; ref?: string };
    const { ref } = body as { ref?: string };

    // Support shorthand URL
    if (!owner && body.url) {
      const parsed = parseVCSUrl(body.url);
      if (!parsed) {
        const platform = getPlatform();
        const example = platform === "gitlab"
          ? "https://gitlab.com/owner/repo or owner/repo"
          : "https://github.com/owner/repo or owner/repo";
        return NextResponse.json(
          { error: `Invalid ${platform} URL. Expected: ${example}` },
          { status: 400 },
        );
      }
      owner = parsed.owner;
      repo = parsed.repo;
    }

    if (!owner || !repo) {
      return NextResponse.json(
        { error: "Missing 'owner' and 'repo' fields (or provide 'url')" },
        { status: 400 },
      );
    }

    const provider = getVCSProvider();
    const token = provider.platform === "gitlab"
      ? process.env.GITLAB_TOKEN
      : process.env.GITHUB_TOKEN;

    const workspace = await importVCSRepo({ owner, repo, ref, token });

    return NextResponse.json({
      success: true,
      owner: workspace.owner,
      repo: workspace.repo,
      ref: workspace.ref,
      fileCount: workspace.fileCount,
      extractedPath: workspace.extractedPath,
      importedAt: workspace.importedAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof VCSWorkspaceError || (err instanceof Error && err.name === "VCSWorkspaceError")) {
      const code = (err as VCSWorkspaceError).code;
      const status = code === "NOT_FOUND" ? 404
        : code === "FORBIDDEN" ? 403
        : code === "TOO_LARGE" ? 413
        : 500;
      return NextResponse.json({ error: err.message, code }, { status });
    }
    console.error("[vcs/import] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 },
    );
  }
}
