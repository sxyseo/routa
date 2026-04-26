import { describe, it, expect } from "vitest";
import {
  mapGitLabRoleToPermission,
  hasPermission,
  canCreateMergeRequest,
  canMergeToProtected,
  parseAccessLevel,
  GITLAB_ROLE_LABELS,
  type GitLabAccessLevel,
} from "../gitlab-permission";

describe("gitlab-permission", () => {
  describe("mapGitLabRoleToPermission", () => {
    it("maps Guest (10) to read", () => {
      expect(mapGitLabRoleToPermission(10)).toBe("read");
    });

    it("maps Reporter (20) to read", () => {
      expect(mapGitLabRoleToPermission(20)).toBe("read");
    });

    it("maps Developer (30) to write", () => {
      expect(mapGitLabRoleToPermission(30)).toBe("write");
    });

    it("maps Maintainer (40) to admin", () => {
      expect(mapGitLabRoleToPermission(40)).toBe("admin");
    });

    it("maps Owner (50) to owner", () => {
      expect(mapGitLabRoleToPermission(50)).toBe("owner");
    });

    it("maps 0 (no access) to none", () => {
      expect(mapGitLabRoleToPermission(0)).toBe("none");
    });
  });

  describe("hasPermission", () => {
    it("owner satisfies all levels", () => {
      expect(hasPermission("owner", "read")).toBe(true);
      expect(hasPermission("owner", "write")).toBe(true);
      expect(hasPermission("owner", "admin")).toBe(true);
      expect(hasPermission("owner", "owner")).toBe(true);
    });

    it("read does not satisfy write", () => {
      expect(hasPermission("read", "write")).toBe(false);
    });

    it("write satisfies read but not admin", () => {
      expect(hasPermission("write", "read")).toBe(true);
      expect(hasPermission("write", "admin")).toBe(false);
    });

    it("none satisfies only none", () => {
      expect(hasPermission("none", "none")).toBe(true);
      expect(hasPermission("none", "read")).toBe(false);
    });
  });

  describe("canCreateMergeRequest", () => {
    it("allows Developer and above", () => {
      expect(canCreateMergeRequest(30)).toBe(true); // Developer
      expect(canCreateMergeRequest(40)).toBe(true); // Maintainer
      expect(canCreateMergeRequest(50)).toBe(true); // Owner
    });

    it("denies Guest and Reporter", () => {
      expect(canCreateMergeRequest(0)).toBe(false);  // No access
      expect(canCreateMergeRequest(10)).toBe(false); // Guest
      expect(canCreateMergeRequest(20)).toBe(false); // Reporter
    });
  });

  describe("canMergeToProtected", () => {
    it("allows Maintainer and above", () => {
      expect(canMergeToProtected(40)).toBe(true); // Maintainer
      expect(canMergeToProtected(50)).toBe(true); // Owner
    });

    it("denies Developer and below", () => {
      expect(canMergeToProtected(30)).toBe(false); // Developer
      expect(canMergeToProtected(20)).toBe(false); // Reporter
    });
  });

  describe("parseAccessLevel", () => {
    it("parses valid access level", () => {
      expect(parseAccessLevel({ access_level: 30 })).toBe(30);
    });

    it("returns 0 for undefined input", () => {
      expect(parseAccessLevel(undefined)).toBe(0);
      expect(parseAccessLevel(null)).toBe(0);
    });

    it("returns 0 for missing access_level", () => {
      expect(parseAccessLevel({})).toBe(0);
    });

    it("clamps out-of-range values", () => {
      expect(parseAccessLevel({ access_level: 100 })).toBe(50);
      expect(parseAccessLevel({ access_level: -5 })).toBe(0);
    });
  });

  describe("GITLAB_ROLE_LABELS", () => {
    it("has labels for all access levels", () => {
      const levels: GitLabAccessLevel[] = [0, 10, 20, 30, 40, 50];
      for (const level of levels) {
        expect(GITLAB_ROLE_LABELS[level]).toBeTruthy();
      }
    });
  });
});
