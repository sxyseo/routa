/**
 * Unit tests for VCS issue URL parsing in spec-board-model.
 *
 * Covers:
 * - normalizeVcsIssueUrl: GitHub and GitLab URL recognition
 * - formatVcsIssueLabel: platform-specific label formatting
 * - resolveIssueRelation: end-to-end relation resolution for both platforms
 * - buildSpecBoardModel: integration with full model build
 */

import { describe, expect, it } from "vitest";
import { buildSpecBoardModel, type SpecIssue, type FeatureSurfaceIndexResponse } from "../spec-board-model";

// ---------------------------------------------------------------------------
// Helpers to invoke private functions via the public API
// ---------------------------------------------------------------------------

/**
 * Calls resolveIssueRelation indirectly by creating a minimal board model
 * and reading the resulting ResolvedRelation from outgoing relations.
 */
function resolveViaModel(relatedIssues: string[], existingGithubUrl?: string) {
  const issues: SpecIssue[] = [
    {
      filename: "test-issue.md",
      title: "Test Issue",
      date: "2025-01-01",
      kind: "bug",
      status: "open",
      severity: "medium",
      area: "test",
      tags: [],
      reportedBy: "test",
      relatedIssues,
      githubIssue: null,
      vcsState: null,
      vcsUrl: null,
      body: "",
    },
  ];

  if (existingGithubUrl) {
    issues.push({
      filename: "linked-issue.md",
      title: "Linked Issue",
      date: "2025-01-01",
      kind: "bug",
      status: "open",
      severity: "medium",
      area: "test",
      tags: [],
      reportedBy: "test",
      relatedIssues: [],
      githubIssue: 1,
      vcsState: "open",
      vcsUrl: existingGithubUrl,
      body: "",
    });
  }

  const model = buildSpecBoardModel(issues, EMPTY_SURFACE);
  const relations = model.relationsByFilename.get("test-issue.md");
  return relations?.outgoing ?? [];
}

const EMPTY_SURFACE: FeatureSurfaceIndexResponse = {
  generatedAt: "",
  pages: [],
  apis: [],
  metadata: null,
  repoRoot: "",
  warnings: [],
};

// ===========================================================================
// normalizeVcsIssueUrl — GitHub
// ===========================================================================

describe("normalizeVcsIssueUrl — GitHub", () => {
  it("parses standard GitHub issue URL", () => {
    const relations = resolveViaModel(["https://github.com/owner/repo/issues/42"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("github");
    expect(relations[0].href).toBe("https://github.com/owner/repo/issues/42");
    expect(relations[0].label).toBe("github:owner/repo#42");
  });

  it("parses GitHub issue URL with trailing slash", () => {
    const relations = resolveViaModel(["https://github.com/owner/repo/issues/42/"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("github");
    expect(relations[0].href).toBe("https://github.com/owner/repo/issues/42");
  });

  it("parses GitHub issue URL with www prefix", () => {
    const relations = resolveViaModel(["https://www.github.com/owner/repo/issues/7"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("github");
    expect(relations[0].href).toBe("https://github.com/owner/repo/issues/7");
  });

  it("returns external for non-matching GitHub paths", () => {
    const relations = resolveViaModel(["https://github.com/owner/repo/pull/10"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("external");
  });
});

// ===========================================================================
// normalizeVcsIssueUrl — GitLab
// ===========================================================================

describe("normalizeVcsIssueUrl — GitLab", () => {
  it("parses standard GitLab issue URL", () => {
    const relations = resolveViaModel(["https://gitlab.com/owner/repo/-/issues/42"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("gitlab");
    expect(relations[0].href).toBe("https://gitlab.com/owner/repo/-/issues/42");
    expect(relations[0].label).toBe("gitlab:owner/repo#42");
  });

  it("parses GitLab issue URL with trailing slash", () => {
    const relations = resolveViaModel(["https://gitlab.com/owner/repo/-/issues/42/"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("gitlab");
    expect(relations[0].href).toBe("https://gitlab.com/owner/repo/-/issues/42");
  });

  it("parses GitLab issue URL with www prefix", () => {
    const relations = resolveViaModel(["https://www.gitlab.com/owner/repo/-/issues/7"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("gitlab");
    expect(relations[0].href).toBe("https://gitlab.com/owner/repo/-/issues/7");
  });

  it("returns external for GitLab merge request URLs (out of scope)", () => {
    const relations = resolveViaModel(["https://gitlab.com/owner/repo/-/merge_requests/10"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("external");
  });

  it("returns external for GitLab URL without /-/issues/ pattern", () => {
    const relations = resolveViaModel(["https://gitlab.com/owner/repo/issues/42"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("external");
  });
});

// ===========================================================================
// formatVcsIssueLabel
// ===========================================================================

describe("formatVcsIssueLabel", () => {
  it("formats GitHub label as github:owner/repo#N", () => {
    const relations = resolveViaModel(["https://github.com/acme/frontend/issues/123"]);
    expect(relations[0].label).toBe("github:acme/frontend#123");
  });

  it("formats GitLab label as gitlab:owner/repo#N", () => {
    const relations = resolveViaModel(["https://gitlab.com/acme/frontend/-/issues/456"]);
    expect(relations[0].label).toBe("gitlab:acme/frontend#456");
  });
});

// ===========================================================================
// resolveIssueRelation — cross-platform behavior
// ===========================================================================

describe("resolveIssueRelation — VCS integration", () => {
  it("resolves a linked GitHub issue by URL", () => {
    const url = "https://github.com/acme/app/issues/5";
    const relations = resolveViaModel([url], url);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("local");
    expect(relations[0].targetFilename).toBe("linked-issue.md");
    expect(relations[0].label).toBe("Linked Issue");
  });

  it("resolves a linked GitLab issue by URL", () => {
    const url = "https://gitlab.com/acme/app/-/issues/5";
    const relations = resolveViaModel([url], url);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("local");
    expect(relations[0].targetFilename).toBe("linked-issue.md");
    expect(relations[0].label).toBe("Linked Issue");
  });

  it("handles mixed GitHub and GitLab URLs in the same issue", () => {
    const relations = resolveViaModel([
      "https://github.com/acme/app/issues/1",
      "https://gitlab.com/acme/app/-/issues/2",
    ]);
    expect(relations).toHaveLength(2);
    expect(relations[0].kind).toBe("github");
    expect(relations[1].kind).toBe("gitlab");
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("VCS URL edge cases", () => {
  it("returns null for empty input", () => {
    const relations = resolveViaModel([""]);
    expect(relations).toHaveLength(0);
  });

  it("returns null for non-URL text", () => {
    const relations = resolveViaModel(["not-a-url"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("external");
  });

  it("handles local filename references unchanged", () => {
    const relations = resolveViaModel(["other-issue.md"]);
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe("local");
  });
});
