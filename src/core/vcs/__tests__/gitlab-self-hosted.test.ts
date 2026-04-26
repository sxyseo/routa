/**
 * GitLab Self-Hosted Instance Integration Tests
 *
 * Tests cover 3 common self-hosted scenarios:
 * 1. Self-hosted GitLab CE with custom URL
 * 2. Self-hosted GitLab EE with self-signed certificate
 * 3. Self-hosted GitLab with API version differences (graceful degradation)
 *
 * Uses mocked fetch to simulate various server responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitLabProvider } from "../gitlab-provider";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("GitLab Self-Hosted Compatibility", () => {
  let provider: GitLabProvider;

  beforeEach(() => {
    provider = new GitLabProvider();
    mockFetch.mockReset();
  });

  afterEach(() => {
    delete process.env.GITLAB_URL;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GITLAB_SKIP_SSL_VERIFY;
    delete process.env.PLATFORM;
  });

  describe("Scenario 1: Self-hosted GitLab CE with custom URL", () => {
    it("uses custom GITLAB_URL as API base", async () => {
      process.env.GITLAB_URL = "https://gitlab.example.com";
      process.env.GITLAB_TOKEN = "glpat-test-token";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path_with_namespace: "group/project",
          web_url: "https://gitlab.example.com/group/project",
          http_url_to_repo: "https://gitlab.example.com/group/project.git",
          default_branch: "main",
          visibility: "private",
        }),
      });

      const repo = await provider.getRepo({ repo: "group/project" });
      expect(repo.full_name).toBe("group/project");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/projects/group%2Fproject",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer glpat-test-token",
          }),
        }),
      );
    });

    it("handles 404 with actionable error for missing projects", async () => {
      process.env.GITLAB_URL = "https://gitlab.internal.local";
      process.env.GITLAB_TOKEN = "glpat-test-token";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      });

      await expect(
        provider.getRepo({ repo: "nonexistent/project" }),
      ).rejects.toThrow(/resource not found.*project path/);
    });

    it("handles 401 with actionable error for invalid tokens", async () => {
      process.env.GITLAB_URL = "https://gitlab.internal.local";
      process.env.GITLAB_TOKEN = "invalid-token";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(
        provider.getRepo({ repo: "group/project" }),
      ).rejects.toThrow(/authentication failed.*GITLAB_TOKEN/);
    });
  });

  describe("Scenario 2: Self-hosted GitLab with self-signed certificate", () => {
    it("detects self-signed certificate error and provides actionable message", async () => {
      process.env.GITLAB_URL = "https://gitlab.self-signed.local";
      process.env.GITLAB_TOKEN = "glpat-test-token";

      const certError = new TypeError(
        "fetch failed: self signed certificate in certificate chain",
      );
      mockFetch.mockRejectedValueOnce(certError);

      await expect(
        provider.getRepo({ repo: "group/project" }),
      ).rejects.toThrow(/SSL certificate.*GITLAB_SKIP_SSL_VERIFY/);
    });

    it("detects connection refused and provides actionable message", async () => {
      process.env.GITLAB_URL = "https://gitlab.down.local";
      process.env.GITLAB_TOKEN = "glpat-test-token";

      const connError = new TypeError("fetch failed: ECONNREFUSED");
      mockFetch.mockRejectedValueOnce(connError);

      await expect(
        provider.getRepo({ repo: "group/project" }),
      ).rejects.toThrow(/connection refused.*GITLAB_URL/);
    });

    it("shouldSkipSsl returns true when env is set", () => {
      process.env.GITLAB_SKIP_SSL_VERIFY = "true";
      // Access private method via instance
      expect((provider as unknown as { shouldSkipSsl: () => boolean }).shouldSkipSsl()).toBe(true);
    });

    it("shouldSkipSsl returns false by default", () => {
      expect((provider as unknown as { shouldSkipSsl: () => boolean }).shouldSkipSsl()).toBe(false);
    });

    it("webhook registration includes enable_ssl_verification based on skip setting", async () => {
      process.env.GITLAB_URL = "https://gitlab.self-signed.local";
      process.env.GITLAB_TOKEN = "glpat-test-token";
      process.env.GITLAB_SKIP_SSL_VERIFY = "true";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, url: "https://hook.url" }),
      });

      await provider.registerWebhook({
        repo: "group/project",
        webhookUrl: "https://hook.url",
        secret: "secret",
        events: ["push"],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(callBody.enable_ssl_verification).toBe(false);
    });
  });

  describe("Scenario 3: GitLab API version differences (graceful degradation)", () => {
    it("gracefully handles API version detection failure", async () => {
      process.env.GITLAB_URL = "https://gitlab.old.local";
      process.env.GITLAB_TOKEN = "glpat-test-token";

      // Both /version and /metadata return 404 (old GitLab CE)
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await provider.detectApiVersion();
      expect(result.detected).toBe(false);
      expect(result.version).toBe("v4"); // Safe default
    });

    it("gracefully degrades approval API on CE (404 fallback)", async () => {
      process.env.GITLAB_URL = "https://gitlab-ce.local";
      process.env.GITLAB_TOKEN = "glpat-test-token";

      // First call: approve endpoint returns 404 (CE doesn't have it)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      });

      // Second call: fallback to comment
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 42,
          body: "✅ Approved",
          note: "✅ Approved",
          noteable_type: "MergeRequest",
          noteable_iid: 1,
          project_id: 1,
          created_at: "2024-01-01T00:00:00Z",
          author: { username: "testuser" },
        }),
      });

      const comment = await provider.postPRReview({
        repo: "group/project",
        prNumber: 1,
        body: "LGTM",
        event: "APPROVE",
      });

      expect(comment.body).toBe("✅ Approved");
      // Verify the fallback comment was posted
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("handles 406 (feature not available) with actionable error", async () => {
      process.env.GITLAB_URL = "https://gitlab-ce.local";
      process.env.GITLAB_TOKEN = "glpat-test-token";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 406,
        text: async () => "Not Acceptable",
      });

      await expect(
        provider.getRepo({ repo: "group/project" }),
      ).rejects.toThrow(/feature not available.*Enterprise Edition/);
    });
  });
});
