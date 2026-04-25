import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RepoPicker, detectPlatform } from "../repo-picker";
import type { GitPlatform } from "../repo-picker";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch,
}));

vi.mock("../branch-selector", () => ({
  BranchSelector: ({ currentBranch }: { currentBranch?: string }) => (
    <div data-testid="branch-selector">{currentBranch ?? ""}</div>
  ),
}));

describe("RepoPicker", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/clone" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ repos: [] }), { status: 200 });
      }

      if (url === "/api/clone/local" && init?.method === "POST") {
        const payload = init.body ? JSON.parse(String(init.body)) : {};
        return new Response(
          JSON.stringify({
            success: true,
            name: "routa-js",
            path: payload.path,
            branch: "main",
          }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("loads a local repository from the local project tab", async () => {
    const onChange = vi.fn();

    render(<RepoPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /select, clone, or load a repository/i }));
    fireEvent.click(screen.getByRole("button", { name: /local project/i }));
    fireEvent.change(screen.getByPlaceholderText("/Users/you/project or ~/project"), {
      target: { value: "~/code/routa-js" },
    });
    fireEvent.click(screen.getByRole("button", { name: /use local project/i }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        name: "routa-js",
        path: "~/code/routa-js",
        branch: "main",
      }),
    );
  });

  it("switches from search to local mode when the query looks like a file path", async () => {
    render(<RepoPicker value={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /select, clone, or load a repository/i }));
    fireEvent.change(
      screen.getByPlaceholderText("Search repositories, paste GitHub URL, or enter local path..."),
      {
        target: { value: "~/code/routa-js" },
      },
    );

    await waitFor(() => {
      expect(screen.getByText("Local Repository Path")).toBeTruthy();
      expect(
        screen.getByDisplayValue("~/code/routa-js"),
      ).toBeTruthy();
    });
  });

  it("shows full worktree path on hover and offers copy for muted path display", async () => {
    render(
      <RepoPicker
        value={{
          name: "issue-cf7f1e28-feat-kanban-very-long-worktree-name",
          path: "/Users/phodal/.routa/workspace/default/default/fcfe6cca-4de0-43da-b869-8641df9625e4/issue-cf7f1e28-feat-kanban-very-long-worktree-name",
          branch: "main",
        }}
        onChange={vi.fn()}
        pathDisplay="below-muted"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: /issue-cf7f1e28-feat.*name/i,
    });
    expect(trigger.textContent).toContain("...");
    expect(trigger.getAttribute("title")).toBe(
      "issue-cf7f1e28-feat-kanban-very-long-worktree-name\n/Users/phodal/.routa/workspace/default/default/fcfe6cca-4de0-43da-b869-8641df9625e4/issue-cf7f1e28-feat-kanban-very-long-worktree-name",
    );

    expect(screen.getByText(/^~\/\.\.\.\/fcfe6cca.*\/issue-cf7f1e28.*name$/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy to clipboard/i }));
    });
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "/Users/phodal/.routa/workspace/default/default/fcfe6cca-4de0-43da-b869-8641df9625e4/issue-cf7f1e28-feat-kanban-very-long-worktree-name",
      );
    });
  });

  it("switches to clone tab when pasting a GitLab HTTPS URL", async () => {
    render(<RepoPicker value={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /select, clone, or load a repository/i }));
    fireEvent.change(
      screen.getByPlaceholderText("Search repositories, paste GitHub URL, or enter local path..."),
      { target: { value: "https://gitlab.com/owner/repo" } },
    );

    await waitFor(() => {
      // Should switch to clone tab with GitLab label
      expect(screen.getByText("Clone from GitLab")).toBeTruthy();
    });
  });

  it("switches to clone tab when pasting a GitLab SSH URL", async () => {
    render(<RepoPicker value={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /select, clone, or load a repository/i }));
    fireEvent.change(
      screen.getByPlaceholderText("Search repositories, paste GitHub URL, or enter local path..."),
      { target: { value: "git@gitlab.com:owner/repo" } },
    );

    await waitFor(() => {
      expect(screen.getByText("Clone from GitLab")).toBeTruthy();
    });
  });

  it("shows Clone from URL label when input is empty in clone tab", async () => {
    render(<RepoPicker value={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /select, clone, or load a repository/i }));
    // Click clone tab directly (empty state)
    const cloneTabButton = screen.getByRole("button", { name: /clone from url/i });
    fireEvent.click(cloneTabButton);

    expect(screen.getByText("Clone from URL")).toBeTruthy();
  });
});

describe("detectPlatform", () => {
  const cases: Array<[string, GitPlatform]> = [
    // GitHub patterns
    ["https://github.com/owner/repo", "github"],
    ["http://github.com/owner/repo", "github"],
    ["git@github.com:owner/repo", "github"],
    ["github.com/owner/repo", "github"],
    ["owner/repo", "github"], // backward compat

    // GitLab patterns
    ["https://gitlab.com/owner/repo", "gitlab"],
    ["http://gitlab.com/owner/repo", "gitlab"],
    ["git@gitlab.com:owner/repo", "gitlab"],
    ["gitlab.com/owner/repo", "gitlab"],

    // Unknown
    ["", "unknown"],
    ["random text", "unknown"],
    ["/local/path", "unknown"],
    ["~/home/path", "unknown"],
  ];

  it.each(cases)("detectPlatform(%j) === %s", (input, expected) => {
    expect(detectPlatform(input)).toBe(expected);
  });
});
