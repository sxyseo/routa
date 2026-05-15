/**
 * @vitest-environment node
 *
 * GitLabProvider 分页单元测试
 *
 * 覆盖场景：
 * - 多页分页合并
 * - 单页直接返回
 * - 超过 maxPages 安全停止
 * - listBranches / listWebhooks 使用分页
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock global fetch
const mockFetch = vi.fn() as Mock;
vi.stubGlobal("fetch", mockFetch);

// Helper: build a mock Response with JSON body and optional headers
function mockResponse(data: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(headers),
  } as unknown as Response;
}

// Import after mock setup
import { GitLabProvider } from "../gitlab-provider";

describe("GitLabProvider pagination", () => {
  let provider: GitLabProvider;

  beforeEach(() => {
    provider = new GitLabProvider();
    mockFetch.mockReset();
    process.env.GITLAB_TOKEN = "test-token";
  });

  describe("listBranches - pagination", () => {
    it("returns all branches across multiple pages", async () => {
      const page1 = [
        { name: "main", commit: { id: "abc123" }, protected: true },
        { name: "develop", commit: { id: "def456" }, protected: false },
      ];
      const page2 = [
        { name: "feature/x", commit: { id: "ghi789" }, protected: false },
      ];

      mockFetch
        .mockResolvedValueOnce(mockResponse(page1, { "x-next-page": "2" }))
        .mockResolvedValueOnce(mockResponse(page2));

      const result = await provider.listBranches({ repo: "group/project" });

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("main");
      expect(result[2].name).toBe("feature/x");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns single page directly when no x-next-page header", async () => {
      const branches = [
        { name: "main", commit: { id: "abc123" }, protected: true },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(branches));

      const result = await provider.listBranches({ repo: "group/project" });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("main");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("listWebhooks - pagination", () => {
    it("returns all webhooks across multiple pages", async () => {
      const page1 = [
        {
          id: 1,
          url: "https://example.com/hook1",
          push_events: true,
          issues_events: false,
          merge_requests_events: false,
          wiki_page_events: false,
          deployment_events: false,
          job_events: false,
          pipeline_events: false,
          releases_events: false,
          tag_push_events: false,
          note_events: false,
          confidential_issues_events: false,
          confidential_note_events: false,
          enabled: true,
        },
      ];
      const page2 = [
        {
          id: 2,
          url: "https://example.com/hook2",
          push_events: false,
          issues_events: true,
          merge_requests_events: true,
          wiki_page_events: false,
          deployment_events: false,
          job_events: false,
          pipeline_events: false,
          releases_events: false,
          tag_push_events: false,
          note_events: false,
          confidential_issues_events: false,
          confidential_note_events: false,
          enabled: true,
        },
      ];

      mockFetch
        .mockResolvedValueOnce(mockResponse(page1, { "x-next-page": "2" }))
        .mockResolvedValueOnce(mockResponse(page2));

      const result = await provider.listWebhooks({ repo: "group/project" });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[0].events).toContain("push_events");
      expect(result[1].id).toBe(2);
      expect(result[1].events).toContain("issues_events");
    });

    it("returns single page when no pagination needed", async () => {
      const webhooks = [
        {
          id: 10,
          url: "https://example.com/hook",
          push_events: true,
          issues_events: true,
          merge_requests_events: false,
          wiki_page_events: false,
          deployment_events: false,
          job_events: false,
          pipeline_events: false,
          releases_events: false,
          tag_push_events: false,
          note_events: false,
          confidential_issues_events: false,
          confidential_note_events: false,
          enabled: true,
        },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(webhooks));

      const result = await provider.listWebhooks({ repo: "group/project" });

      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("listPRs - pagination", () => {
    it("merges multiple pages of MR data", async () => {
      const page1 = [
        {
          id: 1,
          iid: 101,
          title: "MR 1",
          web_url: "https://gitlab.com/group/project/-/merge_requests/101",
          state: "opened",
          draft: false,
          merged_at: null,
          source_branch: "feature/a",
          target_branch: "main",
        },
      ];
      const page2 = [
        {
          id: 2,
          iid: 102,
          title: "MR 2",
          web_url: "https://gitlab.com/group/project/-/merge_requests/102",
          state: "opened",
          draft: false,
          merged_at: null,
          source_branch: "feature/b",
          target_branch: "main",
        },
      ];

      mockFetch
        .mockResolvedValueOnce(mockResponse(page1, { "x-next-page": "2" }))
        .mockResolvedValueOnce(mockResponse(page2));

      const result = await provider.listPRs({ repo: "group/project" });

      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(101);
      expect(result[1].number).toBe(102);
    });
  });

  describe("listIssues - pagination", () => {
    it("merges multiple pages of issue data", async () => {
      const page1 = [
        {
          id: 1,
          iid: 1,
          title: "Issue 1",
          web_url: "https://gitlab.com/group/project/-/issues/1",
          state: "opened",
        },
      ];
      const page2 = [
        {
          id: 2,
          iid: 2,
          title: "Issue 2",
          web_url: "https://gitlab.com/group/project/-/issues/2",
          state: "opened",
        },
      ];

      mockFetch
        .mockResolvedValueOnce(mockResponse(page1, { "x-next-page": "2" }))
        .mockResolvedValueOnce(mockResponse(page2));

      const result = await provider.listIssues({ repo: "group/project" });

      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(1);
      expect(result[1].number).toBe(2);
    });
  });

  describe("maxPages safety limit", () => {
    it("stops pagination after reaching maxPages and returns collected data", async () => {
      // Generate pages that always have x-next-page to simulate unlimited data
      const makePage = (n: number) => [
        { name: `branch-p${n}`, commit: { id: `sha-p${n}` }, protected: false },
      ];

      // Mock 101 pages worth of responses - each with x-next-page set
      for (let i = 1; i <= 101; i++) {
        mockFetch.mockResolvedValueOnce(
          mockResponse(makePage(i), { "x-next-page": String(i + 1) })
        );
      }

      // Default maxPages is 100, so should stop at 100 pages
      const result = await provider.listBranches({ repo: "group/project" });

      // Should have exactly 100 branches (100 pages x 1 branch each)
      expect(result).toHaveLength(100);
      // Should have made exactly 100 fetch calls (not 101)
      expect(mockFetch).toHaveBeenCalledTimes(100);
    });
  });
});
