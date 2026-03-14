import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_REFRESH_BURST_DELAYS_MS,
  buildKanbanTaskAgentPrompt,
  scheduleKanbanRefreshBurst,
} from "../kanban-agent-input";

describe("buildKanbanTaskAgentPrompt", () => {
  it("forces the Kanban input flow to stay in backlog planning mode", () => {
    const prompt = buildKanbanTaskAgentPrompt({
      workspaceId: "default",
      boardId: "board-1",
      repoPath: "/tmp/repo",
      agentInput: "echo hello world",
    });

    expect(prompt).toContain("Target column for every created card: backlog");
    expect(prompt).toContain("This flow is backlog planning, not execution.");
    expect(prompt).toContain("Do not create follow-up agents.");
    expect(prompt).toContain("Do not move cards out of backlog.");
    expect(prompt).toContain("Do not use native tools such as Bash, Read, Write, Edit, Glob, or Grep");
    expect(prompt).toContain("Do not create or sync GitHub issues in this flow.");
    expect(prompt).toContain("Do not use GitHub CLI commands such as gh issue create.");
    expect(prompt).toContain("If the request is a single task, create exactly one backlog card and keep the title close to the user's wording.");
    expect(prompt).toContain("Only avoid creating a new card when an exact duplicate already exists");
    expect(prompt).toContain("User request: echo hello world");
  });
});

describe("scheduleKanbanRefreshBurst", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a bounded refresh burst", () => {
    const onRefresh = vi.fn();

    scheduleKanbanRefreshBurst(onRefresh);
    vi.advanceTimersByTime(Math.max(...AGENT_REFRESH_BURST_DELAYS_MS) + 1);

    expect(onRefresh).toHaveBeenCalledTimes(AGENT_REFRESH_BURST_DELAYS_MS.length);
  });

  it("cancels pending refreshes when cleaned up", () => {
    const onRefresh = vi.fn();

    const cancel = scheduleKanbanRefreshBurst(onRefresh);
    vi.advanceTimersByTime(AGENT_REFRESH_BURST_DELAYS_MS[0] - 1);
    cancel();
    vi.advanceTimersByTime(Math.max(...AGENT_REFRESH_BURST_DELAYS_MS) + 1);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
