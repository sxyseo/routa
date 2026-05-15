/**
 * GET /api/gitlab/issues — List GitLab issues for a project.
 * Directly uses GitLabProvider (no workspace lookup required).
 */

import { NextRequest, NextResponse } from "next/server";
import { GitLabProvider } from "@/core/vcs";

export const dynamic = "force-dynamic";

const VALID_STATES = ["open", "closed", "all"] as const;
type IssueState = (typeof VALID_STATES)[number];

export async function GET(request: NextRequest) {
  const repo = request.nextUrl.searchParams.get("repo")?.trim();
  const token = request.nextUrl.searchParams.get("token")?.trim();
  const requestedState = request.nextUrl.searchParams.get("state")?.trim() ?? "open";

  // AC5: token 缺失返回 401
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 401 });
  }

  // AC5: repo 缺失返回 400
  if (!repo) {
    return NextResponse.json({ error: "repo is required" }, { status: 400 });
  }

  // AC4: state 参数验证
  const state: IssueState | null = VALID_STATES.includes(requestedState as IssueState)
    ? (requestedState as IssueState)
    : null;

  if (!state) {
    return NextResponse.json(
      { error: "state must be one of: open, closed, all" },
      { status: 400 },
    );
  }

  // AC3: 复用 GitLabProvider
  const provider = new GitLabProvider();

  try {
    // AC6: repo 参数支持 URL-encoded 的多级路径，decode 后传入
    const decodedRepo = decodeURIComponent(repo);
    const issues = await provider.listIssues({
      repo: decodedRepo,
      state,
      token,
    });

    return NextResponse.json({ repo: decodedRepo, issues });
  } catch (error) {
    // AC5: GitLab API 错误返回 502
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load GitLab issues" },
      { status: 502 },
    );
  }
}
