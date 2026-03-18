import { describe, expect, it, vi } from "vitest";

import { getHttpSessionStore } from "../../acp/http-session-store";
import { EventBus, AgentEventType } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

describe("KanbanWorkflowOrchestrator", () => {
  it("starts an ACP session when a card enters todo with automation enabled", async () => {
    const eventBus = new EventBus();
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const createSession = vi.fn().mockResolvedValue("session-todo-1");

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Main Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", stage: "backlog", position: 0 },
        {
          id: "todo",
          name: "Todo",
          stage: "todo",
          position: 1,
          automation: {
            enabled: true,
            providerId: "codex",
            role: "DEVELOPER",
            transitionType: "entry",
          },
        },
        { id: "dev", name: "Dev", stage: "dev", position: 2 },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-1",
      title: "Verify todo automation",
      objective: "Ensure moving a card into todo starts ACP automation",
      workspaceId: "default",
      boardId: board.id,
      columnId: "backlog",
    });
    await taskStore.save(task);

    const orchestrator = new KanbanWorkflowOrchestrator(
      eventBus,
      boardStore,
      taskStore,
      createSession,
    );
    orchestrator.start();

    eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: {
        cardId: task.id,
        cardTitle: task.title,
        boardId: board.id,
        workspaceId: "default",
        fromColumnId: "backlog",
        toColumnId: "todo",
      },
      timestamp: new Date(),
    });

    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: "default",
        cardId: task.id,
        cardTitle: task.title,
        columnId: "todo",
        columnName: "Todo",
        automation: expect.objectContaining({
          enabled: true,
          providerId: "codex",
          role: "DEVELOPER",
          transitionType: "entry",
        }),
      }));
    });

    expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
      cardId: task.id,
      columnId: "todo",
      status: "running",
      sessionId: "session-todo-1",
    });
  });

  it("clears the previous lane session before auto-advancing into the next automation", async () => {
    const eventBus = new EventBus();
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const createSession = vi
      .fn()
      .mockResolvedValueOnce("session-backlog-1")
      .mockResolvedValueOnce("session-todo-1");

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Main Board",
      isDefault: true,
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          stage: "backlog",
          position: 0,
          automation: {
            enabled: true,
            providerId: "claude",
            role: "DEVELOPER",
            transitionType: "entry",
            autoAdvanceOnSuccess: true,
          },
        },
        {
          id: "todo",
          name: "Todo",
          stage: "todo",
          position: 1,
          automation: {
            enabled: true,
            providerId: "codex",
            role: "ROUTA",
            transitionType: "entry",
            autoAdvanceOnSuccess: true,
          },
        },
        { id: "dev", name: "Dev", stage: "dev", position: 2 },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-2",
      title: "Verify chained automation",
      objective: "Ensure each lane gets a fresh session",
      workspaceId: "default",
      boardId: board.id,
      columnId: "backlog",
      triggerSessionId: "session-backlog-1",
    });
    await taskStore.save(task);

    const orchestrator = new KanbanWorkflowOrchestrator(
      eventBus,
      boardStore,
      taskStore,
      createSession,
    );
    orchestrator.start();

    eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: {
        cardId: task.id,
        cardTitle: task.title,
        boardId: board.id,
        workspaceId: "default",
        fromColumnId: "inbox",
        toColumnId: "backlog",
      },
      timestamp: new Date(),
    });

    await vi.waitFor(() => {
      expect(createSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
        cardId: task.id,
        columnId: "backlog",
      }));
    });

    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "session-backlog-1",
      workspaceId: "default",
      data: {
        sessionId: "session-backlog-1",
        success: true,
      },
      timestamp: new Date(),
    });

    await vi.waitFor(async () => {
      expect(createSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
        cardId: task.id,
        columnId: "todo",
      }));

      const updatedTask = await taskStore.get(task.id);
      expect(updatedTask).toMatchObject({
        id: task.id,
        columnId: "todo",
        triggerSessionId: undefined,
      });
    });
  });

  it("does not let the previous lane cleanup timer delete the next lane automation", async () => {
    vi.useFakeTimers();

    const eventBus = new EventBus();
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const createSession = vi
      .fn()
      .mockResolvedValueOnce("session-backlog-1")
      .mockResolvedValueOnce("session-todo-1");

    const board = createKanbanBoard({
      id: "board-2",
      workspaceId: "default",
      name: "Main Board",
      isDefault: true,
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          stage: "backlog",
          position: 0,
          automation: {
            enabled: true,
            providerId: "claude",
            role: "DEVELOPER",
            transitionType: "entry",
            autoAdvanceOnSuccess: true,
          },
        },
        {
          id: "todo",
          name: "Todo",
          stage: "todo",
          position: 1,
          automation: {
            enabled: true,
            providerId: "codex",
            role: "ROUTA",
            transitionType: "entry",
            autoAdvanceOnSuccess: true,
          },
        },
        { id: "dev", name: "Dev", stage: "dev", position: 2 },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-3",
      title: "Verify automation cleanup isolation",
      objective: "Ensure previous cleanup timers don't delete the next lane entry",
      workspaceId: "default",
      boardId: board.id,
      columnId: "backlog",
      triggerSessionId: "session-backlog-1",
    });
    await taskStore.save(task);

    const orchestrator = new KanbanWorkflowOrchestrator(
      eventBus,
      boardStore,
      taskStore,
      createSession,
    );
    orchestrator.start();

    eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: {
        cardId: task.id,
        cardTitle: task.title,
        boardId: board.id,
        workspaceId: "default",
        fromColumnId: "created",
        toColumnId: "backlog",
      },
      timestamp: new Date(),
    });

    await vi.waitFor(() => {
      expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
        columnId: "backlog",
        sessionId: "session-backlog-1",
      });
    });

    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "session-backlog-1",
      workspaceId: "default",
      data: {
        sessionId: "session-backlog-1",
        success: true,
      },
      timestamp: new Date(),
    });

    await vi.waitFor(() => {
      expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
        columnId: "todo",
        sessionId: "session-todo-1",
      });
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
      columnId: "todo",
      sessionId: "session-todo-1",
    });

    vi.useRealTimers();
  });

  it("recovers an inactive dev session with watchdog retry supervision", async () => {
    const eventBus = new EventBus();
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const sendKanbanSessionPrompt = vi.fn().mockResolvedValue(undefined);
    const createSession = vi
      .fn()
      .mockResolvedValueOnce("session-dev-1")
      .mockResolvedValueOnce("session-dev-2");

    const board = createKanbanBoard({
      id: "board-dev-watchdog",
      workspaceId: "default",
      name: "Main Board",
      isDefault: true,
      columns: [
        { id: "todo", name: "Todo", stage: "todo", position: 0 },
        {
          id: "dev",
          name: "Dev",
          stage: "dev",
          position: 1,
          automation: {
            enabled: true,
            providerId: "codex",
            role: "DEVELOPER",
            transitionType: "entry",
          },
        },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-watchdog",
      title: "Recover stalled dev session",
      objective: "Implement the task even if the first session stalls",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
    });
    await taskStore.save(task);

    const orchestrator = new KanbanWorkflowOrchestrator(
      eventBus,
      boardStore,
      taskStore,
      createSession,
    );
    orchestrator.setSendKanbanSessionPrompt((params) => sendKanbanSessionPrompt(params));
    orchestrator.setResolveDevSessionSupervision(async () => ({
      mode: "watchdog_retry",
      inactivityTimeoutMinutes: 1,
      maxRecoveryAttempts: 1,
      completionRequirement: "turn_complete",
    }));
    orchestrator.start();

    eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: {
        cardId: task.id,
        cardTitle: task.title,
        boardId: board.id,
        workspaceId: "default",
        fromColumnId: "todo",
        toColumnId: "dev",
      },
      timestamp: new Date(),
    });

    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledTimes(1);
      expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
        sessionId: "session-dev-1",
        attempt: 1,
        recoveryAttempts: 0,
      });
    });

    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId: "session-dev-1",
      cwd: "/tmp",
      workspaceId: "default",
      provider: "codex",
      createdAt: new Date(Date.now() - 61_000).toISOString(),
    });

    const watchdog = orchestrator as unknown as {
      scanForInactiveSessions: () => Promise<void>;
    };
    await watchdog.scanForInactiveSessions();

    await vi.waitFor(async () => {
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
        sessionId: "session-dev-2",
        attempt: 2,
        recoveryAttempts: 1,
        status: "running",
      });
      const updatedTask = await taskStore.get(task.id);
      expect(updatedTask?.lastSyncError).toContain("Attempt 2/2");
      expect(sendKanbanSessionPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-dev-1",
          prompt: expect.stringContaining("acp session id = session-dev-1"),
        }),
      );
    });

    orchestrator.stop();
  });

  it("recreates a dev session in Ralph Loop mode until completion criteria are met", async () => {
    const eventBus = new EventBus();
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const sendKanbanSessionPrompt = vi.fn().mockResolvedValue(undefined);
    const createSession = vi
      .fn()
      .mockResolvedValueOnce("session-loop-1")
      .mockResolvedValueOnce("session-loop-2");

    const board = createKanbanBoard({
      id: "board-dev-loop",
      workspaceId: "default",
      name: "Main Board",
      isDefault: true,
      columns: [
        { id: "todo", name: "Todo", stage: "todo", position: 0 },
        {
          id: "dev",
          name: "Dev",
          stage: "dev",
          position: 1,
          automation: {
            enabled: true,
            providerId: "claude",
            role: "DEVELOPER",
            transitionType: "entry",
          },
        },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-loop",
      title: "Ralph loop dev session",
      objective: "Persist completion summary before finishing",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
    });
    await taskStore.save(task);

    const orchestrator = new KanbanWorkflowOrchestrator(
      eventBus,
      boardStore,
      taskStore,
      createSession,
    );
    orchestrator.setSendKanbanSessionPrompt((params) => sendKanbanSessionPrompt(params));
    orchestrator.setResolveDevSessionSupervision(async () => ({
      mode: "ralph_loop",
      inactivityTimeoutMinutes: 10,
      maxRecoveryAttempts: 1,
      completionRequirement: "completion_summary",
    }));
    orchestrator.start();

    eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: {
        cardId: task.id,
        cardTitle: task.title,
        boardId: board.id,
        workspaceId: "default",
        fromColumnId: "todo",
        toColumnId: "dev",
      },
      timestamp: new Date(),
    });

    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledTimes(1);
      expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
        sessionId: "session-loop-1",
        attempt: 1,
      });
    });

    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "session-loop-1",
      workspaceId: "default",
      data: {
        sessionId: "session-loop-1",
        success: true,
      },
      timestamp: new Date(),
    });

    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
        sessionId: "session-loop-2",
        attempt: 2,
        status: "running",
      });
      expect(sendKanbanSessionPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-loop-1",
          prompt: expect.stringContaining("acp session id = session-loop-1"),
        }),
      );
    });

    const updatedTask = await taskStore.get(task.id);
    if (!updatedTask) {
      throw new Error("Expected task-loop");
    }
    updatedTask.completionSummary = "Implemented successfully";
    await taskStore.save(updatedTask);

    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "session-loop-2",
      workspaceId: "default",
      data: {
        sessionId: "session-loop-2",
        success: true,
      },
      timestamp: new Date(),
    });

    await vi.waitFor(async () => {
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({
        sessionId: "session-loop-2",
        status: "completed",
      });
      const completedTask = await taskStore.get(task.id);
      expect(completedTask?.lastSyncError).toBeUndefined();
    });

    orchestrator.stop();
  });
});
