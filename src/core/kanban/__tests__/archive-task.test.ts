import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus } from "../../models/task";
import { createKanbanBoard } from "../../models/kanban";
import { InMemoryTaskStore } from "../../store/task-store";
import { EventBus, AgentEventType } from "../../events/event-bus";
import { archiveTask, archiveDoneTasks } from "../archive-task";

describe("archiveTask", () => {
  let eventBus: EventBus;
  let taskStore: InMemoryTaskStore;
  let workspaceStore: { get: (id: string) => Promise<{ metadata?: Record<string, string> } | undefined> };

  const board = createKanbanBoard({
    id: "board-1",
    workspaceId: "ws-1",
    name: "Test Board",
    columns: [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "done", name: "Done", position: 1, stage: "done" },
      { id: "archived", name: "Archived", position: 2, stage: "archived" },
    ],
  });

  beforeEach(() => {
    eventBus = new EventBus();
    taskStore = new InMemoryTaskStore();
    workspaceStore = { get: vi.fn().mockResolvedValue({ metadata: {} }) };
  });

  function getSystem() {
    return { taskStore, workspaceStore, eventBus };
  }

  it("moves task to archived column and sets ARCHIVED status", async () => {
    const task = createTask({
      id: "task-1",
      title: "Done task",
      objective: "Done task",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    });
    await taskStore.save(task);

    const result = await archiveTask(getSystem(), task, board);

    expect(result.success).toBe(true);
    expect(result.taskId).toBe("task-1");

    const updated = await taskStore.get("task-1");
    expect(updated?.columnId).toBe("archived");
    expect(updated?.status).toBe(TaskStatus.ARCHIVED);
  });

  it("is idempotent — returns success for already-archived tasks", async () => {
    const task = createTask({
      id: "task-1",
      title: "Already archived",
      objective: "Already archived",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "archived",
      status: TaskStatus.ARCHIVED,
    });
    await taskStore.save(task);

    const emitSpy = vi.spyOn(eventBus, "emit");
    const result = await archiveTask(getSystem(), task, board);

    expect(result.success).toBe(true);
    expect(result.worktreeCleanupScheduled).toBe(false);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("clears triggerSessionId and marks running lane sessions as transitioned", async () => {
    const task = createTask({
      id: "task-1",
      title: "Running task",
      objective: "Running task",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    });
    task.triggerSessionId = "session-1";
    task.laneSessions = [
      { sessionId: "session-1", columnId: "done", status: "running", startedAt: "2025-01-01T00:00:00.000Z" },
    ];
    await taskStore.save(task);

    await archiveTask(getSystem(), task, board);

    const updated = await taskStore.get("task-1");
    expect(updated?.triggerSessionId).toBeUndefined();
    expect(updated?.laneSessions[0]?.status).toBe("transitioned");
  });

  it("emits COLUMN_TRANSITION event with correct columns", async () => {
    const task = createTask({
      id: "task-1",
      title: "Transition test",
      objective: "Transition test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    });
    await taskStore.save(task);

    const emitSpy = vi.spyOn(eventBus, "emit");
    await archiveTask(getSystem(), task, board);

    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AgentEventType.COLUMN_TRANSITION,
        data: expect.objectContaining({
          cardId: "task-1",
          fromColumnId: "done",
          toColumnId: "archived",
        }),
      }),
    );
  });

  it("emits WORKTREE_CLEANUP event when task has a worktreeId", async () => {
    const task = createTask({
      id: "task-1",
      title: "Has worktree",
      objective: "Has worktree",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    });
    task.worktreeId = "wt-1";
    await taskStore.save(task);

    const emitSpy = vi.spyOn(eventBus, "emit");
    const result = await archiveTask(getSystem(), task, board);

    expect(result.worktreeCleanupScheduled).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AgentEventType.WORKTREE_CLEANUP,
        data: expect.objectContaining({
          worktreeId: "wt-1",
          taskId: "task-1",
          deleteBranch: true,
        }),
      }),
    );
  });

  it("does not emit WORKTREE_CLEANUP when task has no worktree", async () => {
    const task = createTask({
      id: "task-1",
      title: "No worktree",
      objective: "No worktree",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    });
    await taskStore.save(task);

    const emitSpy = vi.spyOn(eventBus, "emit");
    const result = await archiveTask(getSystem(), task, board);

    expect(result.worktreeCleanupScheduled).toBe(false);
    const cleanupCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === AgentEventType.WORKTREE_CLEANUP,
    );
    expect(cleanupCalls).toHaveLength(0);
  });

  it("returns error when board has no archived column", async () => {
    const boardWithoutArchive = createKanbanBoard({
      id: "board-2",
      workspaceId: "ws-1",
      name: "No Archive Board",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "done", name: "Done", position: 1, stage: "done" },
      ],
    });

    const task = createTask({
      id: "task-1",
      title: "Test",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-2",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    });
    await taskStore.save(task);

    const result = await archiveTask(getSystem(), task, boardWithoutArchive);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No archived column");
  });
});

describe("archiveDoneTasks", () => {
  let eventBus: EventBus;
  let taskStore: InMemoryTaskStore;
  let workspaceStore: { get: (id: string) => Promise<{ metadata?: Record<string, string> } | undefined> };

  const board = createKanbanBoard({
    id: "board-1",
    workspaceId: "ws-1",
    name: "Test Board",
    columns: [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "done", name: "Done", position: 1, stage: "done" },
      { id: "archived", name: "Archived", position: 2, stage: "archived" },
    ],
  });

  beforeEach(() => {
    eventBus = new EventBus();
    taskStore = new InMemoryTaskStore();
    workspaceStore = { get: vi.fn().mockResolvedValue({ metadata: {} }) };
  });

  function getSystem() {
    return { taskStore, workspaceStore, eventBus };
  }

  it("archives all done tasks that pass safety checks", async () => {
    await taskStore.save(createTask({
      id: "task-1", title: "Done 1", objective: "Done 1",
      workspaceId: "ws-1", boardId: "board-1", columnId: "done", status: TaskStatus.COMPLETED,
    }));
    await taskStore.save(createTask({
      id: "task-2", title: "Done 2", objective: "Done 2",
      workspaceId: "ws-1", boardId: "board-1", columnId: "done", status: TaskStatus.COMPLETED,
    }));
    await taskStore.save(createTask({
      id: "task-3", title: "Backlog", objective: "Backlog",
      workspaceId: "ws-1", boardId: "board-1", columnId: "backlog", status: TaskStatus.PENDING,
    }));

    const result = await archiveDoneTasks(getSystem(), board);

    expect(result.archived).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    const t1 = await taskStore.get("task-1");
    const t2 = await taskStore.get("task-2");
    expect(t1?.columnId).toBe("archived");
    expect(t2?.columnId).toBe("archived");
  });

  it("skips tasks with pending automation", async () => {
    const task = createTask({
      id: "task-1", title: "Running", objective: "Running",
      workspaceId: "ws-1", boardId: "board-1", columnId: "done", status: TaskStatus.COMPLETED,
    });
    task.laneSessions = [
      { sessionId: "s-1", columnId: "done", status: "running", startedAt: "2025-01-01T00:00:00.000Z" },
    ];
    await taskStore.save(task);

    const result = await archiveDoneTasks(getSystem(), board);

    expect(result.archived).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain("自动化");
  });

  it("skips tasks with open PRs", async () => {
    const task = createTask({
      id: "task-1", title: "Open PR", objective: "Open PR",
      workspaceId: "ws-1", boardId: "board-1", columnId: "done", status: TaskStatus.COMPLETED,
    });
    task.pullRequestUrl = "https://github.com/test/pull/1";
    await taskStore.save(task);

    const result = await archiveDoneTasks(getSystem(), board);

    expect(result.archived).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain("PR");
  });

  it("archives specific tasks when taskIds provided", async () => {
    await taskStore.save(createTask({
      id: "task-1", title: "Done 1", objective: "Done 1",
      workspaceId: "ws-1", boardId: "board-1", columnId: "done", status: TaskStatus.COMPLETED,
    }));
    await taskStore.save(createTask({
      id: "task-2", title: "Done 2", objective: "Done 2",
      workspaceId: "ws-1", boardId: "board-1", columnId: "done", status: TaskStatus.COMPLETED,
    }));

    const result = await archiveDoneTasks(getSystem(), board, ["task-1"]);

    expect(result.archived).toHaveLength(1);
    expect(result.archived[0]?.taskId).toBe("task-1");

    const t2 = await taskStore.get("task-2");
    expect(t2?.columnId).toBe("done");
  });

  it("returns empty result when no done column exists", async () => {
    const boardNoDone = createKanbanBoard({
      id: "board-2", workspaceId: "ws-1", name: "No Done",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "archived", name: "Archived", position: 1, stage: "archived" },
      ],
    });

    const result = await archiveDoneTasks(getSystem(), boardNoDone);
    expect(result.archived).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
