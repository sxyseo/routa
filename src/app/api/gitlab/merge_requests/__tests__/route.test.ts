// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListPRs = vi.fn();

vi.mock("@/core/vcs", () => {
  return {
    GitLabProvider: class MockGitLabProvider {
      listPRs = mockListPRs;
    },
  };
});

import { GET } from "../route";

describe("GET /api/gitlab/merge_requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPRs.mockResolvedValue([
      {
        id: "2001",
        number: 5,
        title: "Fix login bug",
        url: "https://gitlab.com/acme/platform/-/merge_requests/5",
        state: "open",
        labels: [],
        assignees: [],
        updatedAt: "2024-01-01T00:00:00Z",
        draft: false,
        headRef: "fix/login",
        baseRef: "main",
      },
    ]);
  });

  // AC5: token 缺失返回 401
  it("returns 401 when token is missing", async () => {
    const response = await GET(new NextRequest("http://localhost/api/gitlab/merge_requests?repo=acme/platform"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "token is required" });
  });

  // AC5: repo 缺失返回 400
  it("returns 400 when repo is missing", async () => {
    const response = await GET(new NextRequest("http://localhost/api/gitlab/merge_requests?token=glpat-xxx"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "repo is required" });
  });

  // AC2: 返回 MR 列表 JSON
  it("returns merge request list with default state=opened", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/merge_requests?repo=acme/platform&token=glpat-xxx"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockListPRs).toHaveBeenCalledWith({
      repo: "acme/platform",
      state: "open", // "opened" maps to "open" for provider
      token: "glpat-xxx",
    });
    expect(data).toMatchObject({
      repo: "acme/platform",
      merge_requests: [{ number: 5, title: "Fix login bug" }],
    });
  });

  // AC4: 支持 opened/closed/merged/all
  it("accepts state=closed", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/merge_requests?repo=acme/platform&token=glpat-xxx&state=closed"),
    );

    expect(response.status).toBe(200);
    expect(mockListPRs).toHaveBeenCalledWith(
      expect.objectContaining({ state: "closed" }),
    );
  });

  it("accepts state=all", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/merge_requests?repo=acme/platform&token=glpat-xxx&state=all"),
    );

    expect(response.status).toBe(200);
    expect(mockListPRs).toHaveBeenCalledWith(
      expect.objectContaining({ state: "all" }),
    );
  });

  it("filters merged MRs when state=merged", async () => {
    mockListPRs.mockResolvedValue([
      { id: "1", number: 1, title: "Merged MR", mergedAt: "2024-01-01T00:00:00Z", state: "closed" },
      { id: "2", number: 2, title: "Closed MR", mergedAt: undefined, state: "closed" },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/merge_requests?repo=acme/platform&token=glpat-xxx&state=merged"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    // "merged" maps to "closed" for API, then filters for mergedAt != null
    expect(mockListPRs).toHaveBeenCalledWith(
      expect.objectContaining({ state: "closed" }),
    );
    expect(data.merge_requests).toHaveLength(1);
    expect(data.merge_requests[0].title).toBe("Merged MR");
  });

  it("rejects invalid state", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/merge_requests?repo=acme/platform&token=glpat-xxx&state=invalid"),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("state must be one of");
  });

  // AC6: URL-encoded 多级路径
  it("decodes URL-encoded repo path for nested groups", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/merge_requests?repo=group%2Fsubgroup%2Fproject&token=glpat-xxx"),
    );

    expect(response.status).toBe(200);
    expect(mockListPRs).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "group/subgroup/project" }),
    );
  });

  // AC5: GitLab API 错误返回 502
  it("returns 502 on GitLab API error", async () => {
    mockListPRs.mockRejectedValue(new Error("GitLab API error 500: Internal Server Error"));

    const response = await GET(
      new NextRequest("http://localhost/api/gitlab/merge_requests?repo=acme/platform&token=glpat-xxx"),
    );
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error).toContain("GitLab API error 500");
  });

  // AC3: 复用 GitLabProvider（验证 mockListPRs 被调用即证明使用了 GitLabProvider 实例方法）
  it("uses GitLabProvider (not raw fetch)", async () => {
    await GET(
      new NextRequest("http://localhost/api/gitlab/merge_requests?repo=acme/platform&token=glpat-xxx"),
    );

    expect(mockListPRs).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/platform", token: "glpat-xxx" }),
    );
  });
});
