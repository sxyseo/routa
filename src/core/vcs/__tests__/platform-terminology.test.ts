import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPlatformTerminology,
  getPullRequestShort,
  getPullRequestTerm,
} from "../platform-terminology";

describe("platform-terminology", () => {
  const originalPlatform = process.env.PLATFORM;

  beforeEach(() => {
    delete process.env.PLATFORM;
  });

  afterEach(() => {
    if (originalPlatform !== undefined) {
      process.env.PLATFORM = originalPlatform;
    } else {
      delete process.env.PLATFORM;
    }
  });

  describe("getPlatformTerminology", () => {
    it("returns GitHub terminology by default", () => {
      const t = getPlatformTerminology();
      expect(t.pullRequestTerm).toBe("Pull Request");
      expect(t.pullRequestShort).toBe("PR");
    });

    it("returns GitHub terminology when platform is github", () => {
      const t = getPlatformTerminology("github");
      expect(t.pullRequestTerm).toBe("Pull Request");
      expect(t.pullRequestShort).toBe("PR");
      expect(t.pullsTab).toBe("Pull Requests");
    });

    it("returns GitLab terminology when platform is gitlab", () => {
      const t = getPlatformTerminology("gitlab");
      expect(t.pullRequestTerm).toBe("Merge Request");
      expect(t.pullRequestShort).toBe("MR");
      expect(t.pullsTab).toBe("Merge Requests");
    });

    it("returns GitLab terminology when PLATFORM env is gitlab", () => {
      process.env.PLATFORM = "gitlab";
      const t = getPlatformTerminology();
      expect(t.pullRequestTerm).toBe("Merge Request");
      expect(t.pullRequestShort).toBe("MR");
    });

    it("GitLab terminology has distinct create label", () => {
      const t = getPlatformTerminology("gitlab");
      expect(t.createPullRequest).toBe("Create Merge Request");
      expect(t.autoMergeAfterPR).toBe("Auto-merge after MR");
      expect(t.autoCreatePullRequest).toBe("Auto-create MR on done");
    });

    it("GitLab terminology has distinct specialist label", () => {
      const t = getPlatformTerminology("gitlab");
      expect(t.pullRequestSpecialist).toBe("MR specialist");
    });
  });

  describe("getPullRequestShort", () => {
    it("returns PR for GitHub", () => {
      expect(getPullRequestShort("github")).toBe("PR");
    });

    it("returns MR for GitLab", () => {
      expect(getPullRequestShort("gitlab")).toBe("MR");
    });
  });

  describe("getPullRequestTerm", () => {
    it("returns 'Pull Request' for GitHub", () => {
      expect(getPullRequestTerm("github")).toBe("Pull Request");
    });

    it("returns 'Merge Request' for GitLab", () => {
      expect(getPullRequestTerm("gitlab")).toBe("Merge Request");
    });
  });
});
