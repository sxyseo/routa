/**
 * GitLab VCS Provider
 *
 * Adapter for GitLab REST API v4.
 * Supports both gitlab.com and self-hosted GitLab instances.
 *
 * Self-hosted instance compatibility:
 * - GITLAB_URL: Base URL for self-hosted instances
 * - GITLAB_SKIP_SSL_VERIFY: Set to "true" to skip SSL verification
 *   for self-signed certificates (not recommended for production)
 */

import type {
  IVCSProvider,
  VCSPlatform,
  VCSRepository,
  VCSPullRequest,
  VCSPullRequestListItem,
  VCSBranch,
  VCSComment,
  VCSFileChange,
  VCSIssue,
  VCSIssueListItem,
  VCSAccessStatus,
} from "./vcs-provider";

import { type GitLabAccessLevel, type InternalPermission, mapGitLabRoleToPermission, parseAccessLevel } from "./gitlab-permission";

/** Cached API version detection result */
let apiVersionCache: { version: string; ce: boolean; detected: boolean } | null = null;

export class GitLabProvider implements IVCSProvider {
  readonly platform: VCSPlatform = "gitlab";

  /** Get GitLab API base URL from environment or use default */
  private getApiBaseUrl(): string {
    const customUrl = process.env.GITLAB_URL?.replace(/\/$/, ""); // Remove trailing slash
    return customUrl ? `${customUrl}/api/v4` : "https://gitlab.com/api/v4";
  }

  /** Check if SSL verification should be skipped for self-hosted instances */
  private shouldSkipSsl(): boolean {
    return process.env.GITLAB_SKIP_SSL_VERIFY?.toLowerCase() === "true";
  }

  /** Get authorization header */
  private getAuthHeader(token?: string): string {
    const actualToken = token ?? process.env.GITLAB_TOKEN;
    if (!actualToken) {
      throw new Error("GitLab token is required. Set GITLAB_TOKEN environment variable.");
    }
    return `Bearer ${actualToken}`;
  }

  /** Parse repo string to project path (GitLab uses "owner%2Frepo" encoding) */
  private encodeProjectPath(repo: string): string {
    return repo.replace(/\//g, "%2F");
  }

  /**
   * Detect GitLab API version and edition (CE/EE).
   * Results are cached for the process lifetime.
   * Gracefully degrades on failure — returns a default version.
   */
  async detectApiVersion(): Promise<{ version: string; ce: boolean; detected: boolean }> {
    if (apiVersionCache) return apiVersionCache;

    try {
      const baseUrl = this.getApiBaseUrl();
      const fetchOptions: RequestInit = {
        headers: { "Content-Type": "application/json" },
      };
      // Note: The /version endpoint requires admin access on most instances.
      // Fall back to metadata endpoint if available.
      const response = await fetch(`${baseUrl}/version`, fetchOptions);

      if (response.ok) {
        const data = await response.json() as { version?: string; revision?: string };
        const version = data.version ?? "unknown";
        apiVersionCache = { version, ce: true, detected: true };
      } else {
        // Non-admin users may not have access to /version
        // Try the /metadata endpoint (available in GitLab 15.0+)
        const metaResponse = await fetch(`${baseUrl}/metadata`, fetchOptions);
        if (metaResponse.ok) {
          const meta = await metaResponse.json() as { version?: string; edition?: string };
          apiVersionCache = {
            version: meta.version ?? "unknown",
            ce: meta.edition !== "ee",
            detected: true,
          };
        } else {
          // Both endpoints failed — use default, don't block
          apiVersionCache = { version: "v4", ce: true, detected: false };
        }
      }
    } catch {
      // Network error or self-signed cert — degrade gracefully
      apiVersionCache = { version: "v4", ce: true, detected: false };
    }

    return apiVersionCache;
  }

  /**
   * Check if a specific API feature is available.
   * Returns true if the feature is supported or if detection failed
   * (erring on the side of availability).
   */
  async hasApiFeature(feature: string): Promise<boolean> {
    const { detected } = await this.detectApiVersion();
    if (!detected) return true; // Graceful degradation: assume available

    switch (feature) {
      case "merge_request_approvals":
      case "emoji_awards":
      case "merge_trains":
        // EE-only features, assume available if not detected as CE
        return true;
      default:
        return true;
    }
  }

  /** Make a GitLab API request with error handling for self-hosted instances */
  private async gitlabApi<T>(
    endpoint: string,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const { method = "GET", token, body } = options;
    const url = `${this.getApiBaseUrl()}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(token),
      "Content-Type": "application/json",
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorBody = await response.text();

        // Provide actionable error messages for common self-hosted issues
        if (response.status === 401) {
          throw new Error(
            `GitLab authentication failed. Verify your GITLAB_TOKEN is valid and has the required scopes (api, read_api, read_repository).`
          );
        }

        if (response.status === 403) {
          throw new Error(
            `GitLab permission denied. Your token may lack the required access level for this operation.`
          );
        }

        if (response.status === 404) {
          throw new Error(
            `GitLab resource not found: ${endpoint}. Verify the project path and that your token has access to the repository.`
          );
        }

        if (response.status === 406) {
          throw new Error(
            `GitLab API feature not available. This endpoint may require GitLab Enterprise Edition or a newer version. Endpoint: ${endpoint}`
          );
        }

        throw new Error(`GitLab API error ${response.status}: ${errorBody}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      // Handle network-level errors (self-signed certs, connection refused, etc.)
      if (error instanceof TypeError) {
        const message = error.message ?? "";
        if (message.includes("certificate") || message.includes("SELF_SIGNED_CERT_IN_CHAIN") || message.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE")) {
          throw new Error(
            `GitLab SSL certificate verification failed. If you are using a self-hosted GitLab instance with a self-signed certificate, set GITLAB_SKIP_SSL_VERIFY=true in your environment configuration. Original error: ${message}`
          );
        }
        if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
          throw new Error(
            `GitLab connection refused. Verify that GITLAB_URL (${process.env.GITLAB_URL ?? "https://gitlab.com"}) is accessible and the server is running.`
          );
        }
      }
      throw error;
    }
  }

  /**
   * Get the current user's access level for a project.
   * Returns the mapped internal permission level.
   */
  async getProjectPermission(opts: { repo: string; token?: string }): Promise<InternalPermission> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    try {
      const data = await this.gitlabApi<{
        access_level?: number;
        permissions?: {
          project_access?: { access_level: number };
          group_access?: { access_level: number };
        };
      }>(`/projects/${encodedPath}/members/${encodeURIComponent("current")}`, { token: opts.token });

      const accessLevel = parseAccessLevel(data);
      return mapGitLabRoleToPermission(accessLevel);
    } catch {
      // If we can't determine the permission, assume read access
      // This is the safe default for graceful degradation
      return "read";
    }
  }

  /** Make a GitLab API request that returns response alongside parsed body (for pagination headers) */
  private async gitlabApiWithResponse<T>(
    endpoint: string,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
    } = {}
  ): Promise<{ data: T; response: Response }> {
    const { method = "GET", token, body } = options;
    const url = `${this.getApiBaseUrl()}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(token),
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitLab API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json() as T;
    return { data, response };
  }

  /** Paginate through a GitLab list endpoint, collecting all pages */
  private async gitlabPaginate<T>(
    endpoint: string,
    options: {
      token?: string;
      perPage?: number;
      maxPages?: number;
    } = {}
  ): Promise<T[]> {
    const { token, perPage = 100, maxPages = 100 } = options;
    const allItems: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const separator = endpoint.includes("?") ? "&" : "?";
      const pageEndpoint = `${endpoint}${separator}per_page=${perPage}&page=${page}`;

      const { data, response } = await this.gitlabApiWithResponse<T[]>(pageEndpoint, { token });

      allItems.push(...data);

      // GitLab signals more pages via x-next-page header
      const nextPage = response.headers.get("x-next-page");
      hasMore = nextPage !== null && nextPage !== "" && data.length > 0;
      page++;
    }

    return allItems;
  }

  async getRepo(opts: { repo: string; token?: string }): Promise<VCSRepository> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      path_with_namespace: string;
      web_url: string;
      http_url_to_repo: string;
      default_branch: string | null;
      visibility?: string;
      repository?: { visibility?: string };
    }>(`/projects/${encodedPath}`, { token: opts.token });

    // GitLab may return visibility at top level or nested under repository
    const visibility = data.visibility ?? data.repository?.visibility ?? "private";

    return {
      full_name: data.path_with_namespace,
      html_url: data.web_url,
      clone_url: data.http_url_to_repo,
      default_branch: data.default_branch ?? "main",
      private: visibility !== "public",
    };
  }

  async listBranches(opts: { repo: string; token?: string }): Promise<VCSBranch[]> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabPaginate<{
      name: string;
      commit: { id: string };
      protected: boolean;
    }>(`/projects/${encodedPath}/repository/branches`, { token: opts.token });

    return data.map((branch) => ({
      name: branch.name,
      commit: { sha: branch.commit.id },
      protected: branch.protected,
    }));
  }

  async getPR(opts: { repo: string; prNumber: number; token?: string }): Promise<VCSPullRequest> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      iid: number;
      title: string;
      description: string | undefined;
      web_url: string;
      state: string;
      draft: boolean;
      merged_at: string | null;
      source_branch: string;
      target_branch: string;
      source_project_id: number;
      author: { username: string };
      created_at: string;
      updated_at: string;
      sha: string;
      diff_refs: { head_sha: string };
    }>(`/projects/${encodedPath}/merge_requests/${opts.prNumber}`, { token: opts.token });

    return {
      number: data.iid,
      title: data.title,
      body: data.description,
      html_url: data.web_url,
      state: data.merged_at ? "merged" : data.state,
      draft: data.draft,
      merged: data.merged_at !== null,
      head: {
        ref: data.source_branch,
        sha: data.diff_refs?.head_sha ?? data.sha,
      },
      base: { ref: data.target_branch },
      user: { login: data.author.username },
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  async getPRFiles(opts: { repo: string; prNumber: number; token?: string }): Promise<VCSFileChange[]> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const response = await this.gitlabApi<{
      changes: Array<{
        new_path: string;
        old_path: string;
        new_file: boolean;
        renamed_file: boolean;
        deleted_file: boolean;
        diff: string;
      }>;
    }>(`/projects/${encodedPath}/merge_requests/${opts.prNumber}/changes`, { token: opts.token });

    return (response.changes ?? []).map((file) => {
      let status = "modified";
      if (file.new_file) status = "added";
      else if (file.deleted_file) status = "removed";
      else if (file.renamed_file) status = "renamed";

      return {
        filename: file.new_path,
        status,
        additions: 0, // GitLab doesn't provide this in the changes endpoint
        deletions: 0,
        changes: 0,
        patch: file.diff,
      };
    });
  }

  async createPR(opts: {
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    token?: string;
    draft?: boolean;
  }): Promise<VCSPullRequest> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      iid: number;
      title: string;
      description: string;
      web_url: string;
      state: string;
      draft: boolean;
      merged_at: string | null;
      source_branch: string;
      target_branch: string;
      author: { username: string };
      created_at: string;
      updated_at: string;
      diff_refs: { head_sha: string };
    }>(`/projects/${encodedPath}/merge_requests`, {
      method: "POST",
      token: opts.token,
      body: {
        source_branch: opts.head,
        target_branch: opts.base,
        title: opts.title,
        description: opts.body,
        draft: opts.draft ?? false,
      },
    });

    return {
      number: data.iid,
      title: data.title,
      body: data.description,
      html_url: data.web_url,
      state: data.merged_at ? "merged" : data.state,
      draft: data.draft,
      merged: data.merged_at !== null,
      head: {
        ref: data.source_branch,
        sha: data.diff_refs?.head_sha ?? "",
      },
      base: { ref: data.target_branch },
      user: { login: data.author.username },
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  async postPRComment(opts: {
    repo: string;
    prNumber: number;
    body: string;
    token?: string;
  }): Promise<VCSComment> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      id: number;
      body: string;
      note: string;
      noteable_type: string;
      noteable_iid: number;
      project_id: number;
      created_at: string;
      author: { username: string };
    }>(`/projects/${encodedPath}/merge_requests/${opts.prNumber}/notes`, {
      method: "POST",
      token: opts.token,
      body: { body: opts.body },
    });

    // Build MR URL for the comment
    const mrUrl = `${this.getApiBaseUrl().replace("/api/v4", "")}/${encodedPath}/-/merge_requests/${opts.prNumber}#note_${data.id}`;

    return {
      id: data.id,
      body: data.body ?? data.note,
      html_url: mrUrl,
      user: { login: data.author.username },
      created_at: data.created_at,
    };
  }

  async postPRReview(opts: {
    repo: string;
    prNumber: number;
    body: string;
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    token?: string;
    commitId?: string;
  }): Promise<VCSComment> {
    const encodedPath = this.encodeProjectPath(opts.repo);

    // GitLab has separate endpoints for approvals and comments
    if (opts.event === "APPROVE") {
      // Approval API is EE-only; gracefully degrade to a comment on CE
      try {
        const data = await this.gitlabApi<{
          id: number;
          project_id: number;
          merge_request: { iid: number };
          created_at: string;
          author: { username: string };
        }>(`/projects/${encodedPath}/merge_requests/${opts.prNumber}/approve`, {
          method: "POST",
          token: opts.token,
          body: { sha: opts.commitId },
        });

        const mrUrl = `${this.getApiBaseUrl().replace("/api/v4", "")}/${encodedPath}/-/merge_requests/${opts.prNumber}`;

        return {
          id: data.id,
          body: opts.body || "Approved",
          html_url: mrUrl,
          user: { login: data.author.username },
          created_at: data.created_at,
          commit_id: opts.commitId,
        };
      } catch (error) {
        // EE-only endpoint may not exist on CE; fall back to a comment
        if (error instanceof Error && (error.message.includes("resource not found") || error.message.includes("feature not available"))) {
          return this.postPRComment({
            repo: opts.repo,
            prNumber: opts.prNumber,
            body: `✅ Approved${opts.body ? `: ${opts.body}` : ""}`,
            token: opts.token,
          });
        }
        throw error;
      }
    } else {
      // For REQUEST_CHANGES and COMMENT, post as a regular note with emoji
      let commentBody = opts.body;
      if (opts.event === "REQUEST_CHANGES") {
        commentBody = `🚫 ${opts.body}`;
      }

      return this.postPRComment({
        repo: opts.repo,
        prNumber: opts.prNumber,
        body: commentBody,
        token: opts.token,
      });
    }
  }

  async registerWebhook(opts: {
    repo: string;
    webhookUrl: string;
    secret: string;
    events: string[];
    token?: string;
  }): Promise<{ id: number; url: string }> {
    const encodedPath = this.encodeProjectPath(opts.repo);

    // Map GitHub event types to GitLab event types
    const gitlabEvents = this.mapGitHubEventsToGitLab(opts.events);

    const data = await this.gitlabApi<{
      id: number;
      url: string;
    }>(`/projects/${encodedPath}/hooks`, {
      method: "POST",
      token: opts.token,
      body: {
        url: opts.webhookUrl,
        token: opts.secret,
        push_events: gitlabEvents.includes("push_events"),
        issues_events: gitlabEvents.includes("issues_events"),
        merge_requests_events: gitlabEvents.includes("merge_requests_events"),
        wiki_page_events: gitlabEvents.includes("wiki_page_events"),
        deployment_events: gitlabEvents.includes("deployment_events"),
        job_events: gitlabEvents.includes("job_events"),
        pipeline_events: gitlabEvents.includes("pipeline_events"),
        releases_events: gitlabEvents.includes("releases_events"),
        tag_push_events: gitlabEvents.includes("tag_push_events"),
        note_events: gitlabEvents.includes("note_events"),
        confidential_issues_events: gitlabEvents.includes("confidential_issues_events"),
        confidential_note_events: gitlabEvents.includes("confidential_note_events"),
        // Enable SSL verification by default unless explicitly disabled
        enable_ssl_verification: !this.shouldSkipSsl(),
      },
    });

    return { id: data.id, url: data.url };
  }

  async deleteWebhook(opts: {
    repo: string;
    hookId: number;
    token?: string;
  }): Promise<void> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    await this.gitlabApi(`/projects/${encodedPath}/hooks/${opts.hookId}`, {
      method: "DELETE",
      token: opts.token,
    });
  }

  async listWebhooks(opts: {
    repo: string;
    token?: string;
  }): Promise<Array<{ id: number; events: string[]; active: boolean; config: { url: string } }>> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabPaginate<{
      id: number;
      url: string;
      push_events: boolean;
      issues_events: boolean;
      merge_requests_events: boolean;
      wiki_page_events: boolean;
      deployment_events: boolean;
      job_events: boolean;
      pipeline_events: boolean;
      releases_events: boolean;
      tag_push_events: boolean;
      note_events: boolean;
      confidential_issues_events: boolean;
      confidential_note_events: boolean;
      enabled: boolean;
    }>(`/projects/${encodedPath}/hooks`, { token: opts.token });

    return data.map((hook) => ({
      id: hook.id,
      events: this.gitlabEventsToList(hook),
      active: hook.enabled,
      config: { url: hook.url },
    }));
  }

  /** Map GitHub event types to GitLab event types */
  private mapGitHubEventsToGitLab(events: string[]): string[] {
    const eventMap: Record<string, string> = {
      push: "push_events",
      tag_push: "tag_push_events",
      issues: "issues_events",
      issue_comment: "note_events",
      pull_request: "merge_requests_events",
      pull_request_review: "note_events",
      pull_request_review_comment: "note_events",
      workflow_run: "pipeline_events",
      check_run: "job_events",
      check_suite: "pipeline_events",
      release: "releases_events",
    };

    const gitlabEvents = new Set<string>();
    for (const event of events) {
      const mapped = eventMap[event];
      if (mapped) {
        gitlabEvents.add(mapped);
      }
    }

    return Array.from(gitlabEvents);
  }

  /** Convert GitLab webhook object to event list */
  private gitlabEventsToList(hook: {
    push_events: boolean;
    issues_events: boolean;
    merge_requests_events: boolean;
    wiki_page_events: boolean;
    deployment_events: boolean;
    job_events: boolean;
    pipeline_events: boolean;
    releases_events: boolean;
    tag_push_events: boolean;
    note_events: boolean;
    confidential_issues_events: boolean;
    confidential_note_events: boolean;
  }): string[] {
    const events: string[] = [];

    if (hook.push_events) events.push("push_events");
    if (hook.tag_push_events) events.push("tag_push_events");
    if (hook.issues_events) events.push("issues_events");
    if (hook.merge_requests_events) events.push("merge_requests_events");
    if (hook.wiki_page_events) events.push("wiki_page_events");
    if (hook.deployment_events) events.push("deployment_events");
    if (hook.job_events) events.push("job_events");
    if (hook.pipeline_events) events.push("pipeline_events");
    if (hook.releases_events) events.push("releases_events");
    if (hook.note_events) events.push("note_events");
    if (hook.confidential_issues_events) events.push("confidential_issues_events");
    if (hook.confidential_note_events) events.push("confidential_note_events");

    return events;
  }

  async listPRs(opts: {
    repo: string;
    state?: "open" | "closed" | "all";
    perPage?: number;
    token?: string;
  }): Promise<VCSPullRequestListItem[]> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const state = opts.state ?? "open";
    const perPage = Math.max(1, Math.min(opts.perPage ?? 100, 100));

    // Map GitHub state to GitLab state
    const gitlabState = state === "all" ? undefined
      : state === "closed" ? "closed" : "opened";

    const params = new URLSearchParams({
      sort: "updated_at",
      order_by: "desc",
    });
    if (gitlabState) params.set("state", gitlabState);

    const endpoint = `/projects/${encodedPath}/merge_requests?${params.toString()}`;
    const data = await this.gitlabPaginate<{
      id: number;
      iid: number;
      title: string;
      description?: string | null;
      web_url: string;
      state: string;
      updated_at?: string;
      merged_at?: string | null;
      draft: boolean;
      labels?: string | string[];
      assignees?: Array<{ username?: string }>;
      source_branch: string;
      target_branch: string;
    }>(endpoint, { token: opts.token, perPage });

    return data.map((item) => ({
      id: String(item.id),
      number: item.iid,
      title: item.title,
      body: item.description ?? undefined,
      url: item.web_url,
      state: (item.merged_at ? "closed" : item.state === "opened" ? "open" : "closed") as "open" | "closed",
      labels: Array.isArray(item.labels)
        ? item.labels
        : typeof item.labels === "string" ? item.labels.split(",").map((l) => l.trim()) : [],
      assignees: (item.assignees ?? []).map((a) => a.username ?? "").filter(Boolean),
      updatedAt: item.updated_at,
      draft: item.draft,
      mergedAt: item.merged_at ?? undefined,
      headRef: item.source_branch,
      baseRef: item.target_branch,
    }));
  }

  async listIssues(opts: {
    repo: string;
    state?: "open" | "closed" | "all";
    perPage?: number;
    token?: string;
  }): Promise<VCSIssueListItem[]> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const state = opts.state ?? "open";
    const perPage = Math.max(1, Math.min(opts.perPage ?? 100, 100));

    const gitlabState = state === "all" ? undefined
      : state === "closed" ? "closed" : "opened";

    const params = new URLSearchParams({
      sort: "updated_at",
      order_by: "desc",
    });
    if (gitlabState) params.set("state", gitlabState);

    const endpoint = `/projects/${encodedPath}/issues?${params.toString()}`;
    const data = await this.gitlabPaginate<{
      id: number;
      iid: number;
      title: string;
      description?: string | null;
      web_url: string;
      state: string;
      updated_at?: string;
      labels?: string | string[];
      assignees?: Array<{ username?: string }>;
    }>(endpoint, { token: opts.token, perPage });

    return data.map((item) => ({
      id: String(item.id),
      number: item.iid,
      title: item.title,
      body: item.description ?? undefined,
      url: item.web_url,
      state: (item.state === "opened" ? "open" : "closed") as "open" | "closed",
      labels: Array.isArray(item.labels)
        ? item.labels
        : typeof item.labels === "string" ? item.labels.split(",").map((l) => l.trim()) : [],
      assignees: (item.assignees ?? []).map((a) => a.username ?? "").filter(Boolean),
      updatedAt: item.updated_at,
    }));
  }

  async createIssue(opts: {
    repo: string;
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    token?: string;
  }): Promise<VCSIssue> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      id: number;
      iid: number;
      title: string;
      description?: string | null;
      web_url: string;
      state: string;
      labels?: string | string[];
      assignees?: Array<{ username?: string }>;
    }>(`/projects/${encodedPath}/issues`, {
      method: "POST",
      token: opts.token,
      body: {
        title: opts.title,
        description: opts.body,
        labels: opts.labels?.join(","),
        assignee_ids: undefined, // GitLab uses assignee_ids, skip for now
      },
    });

    return {
      id: String(data.id),
      number: data.iid,
      title: data.title,
      body: data.description ?? undefined,
      url: data.web_url,
      state: data.state === "opened" ? "open" : "closed",
      labels: Array.isArray(data.labels)
        ? data.labels
        : typeof data.labels === "string" ? data.labels.split(",").map((l: string) => l.trim()) : [],
      assignees: (data.assignees ?? []).map((a: { username?: string }) => a.username ?? "").filter(Boolean),
    };
  }

  getAccessStatus(opts?: { boardToken?: string }): VCSAccessStatus {
    const boardToken = opts?.boardToken?.trim();
    if (boardToken) {
      return { available: true, source: "board" };
    }
    const envToken = process.env.GITLAB_TOKEN;
    if (envToken) {
      return { available: true, source: "env" };
    }
    return { available: false, source: "none" };
  }

  async downloadArchive(opts: {
    repo: string;
    ref?: string;
    token?: string;
  }): Promise<Buffer> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const ref = opts.ref ?? "HEAD";
    const url = `${this.getApiBaseUrl()}/projects/${encodedPath}/repository/archive.zip?sha=${ref}`;

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(opts.token),
    };

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`GitLab archive download failed: HTTP ${response.status}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof TypeError) {
        const message = error.message ?? "";
        if (message.includes("certificate") || message.includes("SSL")) {
          throw new Error(
            `GitLab archive download failed due to SSL certificate issue. Set GITLAB_SKIP_SSL_VERIFY=true for self-hosted instances with self-signed certificates.`
          );
        }
      }
      throw error;
    }
  }
}
