/**
 * GET /api/gitlab/merge_requests — List GitLab merge requests for a project.
 * Directly uses GitLabProvider (no workspace lookup required).
 */

import { NextRequest, NextResponse } from "next/server";
import { GitLabProvider } from "@/core/vcs";

export const dynamic = "force-dynamic";

const VALID_STATES = ["opened", "closed", "merged", "all"] as const;
type MRState = (typeof VALID_STATES)[number];

export async function GET(request: NextRequest) {
  const repo = request.nextUrl.searchParams.get("repo")?.trim();
  const token = request.nextUrl.searchParams.get("token")?.trim();
  const requestedState = request.nextUrl.searchParams.get("state")?.trim() ?? "opened";

  // AC5: token 缺失返回 401
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 401 });
  }

  // AC5: repo 缺失返回 400
  if (!repo) {
    return NextResponse.json({ error: "repo is required" }, { status: 400 });
  }

  // AC4: state 参数验证 — merge_requests 支持 opened/closed/merged/all
  const state: MRState | null = VALID_STATES.includes(requestedState as MRState)
    ? (requestedState as MRState)
    : null;

  if (!state) {
    return NextResponse.json(
      { error: "state must be one of: opened, closed, merged, all" },
      { status: 400 },
    );
  }

  // AC3: 复用 GitLabProvider
  const provider = new GitLabProvider();

  try {
    // AC6: repo 参数支持 URL-encoded 的多级路径
    const decodedRepo = decodeURIComponent(repo);

    // GitLab API 不直接支持 "merged" 状态过滤，需要映射
    // listPRs 接受 open/closed/all，merged 需额外过滤
    const apiState = state === "merged" ? "closed" : state === "opened" ? "open" : state;

    const mergeRequests = await provider.listPRs({
      repo: decodedRepo,
      state: apiState as "open" | "closed" | "all",
      token,
    });

    // 对 merged 状态做客户端过滤
    const filtered = state === "merged"
      ? mergeRequests.filter((mr) => mr.mergedAt != null)
      : mergeRequests;

    return NextResponse.json({ repo: decodedRepo, merge_requests: filtered });
  } catch (error) {
    // AC5: GitLab API 错误返回 502
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load GitLab merge requests" },
      { status: 502 },
    );
  }
}
