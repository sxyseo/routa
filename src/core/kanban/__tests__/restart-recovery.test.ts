import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";
import { reviveMissingEntryAutomations, sweepStuckTasksOnStartup } from "../restart-recovery";

const notify = vi.fn();
const processKanbanColumnTransition = vi.fn();
const enqueueKanbanTaskSession = vi.fn();

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
}));

function createTaskWithRunningSession(overrides?: Partial<Task>): Task {
  return {
    ...createTask({
      id: "task-1",
      title: "Backlog story",
      objective: "Backlog story",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }),
    triggerSessionId: "session-1",
    laneSessions: [{
      sessionId: "session-1",
      columnId: "backlog",
      status: "running",
      startedAt: "2025-01-01T00:00:00.000Z",
    }],
    ...overrides,
  };
}

describe("kanban restart recovery", () => {
  const taskStore = {
    listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
    save: vi.fn<(task: Task) => Promise<void>>(),
  };

  const kanbanBoardStore = {
    get: vi.fn(),
  };

  const system = {
    taskStore,
    kanbanBoardStore,
  };

  const sessionStore = {
    getSession: vi.fn(),
  };

  const processManager = {
    hasActiveSession: vi.fn<(sessionId: string) => boolean>(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.save.mockResolvedValue(undefined);
    enqueueKanbanTaskSession.mockResolvedValue({ sessionId: "session-next", queued: false });
    sessionStore.getSession.mockReturnValue(undefined);
    processManager.hasActiveSession.mockReturnValue(false);
  });

  it("revives ownerless hydrated sessions even if the lease timestamp is still in the future", async () => {
    kanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [{
        id: "backlog",
        name: "Backlog",
        position: 0,
        stage: "backlog",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
        },
      }],
    });
    taskStore.listByWorkspace.mockResolvedValue([createTaskWithRunningSession()]);
    sessionStore.getSession.mockReturnValue({
      sessionId: "session-1",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      triggerSessionId: undefined,
      laneSessions: [expect.objectContaining({
        sessionId: "session-1",
        status: "timed_out",
      })],
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      fromColumnId: "__revive__",
      toColumnId: "backlog",
    }));
  });

  it("re-enqueues the next step when recovery resumes a multi-step lane", async () => {
    const devBoard = {
      id: "board-1",
      columns: [{
        id: "dev",
        name: "Dev",
        position: 0,
        stage: "dev",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [
            { id: "dev-planner", role: "CRAFTER", specialistId: "dev-planner", specialistName: "Dev Planner" },
            { id: "dev-executor", role: "CRAFTER", specialistId: "dev-executor", specialistName: "Dev Executor" },
          ],
        },
      }],
    };
    kanbanBoardStore.get.mockResolvedValue(devBoard);
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTaskWithRunningSession({
        title: "In-progress dev story",
        objective: "Dev story",
        columnId: "dev",
        status: TaskStatus.IN_PROGRESS,
      }),
      laneSessions: [{
        sessionId: "session-1",
        columnId: "dev",
        status: "running",
        stepId: "dev-planner",
        stepIndex: 0,
        stepName: "Dev Planner",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(enqueueKanbanTaskSession).toHaveBeenCalledWith(system, expect.objectContaining({
      expectedColumnId: "dev",
      ignoreExistingTrigger: true,
      stepIndex: 1,
      step: expect.objectContaining({ id: "dev-executor" }),
    }));
    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
  });

  it("skips re-triggering when the last automation step already completed", async () => {
    kanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [{
        id: "backlog",
        name: "Backlog",
        position: 0,
        stage: "backlog",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
        },
      }],
    });
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTask({
        id: "task-1",
        title: "Refined backlog story",
        objective: "Refined backlog story",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "backlog",
        status: TaskStatus.PENDING,
      }),
      laneSessions: [{
        sessionId: "session-1",
        columnId: "backlog",
        status: "completed",
        stepId: "backlog-refiner",
        stepIndex: 0,
        stepName: "Backlog Refiner",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });

  it("maps convergence status from the target column stage for custom done columns", async () => {
    const reviewBoard = {
      id: "board-1",
      columns: [
        {
          id: "review",
          name: "Review",
          position: 0,
          stage: "review",
          automation: {
            enabled: true,
            transitionType: "entry",
            steps: [
              { id: "review-guard", role: "GATE" },
            ],
          },
        },
        {
          id: "stage-7",
          name: "Released",
          position: 1,
          stage: "done",
        },
      ],
    };
    kanbanBoardStore.get.mockResolvedValue(reviewBoard);
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTask({
        id: "task-1",
        title: "Approved review story",
        objective: "Review story",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "review",
        status: TaskStatus.REVIEW_REQUIRED,
      }),
      verificationVerdict: VerificationVerdict.APPROVED,
      laneSessions: [{
        sessionId: "session-review-guard",
        columnId: "review",
        status: "completed",
        stepId: "review-guard",
        stepIndex: 0,
        stepName: "Review Guard",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      columnId: "stage-7",
      status: TaskStatus.COMPLETED,
    }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      action: "moved",
      resourceId: "task-1",
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      fromColumnId: "review",
      toColumnId: "stage-7",
      toColumnName: "Released",
    }));
  });

  it("triggers entry automation immediately after convergence moves a card back to dev", async () => {
    const reviewBoard = {
      id: "board-1",
      columns: [
        {
          id: "review",
          name: "Review",
          position: 0,
          stage: "review",
          automation: {
            enabled: true,
            transitionType: "entry",
            steps: [
              { id: "review-guard", role: "GATE" },
            ],
          },
        },
        {
          id: "implementation",
          name: "Implementation",
          position: 1,
          stage: "dev",
          automation: {
            enabled: true,
            transitionType: "entry",
            steps: [{ id: "builder", role: "DEVELOPER" }],
          },
        },
      ],
    };
    kanbanBoardStore.get.mockResolvedValue(reviewBoard);
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTask({
        id: "task-1",
        title: "Rejected review story",
        objective: "Review story",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "review",
        status: TaskStatus.REVIEW_REQUIRED,
      }),
      verificationVerdict: VerificationVerdict.NOT_APPROVED,
      laneSessions: [{
        sessionId: "session-review-guard",
        columnId: "review",
        status: "completed",
        stepId: "review-guard",
        stepIndex: 0,
        stepName: "Review Guard",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      columnId: "implementation",
      status: TaskStatus.IN_PROGRESS,
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      fromColumnId: "review",
      toColumnId: "implementation",
      toColumnName: "Implementation",
    }));
  });

  it("does not revive automation for the manual-only blocked lane", async () => {
    kanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [{
        id: "blocked",
        name: "Blocked",
        position: 0,
        stage: "blocked",
        automation: {
          enabled: false,
          transitionType: "entry",
          steps: [{ id: "blocked-resolver", role: "CRAFTER" }],
        },
      }],
    });
    taskStore.listByWorkspace.mockResolvedValue([createTask({
      id: "task-1",
      title: "Blocked story",
      objective: "Wait for unblock",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "blocked",
      status: TaskStatus.BLOCKED,
    })]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });
});

// ── sweepStuckTasksOnStartup ─────────────────────────────────────────────────

describe("sweepStuckTasksOnStartup", () => {
  const sweepTaskStore = {
    listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
    save: vi.fn<(task: Task) => Promise<void>>(),
    atomicUpdate: vi.fn<(id: string, version: number, fields: Record<string, unknown>) => Promise<boolean>>(),
  };

  const sweepKanbanBoardStore = {
    get: vi.fn(),
  };

  const sweepWorkspaceStore = {
    list: vi.fn<() => Promise<Array<{ id: string }>>>(),
  };

  const sweepSystem = {
    taskStore: sweepTaskStore,
    kanbanBoardStore: sweepKanbanBoardStore,
    workspaceStore: sweepWorkspaceStore,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sweepTaskStore.save.mockResolvedValue(undefined);
    sweepTaskStore.atomicUpdate.mockResolvedValue(true);
  });

  it("clears repeat-limit error markers on startup", async () => {
    const task = createTask({
      id: "sweep-repeat",
      title: "Repeat limit task",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.IN_PROGRESS,
    });
    task.lastSyncError = 'Stopped Kanban automation for "Review" after 4 runs.';
    task.laneSessions = [
      { sessionId: "s1", columnId: "review", status: "failed", startedAt: new Date().toISOString() },
    ];
    task.version = 1;

    sweepWorkspaceStore.list.mockResolvedValue([{ id: "ws-1" }]);
    sweepTaskStore.listByWorkspace.mockResolvedValue([task]);

    const result = await sweepStuckTasksOnStartup(sweepSystem as never);

    expect(result.swept).toBe(1);
    expect(sweepTaskStore.atomicUpdate).toHaveBeenCalledWith(
      "sweep-repeat",
      1,
      expect.objectContaining({
        lastSyncError: undefined,
        laneSessions: [],
      }),
    );
  });

  it("clears step-resume-limit error markers", async () => {
    const task = createTask({
      id: "sweep-step-resume",
      title: "Step resume limit",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    });
    task.lastSyncError = "[advance-recovery] Max retries (3) reached.";
    task.version = 2;

    sweepWorkspaceStore.list.mockResolvedValue([{ id: "ws-1" }]);
    sweepTaskStore.listByWorkspace.mockResolvedValue([task]);

    const result = await sweepStuckTasksOnStartup(sweepSystem as never);

    expect(result.swept).toBe(1);
    expect(sweepTaskStore.atomicUpdate).toHaveBeenCalledWith(
      "sweep-step-resume",
      2,
      expect.objectContaining({ lastSyncError: undefined }),
    );
  });

  it("clears CB max-resets error markers", async () => {
    const task = createTask({
      id: "sweep-cb-max",
      title: "CB max resets",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
    });
    task.lastSyncError = "[circuit-breaker:reset=5] pending retry.";
    task.version = 3;

    sweepWorkspaceStore.list.mockResolvedValue([{ id: "ws-1" }]);
    sweepTaskStore.listByWorkspace.mockResolvedValue([task]);

    const result = await sweepStuckTasksOnStartup(sweepSystem as never);

    expect(result.swept).toBe(1);
  });

  it("fixes orphan IN_PROGRESS in done column to COMPLETED", async () => {
    const task = createTask({
      id: "sweep-orphan",
      title: "Orphan in done",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.IN_PROGRESS,
    });
    task.lastSyncError = 'Stopped Kanban automation for "Done" after 4 runs.';
    task.version = 1;

    sweepWorkspaceStore.list.mockResolvedValue([{ id: "ws-1" }]);
    sweepTaskStore.listByWorkspace.mockResolvedValue([task]);
    sweepKanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [{ id: "done", name: "Done", stage: "done", position: 0 }],
    });

    const result = await sweepStuckTasksOnStartup(sweepSystem as never);

    expect(result.swept).toBe(1);
    expect(sweepTaskStore.atomicUpdate).toHaveBeenCalledWith(
      "sweep-orphan",
      1,
      expect.objectContaining({ status: "COMPLETED" }),
    );
  });

  it("skips tasks without stuck error markers", async () => {
    const healthyTask = createTask({
      id: "sweep-healthy",
      title: "Healthy task",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
    });

    sweepWorkspaceStore.list.mockResolvedValue([{ id: "ws-1" }]);
    sweepTaskStore.listByWorkspace.mockResolvedValue([healthyTask]);

    const result = await sweepStuckTasksOnStartup(sweepSystem as never);

    expect(result.swept).toBe(0);
    expect(sweepTaskStore.save).not.toHaveBeenCalled();
    expect(sweepTaskStore.atomicUpdate).not.toHaveBeenCalled();
  });

  it("falls back to save() when task has no version", async () => {
    const task = createTask({
      id: "sweep-no-version",
      title: "No version",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "review",
    });
    task.lastSyncError = 'Stopped Kanban automation for "Review" after 4 runs.';
    delete (task as unknown as Record<string, unknown>).version;

    sweepWorkspaceStore.list.mockResolvedValue([{ id: "ws-1" }]);
    sweepTaskStore.listByWorkspace.mockResolvedValue([task]);

    const result = await sweepStuckTasksOnStartup(sweepSystem as never);

    expect(result.swept).toBe(1);
    expect(sweepTaskStore.save).toHaveBeenCalled();
    expect(sweepTaskStore.atomicUpdate).not.toHaveBeenCalled();
  });
});
