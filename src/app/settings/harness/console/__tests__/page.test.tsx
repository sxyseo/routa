import { describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import HarnessConsoleRedirectPage from "../page";

describe("HarnessConsoleRedirectPage", () => {
  it("redirects legacy /settings/harness/console requests to /settings/harness", () => {
    HarnessConsoleRedirectPage({
      searchParams: {
        workspaceId: "default",
        codebaseId: "cb-1",
        repoPath: "/Users/phodal/ai/routa-js",
      },
    });

    expect(redirectMock).toHaveBeenCalledWith(
      "/settings/harness?workspaceId=default&codebaseId=cb-1&repoPath=%2FUsers%2Fphodal%2Fai%2Frouta-js",
    );
  });

  it("redirects without a query string when the legacy route has no context", () => {
    HarnessConsoleRedirectPage({ searchParams: {} });

    expect(redirectMock).toHaveBeenCalledWith("/settings/harness");
  });
});
