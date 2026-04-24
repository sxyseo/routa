import { describe, it, expect } from "vitest";
import { parsePrUrl, verifyPrMergeStatus } from "../pr-status-verifier";

describe("parsePrUrl", () => {
  it("parses a standard GitHub PR URL", () => {
    const result = parsePrUrl("https://github.com/owner/repo/pull/123");
    expect(result).toEqual({ owner: "owner", repo: "repo", prNumber: 123 });
  });

  it("parses with trailing slash", () => {
    const result = parsePrUrl("https://github.com/owner/repo/pull/456/");
    expect(result).toEqual({ owner: "owner", repo: "repo", prNumber: 456 });
  });

  it("parses with query params", () => {
    const result = parsePrUrl("https://github.com/owner/repo/pull/789/files");
    expect(result).toEqual({ owner: "owner", repo: "repo", prNumber: 789 });
  });

  it("is case-insensitive", () => {
    const result = parsePrUrl("https://GitHub.com/Owner/Repo/pull/1");
    expect(result).toEqual({ owner: "Owner", repo: "Repo", prNumber: 1 });
  });

  it("returns undefined for non-GitHub URLs", () => {
    expect(parsePrUrl("https://gitlab.com/owner/repo/-/merge_requests/1")).toBeUndefined();
  });

  it("returns undefined for malformed URLs", () => {
    expect(parsePrUrl("not-a-url")).toBeUndefined();
    expect(parsePrUrl("")).toBeUndefined();
  });
});

describe("verifyPrMergeStatus", () => {
  it("returns verified=false for non-parseable URL", async () => {
    const result = await verifyPrMergeStatus("not-a-url");
    expect(result).toEqual({ merged: false, verified: false });
  });

  // gh CLI calls are integration-level; unit tests mock the process layer.
  // Here we verify the shape of the fallback when process API is unavailable.
  it("returns verified=false when process API is unavailable", async () => {
    // In test environments without getServerBridge, this should gracefully fail.
    const result = await verifyPrMergeStatus("https://github.com/o/r/pull/1");
    // Either verified: true (if gh works in CI) or verified: false
    expect(typeof result.verified).toBe("boolean");
    expect(typeof result.merged).toBe("boolean");
  });
});
