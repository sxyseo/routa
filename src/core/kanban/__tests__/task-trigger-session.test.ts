import { describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus } from "../../models/task";
import { InMemoryTaskStore } from "../../store/task-store";
import { isTriggerSessionStale, clearStaleTriggerSession } from "../task-trigger-session";
import type { RoutaSessionActivity } from "../../acp/http-session-store";

function mockSessionStore(
  activities: Record<string, Partial<RoutaSessionActivity> | undefined>,
) {
  return {
    getSessionActivity: vi.fn((sessionId: string) => {
      const entry = activities[sessionId];
      if (!entry) return undefined;
      return {
        sessionId,
        createdAt: entry.createdAt ?? new Date().toISOString(),
        lastActivityAt: entry.lastActivityAt ?? new Date().toISOString(),
        lastMeaningfulActivityAt: entry.lastMeaningfulActivityAt ?? new Date().toISOString(),
        lastEventType: entry.lastEventType,
        terminalState: entry.terminalState,
        terminalReason: entry.terminalReason,
        terminalAt: entry.terminalAt,
      } as RoutaSessionActivity;
    }),
  } as unknown as ReturnType<typeof import("../../acp/http-session-store").getHttpSessionStore>;
}

describe("isTriggerSessionStale", () => {
  it("returns undefined when triggerSessionId is undefined", () => {
    const store = mockSessionStore({});
    expect(isTriggerSessionStale(undefined, store)).toBeUndefined();
  });

  it("returns undefined when triggerSessionId is empty string", () => {
    const store = mockSessionStore({});
    expect(isTriggerSessionStale("", store)).toBeUndefined();
  });

  it("returns the sessionId when session has no activity record", () => {
    const store = mockSessionStore({});
    expect(isTriggerSessionStale("session-1", store)).toBe("session-1");
  });

  it("returns the sessionId when session has terminalState", () => {
    const store = mockSessionStore({
      "session-1": { terminalState: "completed" },
    });
    expect(isTriggerSessionStale("session-1", store)).toBe("session-1");
  });

  it("returns the sessionId when session has failed terminalState", () => {
    const store = mockSessionStore({
      "session-1": { terminalState: "failed" },
    });
    expect(isTriggerSessionStale("session-1", store)).toBe("session-1");
  });

  it("returns the sessionId when session has timed_out terminalState", () => {
    const store = mockSessionStore({
      "session-1": { terminalState: "timed_out" },
    });
    expect(isTriggerSessionStale("session-1", store)).toBe("session-1");
  });

  it("returns undefined when session is still active", () => {
    const store = mockSessionStore({
      "session-1": { terminalState: undefined },
    });
    expect(isTriggerSessionStale("session-1", store)).toBeUndefined();
  });
});

describe("clearStaleTriggerSession", () => {
  it("returns false and does not modify task when session is still active", async () => {
    const store = mockSessionStore({
      "session-active": { terminalState: undefined },
    });
    const taskStore = new InMemoryTaskStore();
    const task = createTask({
      id: "task-1",
      title: "Test",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-active",
    });
    await taskStore.save(task);

    const result = await clearStaleTriggerSession(task, store, taskStore);
    expect(result).toBe(false);

    const saved = await taskStore.get("task-1");
    expect(saved?.triggerSessionId).toBe("session-active");
  });

  it("clears triggerSessionId when session is stale and has no lane sessions", async () => {
    const store = mockSessionStore({
      "session-stale": { terminalState: "completed" },
    });
    const taskStore = new InMemoryTaskStore();
    const task = createTask({
      id: "task-2",
      title: "Test",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-stale",
    });
    await taskStore.save(task);

    const result = await clearStaleTriggerSession(task, store, taskStore);
    expect(result).toBe(true);

    const saved = await taskStore.get("task-2");
    expect(saved?.triggerSessionId).toBeUndefined();
  });

  it("clears triggerSessionId when session has no activity record at all", async () => {
    const store = mockSessionStore({});
    const taskStore = new InMemoryTaskStore();
    const task = createTask({
      id: "task-3",
      title: "Test",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-evicted",
    });
    await taskStore.save(task);

    const result = await clearStaleTriggerSession(task, store, taskStore);
    expect(result).toBe(true);

    const saved = await taskStore.get("task-3");
    expect(saved?.triggerSessionId).toBeUndefined();
  });

  it("marks running lane session as timed_out when session goes stale without PR", async () => {
    const store = mockSessionStore({
      "session-stale": { terminalState: "failed" },
    });
    const taskStore = new InMemoryTaskStore();
    const task = createTask({
      id: "task-4",
      title: "Test",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-stale",
    });
    task.laneSessions = [
      {
        sessionId: "session-stale",
        columnId: "dev",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ];
    await taskStore.save(task);

    const result = await clearStaleTriggerSession(task, store, taskStore);
    expect(result).toBe(true);

    const saved = await taskStore.get("task-4");
    expect(saved?.triggerSessionId).toBeUndefined();
    expect(saved?.laneSessions?.[0]?.status).toBe("timed_out");
  });

  it("marks running lane session as completed when task has a PR URL", async () => {
    const store = mockSessionStore({
      "session-stale": { terminalState: "completed" },
    });
    const taskStore = new InMemoryTaskStore();
    const task = createTask({
      id: "task-5",
      title: "Test",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-stale",
    });
    task.pullRequestUrl = "https://github.com/org/repo/pull/42";
    task.laneSessions = [
      {
        sessionId: "session-stale",
        columnId: "review",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ];
    await taskStore.save(task);

    const result = await clearStaleTriggerSession(task, store, taskStore);
    expect(result).toBe(true);

    const saved = await taskStore.get("task-5");
    expect(saved?.triggerSessionId).toBeUndefined();
    expect(saved?.laneSessions?.[0]?.status).toBe("completed");
  });

  it("does not touch lane sessions that are not running", async () => {
    const store = mockSessionStore({
      "session-stale": { terminalState: "timed_out" },
    });
    const taskStore = new InMemoryTaskStore();
    const task = createTask({
      id: "task-6",
      title: "Test",
      objective: "Test",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-stale",
    });
    task.laneSessions = [
      {
        sessionId: "session-stale",
        columnId: "dev",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
    ];
    await taskStore.save(task);

    const result = await clearStaleTriggerSession(task, store, taskStore);
    expect(result).toBe(true);

    const saved = await taskStore.get("task-6");
    expect(saved?.triggerSessionId).toBeUndefined();
    // Status stays "completed", not overwritten
    expect(saved?.laneSessions?.[0]?.status).toBe("completed");
  });
});
