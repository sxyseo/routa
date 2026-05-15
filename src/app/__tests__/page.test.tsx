import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    workspaceStore: {
      listByStatus: async () => systemState.workspaces,
    },
  }),
}));

const systemState = {
  workspaces: [] as Array<{ id: string }>,
};

describe("RootPage", () => {
  it("redirects to first workspace kanban when workspaces exist", async () => {
    const { redirect } = await import("next/navigation");
    const { default: RootPage } = await import("../page");

    systemState.workspaces = [{ id: "ws-1" }];

    await expect(RootPage()).rejects.toBeUndefined();
    expect(redirect).toHaveBeenCalledWith("/workspace/ws-1/kanban");
  });

  it("redirects to settings when no workspaces exist", async () => {
    const { redirect } = await import("next/navigation");
    const { default: RootPage } = await import("../page");

    systemState.workspaces = [];

    await expect(RootPage()).rejects.toBeUndefined();
    expect(redirect).toHaveBeenCalledWith("/settings");
  });
});
