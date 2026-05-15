/**
 * Health Tick integration tests.
 */
import { describe, it, expect, vi } from "vitest";
import { runOverseerHealthTick } from "../health-tick";
import { createInMemoryOverseerStateStore } from "../overseer-state-store";
import { OverseerCircuitBreaker } from "../circuit-breaker";
import type { OverseerContext } from "../health-tick";

// Minimal mock of RoutaSystem with all stores the diagnostics collector needs
function createMockSystem(tasks: Array<Record<string, unknown>> = []) {
  return {
    isPersistent: false,
    workspaceStore: {
      list: vi.fn().mockResolvedValue([{ id: "default" }]),
    },
    taskStore: {
      listByWorkspace: vi.fn().mockResolvedValue(tasks),
      get: vi.fn().mockImplementation((id: string) => tasks.find((t) => t.id === id)),
      save: vi.fn().mockResolvedValue(undefined),
    },
    conversationStore: {
      getConversation: vi.fn().mockResolvedValue([]),
    },
    worktreeStore: {
      get: vi.fn().mockResolvedValue(null),
    },
    eventBus: {
      emit: vi.fn(),
    },
  };
}

describe("runOverseerHealthTick", () => {
  it("should return empty result when no issues found", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };
    const system = createMockSystem([]);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.examined).toBe(0);
    expect(result.autoFixed).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("should skip tick when circuit breaker is open", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    // Open the breaker
    await cb.recordFailure("error 1");
    await cb.recordFailure("error 2");
    await cb.recordFailure("error 3");

    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };
    const system = createMockSystem([]);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.examined).toBe(0);
  });

  it("should auto-fix stale trigger session", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };

    const staleTime = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
    const tasks = [
      {
        id: "task-stale",
        title: "Stale Task",
        workspaceId: "default",
        status: "PENDING",
        triggerSessionId: "old-session",
        updatedAt: staleTime,
        comment: "",
        comments: [] as Array<{ id: string; body: string; createdAt: string }>,
        dependencies: [] as string[],
      },
    ];
    const system = createMockSystem(tasks);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.examined).toBeGreaterThanOrEqual(1);
    expect(result.autoFixed).toBeGreaterThanOrEqual(1);
    expect(system.taskStore.save).toHaveBeenCalled();
    // The saved task should have triggerSessionId cleared
    const savedTask = system.taskStore.save.mock.calls[0][0];
    expect(savedTask.triggerSessionId).toBeUndefined();
  });

  it("should clear orphan worktree reference", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };

    const tasks = [
      {
        id: "task-orphan",
        title: "Orphan WT",
        workspaceId: "default",
        status: "PENDING",
        worktreeId: "wt-deleted",
        updatedAt: new Date(),
        comment: "",
        comments: [] as Array<{ id: string; body: string; createdAt: string }>,
        dependencies: [] as string[],
      },
    ];
    const system = createMockSystem(tasks);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.autoFixed).toBeGreaterThanOrEqual(1);
    const savedTask = system.taskStore.save.mock.calls[0][0];
    expect(savedTask.worktreeId).toBeUndefined();
  });

  it("should unblock dependency: clear lastSyncError and emit COLUMN_TRANSITION", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };

    const tasks = [
      {
        id: "task-blocked",
        title: "Blocked Task",
        workspaceId: "default",
        boardId: "board-1",
        columnId: "backlog",
        status: "IN_PROGRESS",
        dependencyStatus: "blocked",
        lastSyncError: '{"type":"dependency_blocked","message":"Blocked by unfinished dependencies: dep-1"}',
        updatedAt: new Date(),
        comment: "",
        comments: [] as Array<{ id: string; body: string; createdAt: string }>,
        dependencies: ["dep-1"],
      },
      {
        id: "dep-1",
        title: "Dep Task",
        workspaceId: "default",
        boardId: "board-1",
        columnId: "done",
        status: "COMPLETED",
        pullRequestUrl: "https://github.com/test/pr/1",
        pullRequestMergedAt: new Date(),
        updatedAt: new Date(),
        comment: "",
        comments: [] as Array<{ id: string; body: string; createdAt: string }>,
        dependencies: [] as string[],
      },
    ];
    const system = createMockSystem(tasks);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.autoFixed).toBeGreaterThanOrEqual(1);

    // Find the save call for the blocked task
    const blockedSave = system.taskStore.save.mock.calls.find(
      (c: any[]) => c[0].id === "task-blocked",
    );
    expect(blockedSave).toBeDefined();
    const savedTask = blockedSave![0];
    expect(savedTask.dependencyStatus).toBe("clear");
    expect(savedTask.lastSyncError).toBeUndefined();

    // Verify COLUMN_TRANSITION was emitted
    const transitionEmit = system.eventBus.emit.mock.calls.find(
      (c: any[]) => c[0].type === "COLUMN_TRANSITION",
    );
    expect(transitionEmit).toBeDefined();
    expect(transitionEmit![0].data.cardId).toBe("task-blocked");
    expect(transitionEmit![0].data.source).toEqual({ type: "dependency_unblock" });
  });

  it("should detect dependency block via lastSyncError even when dependencyStatus is clear", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const ctx: OverseerContext = { stateStore: store, circuitBreaker: cb };

    // Simulate the inconsistent state: overseer previously set dependencyStatus="clear"
    // but didn't clear lastSyncError (the old buggy behavior)
    const tasks = [
      {
        id: "task-stuck",
        title: "Stuck Task",
        workspaceId: "default",
        boardId: "board-1",
        columnId: "backlog",
        status: "IN_PROGRESS",
        dependencyStatus: "clear",
        lastSyncError: "Blocked by unfinished dependencies: dep-done",
        updatedAt: new Date(),
        comment: "",
        comments: [] as Array<{ id: string; body: string; createdAt: string }>,
        dependencies: ["dep-done"],
      },
      {
        id: "dep-done",
        title: "Done Dep",
        workspaceId: "default",
        boardId: "board-1",
        columnId: "done",
        status: "COMPLETED",
        pullRequestUrl: "https://github.com/test/pr/2",
        pullRequestMergedAt: new Date(),
        updatedAt: new Date(),
        comment: "",
        comments: [] as Array<{ id: string; body: string; createdAt: string }>,
        dependencies: [] as string[],
      },
    ];
    const system = createMockSystem(tasks);

    const result = await runOverseerHealthTick(system as any, ctx);
    expect(result.autoFixed).toBeGreaterThanOrEqual(1);

    const stuckSave = system.taskStore.save.mock.calls.find(
      (c: any[]) => c[0].id === "task-stuck",
    );
    expect(stuckSave).toBeDefined();
    expect(stuckSave![0].lastSyncError).toBeUndefined();
    expect(stuckSave![0].dependencyStatus).toBe("clear");
  });
});
