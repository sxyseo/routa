import { describe, it, expect, beforeEach } from "vitest";
import { onChildTaskStatusChanged, getChildTasks, cancelChildren } from "../parent-child-lifecycle";
import { InMemoryTaskStore } from "../../store/task-store";
import { createTask, TaskStatus } from "../../models/task";
import { EventBus } from "../../events/event-bus";

// Minimal KanbanBoardStore for testing
class InMemoryKanbanBoardStore {
  private boards = new Map();

  async save(board: any) { this.boards.set(board.id, board); }
  async get(id: string) { return this.boards.get(id); }
  async listByWorkspace(wsId: string) {
    return [...this.boards.values()].filter((b: any) => b.workspaceId === wsId);
  }
}

// Minimal WorktreeStore stub for testing (fan-in not exercised in these unit tests)
const worktreeStoreStub = {
  get: async () => undefined,
} as any;

describe("parent-child-lifecycle", () => {
  let taskStore: InMemoryTaskStore;
  let boardStore: InMemoryKanbanBoardStore;
  let eventBus: EventBus;
  let parentTask: ReturnType<typeof createTask>;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    boardStore = new InMemoryKanbanBoardStore();
    eventBus = new EventBus();

    parentTask = createTask({
      id: "parent-1",
      title: "Parent",
      objective: "Big task",
      workspaceId: "ws-1",
      boardId: "board-1",
      status: TaskStatus.PENDING,
    });
  });

  it("returns none for tasks without parent", async () => {
    const orphan = createTask({
      id: "orphan",
      title: "Orphan",
      objective: "",
      workspaceId: "ws-1",
      status: TaskStatus.COMPLETED,
    });

    const result = await onChildTaskStatusChanged(orphan, {
      taskStore, kanbanBoardStore: boardStore as any, worktreeStore: worktreeStoreStub, eventBus,
    });

    expect(result.action).toBe("none");
    expect(result.parentUpdated).toBe(false);
  });

  it("marks parent with error when child is blocked", async () => {
    await taskStore.save(parentTask);

    const child = createTask({
      id: "child-1",
      title: "Child",
      objective: "",
      workspaceId: "ws-1",
      parentTaskId: "parent-1",
      status: TaskStatus.BLOCKED,
    });
    await taskStore.save(child);

    const result = await onChildTaskStatusChanged(child, {
      taskStore, kanbanBoardStore: boardStore as any, worktreeStore: worktreeStoreStub, eventBus,
    });

    expect(result.action).toBe("child_has_problem");
    expect(result.parentUpdated).toBe(true);

    const updated = await taskStore.get("parent-1");
    expect(updated?.lastSyncError).toContain("[Parent]");
  });

  it("clears parent error when child recovers", async () => {
    parentTask.lastSyncError = "[Parent] Child is BLOCKED";
    await taskStore.save(parentTask);

    const child = createTask({
      id: "child-1",
      title: "Child",
      objective: "",
      workspaceId: "ws-1",
      parentTaskId: "parent-1",
      status: TaskStatus.IN_PROGRESS,
    });
    await taskStore.save(child);

    const result = await onChildTaskStatusChanged(child, {
      taskStore, kanbanBoardStore: boardStore as any, worktreeStore: worktreeStoreStub, eventBus,
    });

    expect(result.action).toBe("problems_cleared");
    const updated = await taskStore.get("parent-1");
    expect(updated?.lastSyncError).toBeUndefined();
  });

  it("advances parent when all children complete", async () => {
    await taskStore.save(parentTask);

    // Create board with review column
    await boardStore.save({
      id: "board-1",
      workspaceId: "ws-1",
      columns: [
        { id: "backlog", name: "Backlog", stage: "backlog", position: 0 },
        { id: "review", name: "Review", stage: "review", position: 3 },
      ],
    });

    const child1 = createTask({
      id: "child-1", title: "C1", objective: "", workspaceId: "ws-1",
      parentTaskId: "parent-1", status: TaskStatus.COMPLETED,
    });
    const child2 = createTask({
      id: "child-2", title: "C2", objective: "", workspaceId: "ws-1",
      parentTaskId: "parent-1", status: TaskStatus.COMPLETED,
    });
    await taskStore.save(child1);
    await taskStore.save(child2);

    const result = await onChildTaskStatusChanged(child2, {
      taskStore, kanbanBoardStore: boardStore as any, worktreeStore: worktreeStoreStub, eventBus,
    });

    expect(result.action).toBe("all_children_completed");
    const updated = await taskStore.get("parent-1");
    expect(updated?.columnId).toBe("review");
    expect(updated?.status).toBe(TaskStatus.REVIEW_REQUIRED);
  });

  it("does not advance parent when some children are still pending", async () => {
    await taskStore.save(parentTask);

    const child1 = createTask({
      id: "child-1", title: "C1", objective: "", workspaceId: "ws-1",
      parentTaskId: "parent-1", status: TaskStatus.COMPLETED,
    });
    const child2 = createTask({
      id: "child-2", title: "C2", objective: "", workspaceId: "ws-1",
      parentTaskId: "parent-1", status: TaskStatus.IN_PROGRESS,
    });
    await taskStore.save(child1);
    await taskStore.save(child2);

    const result = await onChildTaskStatusChanged(child1, {
      taskStore, kanbanBoardStore: boardStore as any, worktreeStore: worktreeStoreStub, eventBus,
    });

    expect(result.action).toBe("none");
  });

  describe("getChildTasks", () => {
    it("returns all children of a parent", async () => {
      await taskStore.save(parentTask);
      const c1 = createTask({ id: "c1", title: "C1", objective: "", workspaceId: "ws-1", parentTaskId: "parent-1" });
      const c2 = createTask({ id: "c2", title: "C2", objective: "", workspaceId: "ws-1", parentTaskId: "parent-1" });
      const unrelated = createTask({ id: "other", title: "Other", objective: "", workspaceId: "ws-1" });
      await taskStore.save(c1);
      await taskStore.save(c2);
      await taskStore.save(unrelated);

      const children = await getChildTasks(parentTask, taskStore);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    });
  });

  describe("cancelChildren", () => {
    it("cancels incomplete children", async () => {
      await taskStore.save(parentTask);
      const c1 = createTask({ id: "c1", title: "C1", objective: "", workspaceId: "ws-1", parentTaskId: "parent-1", status: TaskStatus.PENDING });
      const c2 = createTask({ id: "c2", title: "C2", objective: "", workspaceId: "ws-1", parentTaskId: "parent-1", status: TaskStatus.COMPLETED });
      await taskStore.save(c1);
      await taskStore.save(c2);

      const count = await cancelChildren(parentTask, taskStore);
      expect(count).toBe(1);

      const updated = await taskStore.get("c1");
      expect(updated?.status).toBe(TaskStatus.CANCELLED);

      const completed = await taskStore.get("c2");
      expect(completed?.status).toBe(TaskStatus.COMPLETED);
    });
  });
});
