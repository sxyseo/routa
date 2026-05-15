import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, AgentEventType } from "../../events/event-bus";
import { createTask, TaskStatus } from "../../models/task";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanSessionQueue } from "../kanban-session-queue";

describe("KanbanSessionQueue", () => {
  let eventBus: EventBus;
  let taskStore: InMemoryTaskStore;

  beforeEach(() => {
    eventBus = new EventBus();
    taskStore = new InMemoryTaskStore();
  });

  it("queues extra cards when the board concurrency limit is reached", async () => {
    await taskStore.save(createTask({
      id: "task-1",
      title: "First task",
      objective: "First task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));
    await taskStore.save(createTask({
      id: "task-2",
      title: "Second task",
      objective: "Second task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));

    const startFirst = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const startSecond = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    const first = await queue.enqueue({
      cardId: "task-1",
      cardTitle: "First task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startFirst,
    });
    const second = await queue.enqueue({
      cardId: "task-2",
      cardTitle: "Second task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startSecond,
    });

    expect(first).toEqual({ sessionId: "session-1", queued: false });
    expect(second).toEqual({ queued: true });
    expect(startFirst).toHaveBeenCalledTimes(1);
    expect(startSecond).not.toHaveBeenCalled();
    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-1", cardTitle: "First task" }],
      queuedCount: 1,
      queuedCardIds: ["task-2"],
      queuedCards: [{ cardId: "task-2", cardTitle: "Second task" }],
      queuedPositions: { "task-2": 1 },
    });

    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "agent-1",
      workspaceId: "default",
      data: { sessionId: "session-1", success: true },
      timestamp: new Date(),
    });
    await vi.waitFor(() => {
      expect(startSecond).toHaveBeenCalledTimes(1);
    });

    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-2", cardTitle: "Second task" }],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  it("drops stale queued cards that have moved away before a slot opens", async () => {
    await taskStore.save(createTask({
      id: "task-1",
      title: "First task",
      objective: "First task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));
    await taskStore.save(createTask({
      id: "task-2",
      title: "Second task",
      objective: "Second task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));

    const startFirst = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const startSecond = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    await queue.enqueue({
      cardId: "task-1",
      cardTitle: "First task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startFirst,
    });
    await queue.enqueue({
      cardId: "task-2",
      cardTitle: "Second task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startSecond,
    });

    const movedTask = await taskStore.get("task-2");
    if (!movedTask) {
      throw new Error("Expected task-2");
    }
    movedTask.columnId = "done";
    await taskStore.save(movedTask);

    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "agent-1",
      workspaceId: "default",
      data: { sessionId: "session-1", success: true },
      timestamp: new Date(),
    });
    await vi.waitFor(async () => {
      await expect(queue.getBoardSnapshot("board-1")).resolves.toMatchObject({ queuedCount: 0 });
    });

    expect(startSecond).not.toHaveBeenCalled();
    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 0,
      runningCards: [],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  it("drops queued cards that already gained a trigger session before snapshotting", async () => {
    await taskStore.save(createTask({
      id: "task-1",
      title: "First task",
      objective: "First task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-1",
    }));
    await taskStore.save(createTask({
      id: "task-2",
      title: "Second task",
      objective: "Second task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));

    const startFirst = vi.fn().mockResolvedValue({ sessionId: "session-existing" });
    const startSecond = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    await queue.enqueue({
      cardId: "task-1",
      cardTitle: "First task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startFirst,
    });
    await queue.enqueue({
      cardId: "task-2",
      cardTitle: "Second task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startSecond,
    });

    const queuedTask = await taskStore.get("task-2");
    if (!queuedTask) {
      throw new Error("Expected task-2");
    }
    queuedTask.triggerSessionId = "session-2";
    await taskStore.save(queuedTask);

    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-1", cardTitle: "First task" }],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  it("drops stale running cards that no longer exist before counting board capacity", async () => {
    await taskStore.save(createTask({
      id: "task-2",
      title: "Second task",
      objective: "Second task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));

    const startGhost = vi.fn().mockResolvedValue({ sessionId: "session-ghost" });
    const startSecond = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    await queue.enqueue({
      cardId: "task-ghost",
      cardTitle: "Ghost task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startGhost,
    });

    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 0,
      runningCards: [],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    const second = await queue.enqueue({
      cardId: "task-2",
      cardTitle: "Second task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startSecond,
    });

    expect(second).toEqual({ sessionId: "session-2", queued: false });
    expect(startSecond).toHaveBeenCalledTimes(1);
    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-2", cardTitle: "Second task" }],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  it("includes orphaned tasks with triggerSessionId in running count when tasks are provided", async () => {
    await taskStore.save(createTask({
      id: "task-1",
      title: "Running task",
      objective: "Running task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-orphaned",
    }));

    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 2);
    queue.start();

    const tasks = [
      { id: "task-1", boardId: "board-1", triggerSessionId: "session-orphaned", title: "Running task" },
      { id: "task-2", boardId: "board-1", triggerSessionId: undefined, title: "Idle task" },
    ];

    const snapshot = await queue.getBoardSnapshot("board-1", tasks);
    expect(snapshot).toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-1", cardTitle: "Running task" }],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  it("merges orphaned tasks with in-memory queue running entries", async () => {
    const startA = vi.fn().mockResolvedValue({ sessionId: "session-a" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 2);
    queue.start();

    await queue.enqueue({
      cardId: "task-queued",
      cardTitle: "Queued task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startA,
    });

    const tasks = [
      { id: "task-orphaned", boardId: "board-1", triggerSessionId: "session-orphan", title: "Orphaned task" },
      { id: "task-queued", boardId: "board-1", triggerSessionId: "session-a", title: "Queued task" },
    ];

    const snapshot = await queue.getBoardSnapshot("board-1", tasks);
    expect(snapshot.runningCount).toBe(2);
    expect(snapshot.runningCards).toContainEqual({ cardId: "task-queued", cardTitle: "Queued task" });
    expect(snapshot.runningCards).toContainEqual({ cardId: "task-orphaned", cardTitle: "Orphaned task" });

    queue.stop();
  });

  it("returns 0 running when no tasks provided (backward compatible)", async () => {
    await taskStore.save(createTask({
      id: "task-1",
      title: "Running task",
      objective: "Running task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-1",
    }));

    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 2);
    queue.start();

    const snapshot = await queue.getBoardSnapshot("board-1");
    expect(snapshot.runningCount).toBe(0);
    expect(snapshot.runningCards).toEqual([]);

    queue.stop();
  });

  it("excludes orphaned tasks that belong to a different board", async () => {
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 2);
    queue.start();

    const tasks = [
      { id: "task-1", boardId: "board-2", triggerSessionId: "session-1", title: "Other board" },
      { id: "task-2", boardId: "board-1", triggerSessionId: "session-2", title: "This board" },
    ];

    const snapshot = await queue.getBoardSnapshot("board-1", tasks);
    expect(snapshot.runningCount).toBe(1);
    expect(snapshot.runningCards).toEqual([{ cardId: "task-2", cardTitle: "This board" }]);

    queue.stop();
  });

  it("queues new cards when orphaned running tasks fill the concurrency limit", async () => {
    // task-1 has a running lane session but is not tracked by the queue (orphaned).
    // This simulates the race condition where a recovery session started during
    // an async window and the queue's in-memory map doesn't know about it.
    const orphanedTask = createTask({
      id: "task-1",
      title: "Orphaned running task",
      objective: "Orphaned running task",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
      triggerSessionId: "session-orphaned",
    });
    orphanedTask.laneSessions = [{ sessionId: "session-orphaned", columnId: "dev", columnName: "Dev", stepId: "dev-executor", stepIndex: 0, stepName: "Dev Executor", status: "running", startedAt: new Date().toISOString() }];
    await taskStore.save(orphanedTask);
    await taskStore.save(createTask({
      id: "task-2",
      title: "New task",
      objective: "New task",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.PENDING,
    }));

    const startNew = vi.fn().mockResolvedValue({ sessionId: "session-new" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    const result = await queue.enqueue({
      cardId: "task-2",
      cardTitle: "New task",
      boardId: "board-1",
      workspaceId: "ws-1",
      columnId: "dev",
      start: startNew,
    });

    // With concurrency limit 1 and an orphaned running task, task-2 must be queued.
    expect(result).toEqual({ queued: true });
    expect(startNew).not.toHaveBeenCalled();

    queue.stop();
  });
});
