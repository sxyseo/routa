/**
 * GitHub VCS Provider
 *
 * Adapter for GitHub REST API v3.
 * Wraps existing GitHub functionality to the IVCSProvider interface.
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

export class GitHubProvider implements IVCSProvider {
  readonly platform: VCSPlatform = "github";

  /** Default GitHub API base URL */
  private readonly apiBaseUrl = "https://api.github.com";

  /** Get API base URL (supports GitHub Enterprise) */
  private getApiBaseUrl(): string {
    return process.env.GITHUB_API_URL ?? this.apiBaseUrl;
  }

  /** Get authorization header */
  private getAuthHeader(token?: string): string {
    const actualToken = token ?? process.env.GITHUB_TOKEN;
    if (!actualToken) {
      throw new Error("GitHub token is required. Set GITHUB_TOKEN environment variable.");
    }
    return `token ${actualToken}`;
  }

  /** Make a GitHub API request */
  private async githubApi<T>(
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
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "routa-github-provider",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  async getRepo(opts: { repo: string; token?: string }): Promise<VCSRepository> {
    const data = await this.githubApi<{
      full_name: string;
      html_url: string;
      clone_url: string;
      default_branch: string;
      private: boolean;
    }>(`/repos/${opts.repo}`, { token: opts.token });

    return {
      full_name: data.full_name,
      html_url: data.html_url,
      clone_url: data.clone_url,
      default_branch: data.default_branch,
      private: data.private,
    };
  }

  async listBranches(opts: { repo: string; token?: string }): Promise<VCSBranch[]> {
    const data = await this.githubApi<Array<{
      name: string;
      commit: { sha: string };
      protected: boolean;
    }>>(`/repos/${opts.repo}/branches`, { token: opts.token });

    return data.map((branch) => ({
      name: branch.name,
      commit: { sha: branch.commit.sha },
      protected: branch.protected,
    }));
  }

  async getPR(opts: { repo: string; prNumber: number; token?: string }): Promise<VCSPullRequest> {
    const data = await this.githubApi<{
      number: number;
      title: string;
      body: string | undefined;
      html_url: string;
      state: string;
      draft: boolean;
      merged: boolean;
      head: { ref: string; sha: string };
      base: { ref: string };
      user: { login: string };
      created_at: string;
      updated_at: string;
    }>(`/repos/${opts.repo}/pulls/${opts.prNumber}`, { token: opts.token });

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      html_url: data.html_url,
      state: data.state,
      draft: data.draft,
      merged: data.merged,
      head: data.head,
      base: data.base,
      user: { login: data.user.login },
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  async getPRFiles(opts: { repo: string; prNumber: number; token?: string }): Promise<VCSFileChange[]> {
    const data = await this.githubApi<Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch: string | undefined;
    }>>(`/repos/${opts.repo}/pulls/${opts.prNumber}/files`, { token: opts.token });

    return data.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? undefined,
    }));
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
    const data = await this.githubApi<{
      number: number;
      title: string;
      body: string;
      html_url: string;
      state: string;
      draft: boolean;
      merged: boolean;
      head: { ref: string; sha: string };
      base: { ref: string };
      user: { login: string };
      created_at: string;
      updated_at: string;
    }>(`/repos/${opts.repo}/pulls`, {
      method: "POST",
      token: opts.token,
      body: {
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base,
        draft: opts.draft ?? false,
      },
    });

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      html_url: data.html_url,
      state: data.state,
      draft: data.draft,
      merged: data.merged,
      head: data.head,
      base: data.base,
      user: { login: data.user.login },
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
    const data = await this.githubApi<{
      id: number;
      body: string;
      html_url: string;
      user: { login: string };
      created_at: string;
    }>(`/repos/${opts.repo}/issues/${opts.prNumber}/comments`, {
      method: "POST",
      token: opts.token,
      body: { body: opts.body },
    });

    return {
      id: data.id,
      body: data.body,
      html_url: data.html_url,
      user: { login: data.user.login },
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
    const payload: Record<string, unknown> = {
      body: opts.body,
      event: opts.event,
    };

    if (opts.commitId) {
      payload.commit_id = opts.commitId;
    }

    const data = await this.githubApi<{
      id: number;
      body: string;
      html_url: string;
      user: { login: string };
      commit_id: string;
    }>(`/repos/${opts.repo}/pulls/${opts.prNumber}/reviews`, {
      method: "POST",
      token: opts.token,
      body: payload,
    });

    return {
      id: data.id,
      body: data.body,
      html_url: data.html_url,
      user: { login: data.user.login },
      commit_id: data.commit_id,
    };
  }

  async registerWebhook(opts: {
    repo: string;
    webhookUrl: string;
    secret: string;
    events: string[];
    token?: string;
  }): Promise<{ id: number; url: string }> {
    const data = await this.githubApi<{
      id: number;
      config: { url: string };
    }>(`/repos/${opts.repo}/hooks`, {
      method: "POST",
      token: opts.token,
      body: {
        name: "web",
        active: true,
        events: opts.events,
        config: {
          url: opts.webhookUrl,
          content_type: "json",
          secret: opts.secret,
          insecure_ssl: "0",
        },
      },
    });

    return { id: data.id, url: data.config.url };
  }

  async deleteWebhook(opts: {
    repo: string;
    hookId: number;
    token?: string;
  }): Promise<void> {
    await this.githubApi(`/repos/${opts.repo}/hooks/${opts.hookId}`, {
      method: "DELETE",
      token: opts.token,
    });
  }

  async listWebhooks(opts: {
    repo: string;
    token?: string;
  }): Promise<Array<{ id: number; events: string[]; active: boolean; config: { url: string } }>> {
    return this.githubApi(`/repos/${opts.repo}/hooks`, { token: opts.token });
  }

  async listPRs(opts: {
    repo: string;
    state?: "open" | "closed" | "all";
    perPage?: number;
    token?: string;
  }): Promise<VCSPullRequestListItem[]> {
    const state = opts.state ?? "open";
    const perPage = Math.max(1, Math.min(opts.perPage ?? 50, 100));
    const params = new URLSearchParams({
      state,
      sort: "updated",
      direction: "desc",
      per_page: String(perPage),
    });

    const data = await this.githubApi<Array<{
      id: number;
      number: number;
      title: string;
      body?: string | null;
      html_url: string;
      state: string;
      updated_at?: string;
      merged_at?: string | null;
      draft?: boolean;
      labels?: Array<{ name?: string | null }>;
      assignees?: Array<{ login?: string | null }>;
      head?: { ref?: string };
      base?: { ref?: string };
    }>>(`/repos/${opts.repo}/pulls?${params.toString()}`, { token: opts.token });

    return data.map((item) => ({
      id: String(item.id),
      number: item.number,
      title: item.title,
      body: item.body ?? undefined,
      url: item.html_url,
      state: item.state as "open" | "closed",
      labels: (item.labels ?? []).map((l) => l.name?.trim()).filter((s): s is string => Boolean(s)),
      assignees: (item.assignees ?? []).map((a) => a.login?.trim()).filter((s): s is string => Boolean(s)),
      updatedAt: item.updated_at,
      draft: item.draft ?? false,
      mergedAt: item.merged_at ?? undefined,
      headRef: item.head?.ref ?? "",
      baseRef: item.base?.ref ?? "",
    }));
  }

  async listIssues(opts: {
    repo: string;
    state?: "open" | "closed" | "all";
    perPage?: number;
    token?: string;
  }): Promise<VCSIssueListItem[]> {
    const state = opts.state ?? "open";
    const perPage = Math.max(1, Math.min(opts.perPage ?? 50, 100));
    const params = new URLSearchParams({
      state,
      sort: "updated",
      direction: "desc",
      per_page: String(perPage),
    });

    const data = await this.githubApi<Array<{
      id: number;
      number: number;
      title: string;
      body?: string | null;
      html_url: string;
      state: string;
      updated_at?: string;
      labels?: Array<{ name?: string | null }>;
      assignees?: Array<{ login?: string | null }>;
      pull_request?: unknown;
    }>>(`/repos/${opts.repo}/issues?${params.toString()}`, { token: opts.token });

    return data
      .filter((item) => !item.pull_request)
      .map((item) => ({
        id: String(item.id),
        number: item.number,
        title: item.title,
        body: item.body ?? undefined,
        url: item.html_url,
        state: item.state as "open" | "closed",
        labels: (item.labels ?? []).map((l) => l.name?.trim()).filter((s): s is string => Boolean(s)),
        assignees: (item.assignees ?? []).map((a) => a.login?.trim()).filter((s): s is string => Boolean(s)),
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
    const data = await this.githubApi<{
      id: number;
      number: number;
      title: string;
      body?: string | null;
      html_url: string;
      state: string;
      labels?: Array<{ name?: string | null }>;
      assignees?: Array<{ login?: string | null }>;
    }>(`/repos/${opts.repo}/issues`, {
      method: "POST",
      token: opts.token,
      body: {
        title: opts.title,
        body: opts.body,
        labels: opts.labels,
        assignees: opts.assignees,
      },
    });

    return {
      id: String(data.id),
      number: data.number,
      title: data.title,
      body: data.body ?? undefined,
      url: data.html_url,
      state: data.state as "open" | "closed",
      labels: (data.labels ?? []).map((l) => l.name?.trim()).filter((s): s is string => Boolean(s)),
      assignees: (data.assignees ?? []).map((a) => a.login?.trim()).filter((s): s is string => Boolean(s)),
    };
  }

  getAccessStatus(opts?: { boardToken?: string }): VCSAccessStatus {
    const boardToken = opts?.boardToken?.trim();
    if (boardToken) {
      return { available: true, source: "board" };
    }
    const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
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
    const ref = opts.ref ?? "HEAD";
    const url = `https://codeload.github.com/${opts.repo}/zip/${ref}`;

    const headers: Record<string, string> = {
      "User-Agent": "routa-github-provider",
    };
    const token = opts.token ?? process.env.GITHUB_TOKEN;
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub archive download failed: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
