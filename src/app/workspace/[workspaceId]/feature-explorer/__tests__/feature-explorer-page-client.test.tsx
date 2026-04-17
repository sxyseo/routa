import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navState = vi.hoisted(() => ({
  push: vi.fn(),
}));

const { useWorkspaces, useCodebases } = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  useCodebases: vi.fn(),
}));

const { useFeatureExplorerData } = vi.hoisted(() => ({
  useFeatureExplorerData: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navState.push }),
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces,
  useCodebases,
}));

vi.mock("../use-feature-explorer-data", () => ({
  useFeatureExplorerData,
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="desktop-shell">{children}</div>,
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: ({
    value,
    onChange,
  }: {
    value: { name: string; path: string; branch: string } | null;
    onChange: (value: { name: string; path: string; branch: string } | null) => void;
  }) => (
    <div>
      <div data-testid="repo-picker-value">
        {value ? `${value.name}|${value.path}|${value.branch}` : "none"}
      </div>
      <button
        type="button"
        onClick={() => onChange({ name: "local-project", path: "/tmp/local-project", branch: "feature-x" })}
      >
        switch repo
      </button>
      <button type="button" onClick={() => onChange(null)}>
        clear repo
      </button>
    </div>
  ),
}));

import { FeatureExplorerPageClient } from "../feature-explorer-page-client";

describe("FeatureExplorerPageClient", () => {
  beforeEach(() => {
    navState.push.mockReset();
    useWorkspaces.mockReturnValue({
      loading: false,
      workspaces: [{ id: "default", title: "Default Workspace" }],
      createWorkspace: vi.fn(),
    });
    useCodebases.mockReturnValue({
      codebases: [
        {
          id: "cb-default",
          workspaceId: "default",
          repoPath: "/repo/default",
          branch: "main",
          label: "routa-js",
          isDefault: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      fetchCodebases: vi.fn(),
    });
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [],
      features: [],
      featureDetail: null,
      featureDetailLoading: false,
      initialFeatureId: "",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });
  });

  it("uses the default codebase until the user selects another local repository", async () => {
    render(<FeatureExplorerPageClient workspaceId="default" />);

    expect(screen.getByTestId("repo-picker-value").textContent).toBe("routa-js|/repo/default|main");
    expect(useFeatureExplorerData).toHaveBeenLastCalledWith({
      workspaceId: "default",
      repoPath: "/repo/default",
      refreshKey: "/repo/default:main",
    });

    fireEvent.click(screen.getByRole("button", { name: "switch repo" }));

    await waitFor(() => {
      expect(screen.getByTestId("repo-picker-value").textContent).toBe(
        "local-project|/tmp/local-project|feature-x",
      );
    });

    expect(useFeatureExplorerData).toHaveBeenLastCalledWith({
      workspaceId: "default",
      repoPath: "/tmp/local-project",
      refreshKey: "/tmp/local-project:feature-x",
    });

    fireEvent.click(screen.getByRole("button", { name: "clear repo" }));

    await waitFor(() => {
      expect(screen.getByTestId("repo-picker-value").textContent).toBe("routa-js|/repo/default|main");
    });

    expect(useFeatureExplorerData).toHaveBeenLastCalledWith({
      workspaceId: "default",
      repoPath: "/repo/default",
      refreshKey: "/repo/default:main",
    });
  });
});
