import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return {
    useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus,
  };
});

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Default Board",
  isDefault: true,
  sessionConcurrencyLimit: 1,
  queue: {
    runningCount: 0,
    runningCards: [],
    queuedCount: 0,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [
    { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function createTask(id: string, title: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title,
    objective: `${title} objective`,
    status: "PENDING",
    boardId: board.id,
    columnId: "backlog",
    position: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KanbanTab GitHub import merge mode", () => {
  it("merges selected GitHub issues into a single backlog card", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/github/access?") && url.includes("boardId=board-1")) {
        return {
          ok: true,
          json: async () => ({
            available: true,
            source: "gh",
          }),
        } as Response;
      }
      if (url === "/api/github/issues?workspaceId=workspace-1&codebaseId=codebase-1&boardId=board-1") {
        return {
          ok: true,
          json: async () => ({
            repo: "phodal/routa-js",
            codebase: { id: "codebase-1", label: "routa-js" },
            issues: [
              {
                id: "issue-1",
                number: 161,
                title: "Imported issue one",
                body: "First imported summary.",
                url: "https://github.com/phodal/routa-js/issues/161",
                state: "open",
                labels: ["bug", "frontend"],
                assignees: [],
                updatedAt: "2025-01-01T00:00:00.000Z",
              },
              {
                id: "issue-2",
                number: 162,
                title: "Imported issue two",
                body: "Second imported summary.",
                url: "https://github.com/phodal/routa-js/issues/162",
                state: "open",
                labels: ["frontend", "triage"],
                assignees: [],
                updatedAt: "2025-01-02T00:00:00.000Z",
              },
            ],
          }),
        } as Response;
      }
      return fetch(input, init);
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kanban/boards/board-1" && init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => ({
            board: {
              ...board,
              autoProviderId: "codex",
            },
          }),
        } as Response;
      }
      if (url === "/api/tasks" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            task: createTask("task-imported-merged", "Merged GitHub issues", {
              codebaseIds: ["codebase-1"],
            }),
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[]}
        sessions={[]}
        providers={[{
          id: "codex",
          name: "Codex",
          description: "Codex provider",
          command: "codex-acp",
          status: "available",
        }]}
        specialists={[]}
        codebases={[{
          id: "codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/Users/phodal/repos/routa-js",
          sourceUrl: "https://github.com/phodal/routa-js",
          isDefault: true,
          label: "routa-js",
          branch: "main",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        acp={{
          connected: true,
          sessionId: null,
          updates: [],
          providers: [],
          selectedProvider: "codex",
          loading: false,
          error: null,
          authError: null,
          dockerConfigError: null,
          setProvider: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          createSession: vi.fn(),
          createSessionWithOptions: vi.fn(),
          createSessionWithWorkspace: vi.fn(),
          prompt: vi.fn(),
          promptSession: vi.fn(),
          setMode: vi.fn(),
          respondToUserInput: vi.fn(),
          respondToUserInputForSession: vi.fn(),
          clearDockerConfigError: vi.fn(),
          writeTerminal: vi.fn(),
          resizeTerminal: vi.fn(),
          cancel: vi.fn(),
          listSessions: vi.fn(),
          selectSession: vi.fn(),
          deleteSession: vi.fn(),
          listProviderModels: vi.fn(),
          clearAuthError: vi.fn(),
        } as unknown as UseAcpState & UseAcpActions}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /import issues/i }));

    expect(await screen.findByRole("link", { name: /imported issue one/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /merge into one card/i }));
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getAllByRole("checkbox")[2]!);
    fireEvent.click(screen.getByRole("button", { name: /import selected/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          boardId: "board-1",
          columnId: "backlog",
          title: "Merged issues",
          objective: [
            "Source links",
            "- #161 Imported issue one",
            "  https://github.com/phodal/routa-js/issues/161",
            "  Summary: First imported summary.",
            "",
            "- #162 Imported issue two",
            "  https://github.com/phodal/routa-js/issues/162",
            "  Summary: Second imported summary.",
          ].join("\n"),
          labels: ["bug", "frontend", "triage"],
          codebaseIds: ["codebase-1"],
        }),
      });
    });
  });

  it("hides the import button when GitHub access is unavailable", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/github/access?") && url.includes("boardId=board-1")) {
        return {
          ok: true,
          json: async () => ({
            available: false,
            source: "none",
          }),
        } as Response;
      }
      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    vi.stubGlobal("fetch", vi.fn());

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[{
          id: "codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/Users/phodal/repos/routa-js",
          sourceUrl: "https://github.com/phodal/routa-js",
          isDefault: true,
          label: "routa-js",
          branch: "main",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /import issues/i })).toBeNull();
    });
  });
});

describe("KanbanTab VCS import with GitLab codebase", () => {
  it("renders GitLab-specific import button and passes platform=gitlab to VCS access check", async () => {
    const accessCalls: string[] = [];
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/github/access?")) {
        accessCalls.push(url);
        return {
          ok: true,
          json: async () => ({ available: true, source: "env" }),
        } as Response;
      }
      return fetch(input, init);
    });

    vi.stubGlobal("fetch", vi.fn());

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[{
          id: "gitlab-codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/Users/phodal/repos/routa-gitlab",
          sourceUrl: "https://gitlab.com/phodal/routa-gitlab",
          sourceType: "gitlab",
          isDefault: true,
          label: "routa-gitlab",
          branch: "main",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        onRefresh={vi.fn()}
      />,
    );

    // The import button should show GitLab-specific label
    const importButton = await screen.findByRole("button", { name: /import gitlab issues/i });
    expect(importButton).toBeTruthy();

    // VCS access check should include platform=gitlab
    await waitFor(() => {
      expect(accessCalls.some((url) => url.includes("platform=gitlab"))).toBe(true);
    });
  });

  it("opens GitLab import modal with Merge Requests tab when clicked", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/github/access?") && url.includes("platform=gitlab")) {
        return {
          ok: true,
          json: async () => ({ available: true, source: "env" }),
        } as Response;
      }
      if (url.includes("/api/github/issues?") && url.includes("codebaseId=gitlab-codebase-1")) {
        return {
          ok: true,
          json: async () => ({
            repo: "phodal/routa-gitlab",
            codebase: { id: "gitlab-codebase-1", label: "routa-gitlab" },
            issues: [
              {
                id: "gl-issue-1",
                number: 42,
                title: "GitLab issue one",
                body: "GitLab issue summary.",
                url: "https://gitlab.com/phodal/routa-gitlab/-/issues/42",
                state: "open",
                labels: ["bug"],
                assignees: [],
                updatedAt: "2025-01-01T00:00:00.000Z",
              },
            ],
          }),
        } as Response;
      }
      return fetch(input, init);
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[{
          id: "gitlab-codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/Users/phodal/repos/routa-gitlab",
          sourceUrl: "https://gitlab.com/phodal/routa-gitlab",
          sourceType: "gitlab",
          isDefault: true,
          label: "routa-gitlab",
          branch: "main",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        onRefresh={vi.fn()}
      />,
    );

    // Click the GitLab import button
    const importButton = await screen.findByRole("button", { name: /import gitlab issues/i });
    fireEvent.click(importButton);

    // Modal should open with "Merge Requests" tab (GitLab-specific)
    expect(await screen.findByRole("button", { name: /merge requests/i })).toBeTruthy();

    // Issues should load from the GitLab codebase via IVCSProvider
    expect(await screen.findByRole("link", { name: /gitlab issue one/i })).toBeTruthy();
  });
});
