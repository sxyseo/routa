// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListIssues = vi.fn();

vi.mock("@/core/vcs", () => {
  return {
    GitLabProvider: class MockGitLabProvider {
      listIssues = mockListIssues;
    },
  };
});

import { GET } from "../route";

describe("GET /api/gitlab/issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListIssues.mockResolvedValue([
      {
        id: "1001",
        number: 12,
        title: "GitLab bug",
        url: "https://gitlab.com/acme/platform/-/issues/12",
        state: "open",
        labels: ["bug"],
        assignees: ["developer"],
      },
    ]);
  });

  // AC5: token 缺失返回 401
  it("returns 401 when token is missing", async () => {
    const response = await GET(new NextRequest("http://localhost/api/gitlab/issues?repo=acme/platform"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "token is required" });
  });

  // AC5: repo 缺失返回 400
  it("returns 400 when repo is missing", async () => {
    const response = await GET(new NextRequest("http://localhost/api/gitlab/issues?token=glpat-xxx"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "repo is required" });
  });

  // AC1: 返回 Issue 列表 JSON
  it("returns issue list with default state=open", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/issues?repo=acme/platform&token=glpat-xxx"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockListIssues).toHaveBeenCalledWith({
      repo: "acme/platform",
      state: "open",
      token: "glpat-xxx",
    });
    expect(data).toMatchObject({
      repo: "acme/platform",
      issues: [{ number: 12, title: "GitLab bug" }],
    });
  });

  // AC4: 支持 open/closed/all
  it("accepts state=closed", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/issues?repo=acme/platform&token=glpat-xxx&state=closed"),
    );

    expect(response.status).toBe(200);
    expect(mockListIssues).toHaveBeenCalledWith(
      expect.objectContaining({ state: "closed" }),
    );
  });

  it("accepts state=all", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/issues?repo=acme/platform&token=glpat-xxx&state=all"),
    );

    expect(response.status).toBe(200);
    expect(mockListIssues).toHaveBeenCalledWith(
      expect.objectContaining({ state: "all" }),
    );
  });

  it("rejects invalid state", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/issues?repo=acme/platform&token=glpat-xxx&state=invalid"),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("state must be one of");
  });

  // AC6: URL-encoded 多级路径
  it("decodes URL-encoded repo path for nested groups", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/issues?repo=group%2Fsubgroup%2Fproject&token=glpat-xxx"),
    );

    expect(response.status).toBe(200);
    expect(mockListIssues).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "group/subgroup/project" }),
    );
  });

  // AC5: GitLab API 错误返回 502
  it("returns 502 on GitLab API error", async () => {
    mockListIssues.mockRejectedValue(new Error("GitLab API error 403: Forbidden"));

    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/issues?repo=acme/platform&token=glpat-xxx"),
    );
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error).toContain("GitLab API error 403");
  });

  // AC3: 复用 GitLabProvider（验证 mockListIssues 被调用即证明使用了 GitLabProvider 实例方法）
  it("uses GitLabProvider (not raw fetch)", async () => {
    await GET(
      new NextRequest("http://localhost/api/gitlab/issues?repo=acme/platform&token=glpat-xxx"),
    );

    expect(mockListIssues).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/platform", token: "glpat-xxx" }),
    );
  });
});
