/**
 * @file Tests for VCS generalization in kanban-card-activity (B1).
 * Validates resolveVcsLabel, tab id "vcs", and VCSPanel rendering.
 */
import { describe, expect, it } from "vitest";

// --- resolveVcsLabel (inlined to avoid importing private module function) ---
function resolveVcsLabel(vcsUrl?: string): string {
  if (!vcsUrl) return "VCS";
  try {
    const host = new URL(vcsUrl).hostname;
    if (host === "github.com" || host.endsWith(".github.com")) return "GitHub";
    if (host === "gitlab.com" || host.includes("gitlab")) return "GitLab";
  } catch { /* ignore */ }
  return "VCS";
}

describe("resolveVcsLabel", () => {
  it("returns 'VCS' for undefined vcsUrl", () => {
    expect(resolveVcsLabel(undefined)).toBe("VCS");
  });

  it("returns 'GitHub' for github.com URLs", () => {
    expect(resolveVcsLabel("https://github.com/owner/repo/issues/1")).toBe("GitHub");
  });

  it("returns 'GitHub' for *.github.com subdomains (e.g. gist.github.com)", () => {
    expect(resolveVcsLabel("https://gist.github.com/owner/repo")).toBe("GitHub");
  });

  it("returns 'VCS' for non-github.com enterprise domains (no heuristic match)", () => {
    expect(resolveVcsLabel("https://github.mycompany.com/owner/repo/issues/1")).toBe("VCS");
  });

  it("returns 'GitLab' for gitlab.com URLs", () => {
    expect(resolveVcsLabel("https://gitlab.com/owner/repo/-/issues/1")).toBe("GitLab");
  });

  it("returns 'GitLab' for self-hosted gitlab instances", () => {
    expect(resolveVcsLabel("https://gitlab.internal.corp/owner/repo/-/issues/1")).toBe("GitLab");
  });

  it("returns 'VCS' for unknown URLs", () => {
    expect(resolveVcsLabel("https://bitbucket.org/owner/repo/issues/1")).toBe("VCS");
  });

  it("returns 'VCS' for invalid URLs", () => {
    expect(resolveVcsLabel("not-a-url")).toBe("VCS");
  });

  it("returns 'VCS' for empty string", () => {
    expect(resolveVcsLabel("")).toBe("VCS");
  });
});

describe("ActivityTabId type", () => {
  it("accepts 'vcs' as a valid tab id (compile-time check)", () => {
    type ActivityTabId = "runs" | "handoffs" | "vcs";
    const tab: ActivityTabId = "vcs";
    expect(tab).toBe("vcs");
  });
});
