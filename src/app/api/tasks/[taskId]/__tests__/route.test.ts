import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, type Task } from "@/core/models/task";

const notify = vi.fn();
const removeCardJob = vi.fn();
const enqueueKanbanTaskSession = vi.fn();
const archiveActiveTaskSession = vi.fn<(task: Task) => void>();
const prepareTaskForColumnChange = vi.fn<(fromColumnId?: string, task?: Task) => boolean>(() => false);
let capturedEnqueueTask: Task | undefined;

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const system = {
  taskStore,
  kanbanBoardStore: { get: vi.fn() },
  workspaceStore: { get: vi.fn() },
  worktreeStore: { assignSession: vi.fn() },
  codebaseStore: { findByRepoPath: vi.fn(), get: vi.fn(), getDefault: vi.fn() },
  eventBus: {},
  artifactStore: undefined,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/task-board-context", () => ({
  ensureTaskBoardContext: vi.fn(async () => ({})),
}));

vi.mock("@/core/kanban/github-issues", () => ({
  updateGitHubIssue: vi.fn(),
}));

vi.mock("@/core/git/git-worktree-service", () => ({
  GitWorktreeService: vi.fn(),
}));

vi.mock("@/core/models/workspace", () => ({
  getDefaultWorkspaceWorktreeRoot: vi.fn(),
  getEffectiveWorkspaceMetadata: vi.fn(),
}));

vi.mock("@/core/kanban/column-transition", () => ({
  emitColumnTransition: vi.fn(),
}));

vi.mock("@/core/kanban/task-session-transition", () => ({
  archiveActiveTaskSession: (task: Task) => archiveActiveTaskSession(task),
  prepareTaskForColumnChange: (fromColumnId?: string, task?: Task) =>
    prepareTaskForColumnChange(fromColumnId, task),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  enqueueKanbanTaskSession: (currentSystem: typeof system, params: { task: Task }) =>
    enqueueKanbanTaskSession(currentSystem, params),
  getKanbanSessionQueue: () => ({ removeCardJob }),
}));

import { PATCH } from "../route";

describe("/api/tasks/[taskId] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedEnqueueTask = undefined;
    taskStore.save.mockResolvedValue();
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue(null);
    taskStore.get.mockResolvedValue(createTask({
      id: "task-1",
      title: "Retry review",
      objective: "Retry review",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-old",
      assignedProvider: "codex",
      assignedRole: "GATE",
      assignedSpecialistId: "pr-reviewer",
      assignedSpecialistName: "PR Reviewer",
    }));
    enqueueKanbanTaskSession.mockImplementation(async (_system, params: { task: Task }) => {
      capturedEnqueueTask = structuredClone(params.task);
      return {
        sessionId: "session-new",
        queued: false,
      };
    });
  });

  it("clears the active queue entry before rerunning a task trigger", async () => {
    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(archiveActiveTaskSession).toHaveBeenCalledTimes(1);
    expect(removeCardJob).toHaveBeenCalledWith("task-1");
    expect(enqueueKanbanTaskSession).toHaveBeenCalledTimes(1);
    expect(enqueueKanbanTaskSession).toHaveBeenCalledWith(system, expect.objectContaining({
      expectedColumnId: "todo",
      ignoreExistingTrigger: true,
    }));
    expect(capturedEnqueueTask).toMatchObject({
      id: "task-1",
      triggerSessionId: undefined,
    });
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      triggerSessionId: "session-new",
    }));
    expect(data.task.triggerSessionId).toBe("session-new");
  });

  it("rejects moving a card out of a lane while later automation steps are still pending", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Run todo pipeline",
      objective: "Complete todo before dev",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-todo-1",
      assignedProvider: "codex",
      assignedRole: "CRAFTER",
      assignedSpecialistId: "kanban-todo-orchestrator",
      assignedSpecialistName: "Todo Orchestrator",
    });
    existingTask.laneSessions = [
      {
        sessionId: "session-todo-1",
        columnId: "todo",
        columnName: "Todo",
        stepId: "step-1",
        stepIndex: 0,
        stepName: "Todo Orchestrator",
        provider: "codex",
        role: "CRAFTER",
        specialistId: "kanban-todo-orchestrator",
        specialistName: "Todo Orchestrator",
        status: "running",
        startedAt: "2026-03-18T00:00:00.000Z",
      },
    ];
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            steps: [
              {
                id: "step-1",
                providerId: "codex",
                role: "CRAFTER",
                specialistId: "kanban-todo-orchestrator",
                specialistName: "Todo Orchestrator",
              },
              {
                id: "step-2",
                role: "GATE",
                specialistId: "gate",
                specialistName: "Verifier",
              },
            ],
          },
        },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "dev" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Todo Orchestrator");
    expect(data.error).toContain("Verifier");
    expect(taskStore.save).not.toHaveBeenCalled();
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });
});
