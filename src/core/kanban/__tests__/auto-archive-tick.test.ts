// @vitest-environment node
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

import { createTask, TaskStatus, type Task, type TaskLaneSession } from "@/core/models/task";
import {
  type KanbanBoard,
  type KanbanColumn,
  DEFAULT_KANBAN_COLUMNS,
} from "@/core/models/kanban";
import { createWorkspace } from "@/core/models/workspace";
import { EventBus } from "@/core/events/event-bus";
import { InMemoryKanbanBoardStore } from "@/core/store/kanban-board-store";
import { InMemoryTaskStore } from "@/core/store/task-store";
import { InMemoryWorkspaceStore } from "@/core/db/pg-workspace-store";
import {
  runAutoArchiveTick,
  resolveAutoArchiveDays,
  isCardOldEnough,
  hasPendingAutomation,
  hasOpenPR,
  findArchivedColumn,
  findDoneColumn,
  DEFAULT_AUTO_ARCHIVE_DAYS,
} from "../auto-archive-tick";

function makeBoard(workspaceId: string, columns?: KanbanColumn[]): KanbanBoard {
  const now = new Date();
  return {
    id: "board-1",
    workspaceId,
    name: "Test Board",
    isDefault: true,
    columns: columns ?? DEFAULT_KANBAN_COLUMNS,
    createdAt: now,
    updatedAt: now,
  };
}

type TaskOverrides = Partial<Parameters<typeof createTask>[0]> & {
  id: string;
  laneSessions?: TaskLaneSession[];
  pullRequestMergedAt?: Date;
};

function makeTask(overrides: TaskOverrides): Task {
  const { laneSessions, pullRequestMergedAt, ...createParams } = overrides;
  const task = createTask({
    title: "Test Task",
    objective: "Test objective",
    workspaceId: "ws-1",
    ...createParams,
  });
  if (laneSessions) {
    task.laneSessions = laneSessions;
  }
  if (pullRequestMergedAt) {
    task.pullRequestMergedAt = pullRequestMergedAt;
  }
  return task;
}

describe("resolveAutoArchiveDays", () => {
  it("returns default when metadata is empty", () => {
    expect(resolveAutoArchiveDays()).toBe(DEFAULT_AUTO_ARCHIVE_DAYS);
    expect(resolveAutoArchiveDays({})).toBe(DEFAULT_AUTO_ARCHIVE_DAYS);
  });

  it("returns configured value from metadata", () => {
    expect(resolveAutoArchiveDays({ autoArchiveDays: "7" })).toBe(7);
    expect(resolveAutoArchiveDays({ autoArchiveDays: "60" })).toBe(60);
  });

  it("falls back to default for invalid values", () => {
    expect(resolveAutoArchiveDays({ autoArchiveDays: "abc" })).toBe(DEFAULT_AUTO_ARCHIVE_DAYS);
    expect(resolveAutoArchiveDays({ autoArchiveDays: "-5" })).toBe(DEFAULT_AUTO_ARCHIVE_DAYS);
    expect(resolveAutoArchiveDays({ autoArchiveDays: "0" })).toBe(DEFAULT_AUTO_ARCHIVE_DAYS);
  });
});

describe("isCardOldEnough", () => {
  it("returns true when card has been in done long enough", () => {
    const now = new Date();
    const task = makeTask({
      id: "t-1",
      columnId: "done",
      laneSessions: [{
        sessionId: "s-1",
        columnId: "done",
        status: "completed",
        startedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    });
    expect(isCardOldEnough(task, 30, now)).toBe(true);
  });

  it("returns false when card has not been in done long enough", () => {
    const now = new Date();
    const task = makeTask({
      id: "t-1",
      columnId: "done",
      laneSessions: [{
        sessionId: "s-1",
        columnId: "done",
        status: "completed",
        startedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    });
    expect(isCardOldEnough(task, 30, now)).toBe(false);
  });

  it("falls back to updatedAt when no lane session exists", () => {
    const now = new Date();
    const task = makeTask({ id: "t-1", columnId: "done" });
    task.updatedAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(isCardOldEnough(task, 30, now)).toBe(true);
  });
});

describe("hasPendingAutomation", () => {
  it("returns true when a running session exists in current column", () => {
    const task = makeTask({ id: "t-1", columnId: "done" });
    task.laneSessions = [{
      sessionId: "s-1",
      columnId: "done",
      status: "running",
      startedAt: new Date().toISOString(),
    }];
    expect(hasPendingAutomation(task)).toBe(true);
  });

  it("returns false when running session is in a different column", () => {
    const task = makeTask({ id: "t-1", columnId: "done" });
    task.laneSessions = [{
      sessionId: "s-1",
      columnId: "dev",
      status: "running",
      startedAt: new Date().toISOString(),
    }];
    expect(hasPendingAutomation(task)).toBe(false);
  });

  it("returns false when all sessions are completed", () => {
    const task = makeTask({ id: "t-1", columnId: "done" });
    task.laneSessions = [{
      sessionId: "s-1",
      columnId: "done",
      status: "completed",
      startedAt: new Date().toISOString(),
    }];
    expect(hasPendingAutomation(task)).toBe(false);
  });

  it("returns false when no sessions exist", () => {
    const task = makeTask({ id: "t-1" });
    expect(hasPendingAutomation(task)).toBe(false);
  });
});

describe("hasOpenPR", () => {
  it("returns true when pullRequestUrl is set but not merged", () => {
    const task = makeTask({ id: "t-1" });
    task.pullRequestUrl = "https://github.com/org/repo/pull/1";
    expect(hasOpenPR(task)).toBe(true);
  });

  it("returns false when pullRequestUrl is not set", () => {
    const task = makeTask({ id: "t-1" });
    expect(hasOpenPR(task)).toBe(false);
  });

  it("returns false when PR has been merged", () => {
    const task = makeTask({ id: "t-1" });
    task.pullRequestUrl = "https://github.com/org/repo/pull/1";
    task.pullRequestMergedAt = new Date();
    expect(hasOpenPR(task)).toBe(false);
  });
});

describe("findArchivedColumn / findDoneColumn", () => {
  it("finds the done column by stage", () => {
    const board = makeBoard("ws-1");
    const done = findDoneColumn(board);
    expect(done).toBeDefined();
    expect(done!.stage).toBe("done");
  });

  it("finds the archived column by stage", () => {
    const board = makeBoard("ws-1");
    const archived = findArchivedColumn(board);
    expect(archived).toBeDefined();
    expect(archived!.stage).toBe("archived");
  });

  it("returns undefined when archived column is missing", () => {
    const board = makeBoard("ws-1", DEFAULT_KANBAN_COLUMNS.filter((c) => c.stage !== "archived"));
    expect(findArchivedColumn(board)).toBeUndefined();
  });
});

describe("runAutoArchiveTick", () => {
  const originalEnv = process.env.ROUTA_AUTO_ARCHIVE_ENABLED;
  beforeAll(() => { process.env.ROUTA_AUTO_ARCHIVE_ENABLED = "true"; });
  afterAll(() => {
    if (originalEnv === undefined) delete process.env.ROUTA_AUTO_ARCHIVE_ENABLED;
    else process.env.ROUTA_AUTO_ARCHIVE_ENABLED = originalEnv;
  });

  async function setupSystem(options?: {
    archiveDays?: string;
    tasks?: Parameters<typeof makeTask>[0][];
  }) {
    const workspaceStore = new InMemoryWorkspaceStore();
    const kanbanBoardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const eventBus = new EventBus();

    const ws = createWorkspace({
      id: "ws-1",
      title: "Test Workspace",
      metadata: options?.archiveDays ? { autoArchiveDays: options.archiveDays } : {},
    });
    await workspaceStore.save(ws);

    const board = makeBoard("ws-1");
    await kanbanBoardStore.save(board);

    const tasks: ReturnType<typeof makeTask>[] = [];
    for (const override of options?.tasks ?? []) {
      const task = makeTask(override as any);
      tasks.push(task);
      await taskStore.save(task);
    }

    return {
      taskStore,
      kanbanBoardStore,
      workspaceStore,
      eventBus,
      tasks,
      board,
    };
  }

  it("returns empty summary when no done tasks exist", async () => {
    const system = await setupSystem();
    const result = await runAutoArchiveTick(system);
    expect(result).toEqual({ archived: 0, skipped: [], examined: 0 });
  });

  it("archives a done card that has been idle for more than configured days", async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const system = await setupSystem({
      archiveDays: "30",
      tasks: [{
        id: "t-old",
        columnId: "done",
        boardId: "board-1",
        laneSessions: [{
          sessionId: "s-1",
          columnId: "done",
          status: "completed",
          startedAt: oldDate,
        }],
      }],
    });

    const result = await runAutoArchiveTick(system);
    expect(result.archived).toBe(1);
    expect(result.examined).toBe(1);

    const archivedTask = await system.taskStore.get("t-old");
    expect(archivedTask!.columnId).toBe("archived");
    expect(archivedTask!.status).toBe(TaskStatus.ARCHIVED);
  });

  it("skips a done card that has not been idle long enough", async () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const system = await setupSystem({
      archiveDays: "30",
      tasks: [{
        id: "t-recent",
        columnId: "done",
        boardId: "board-1",
        laneSessions: [{
          sessionId: "s-1",
          columnId: "done",
          status: "completed",
          startedAt: recentDate,
        }],
      }],
    });

    const result = await runAutoArchiveTick(system);
    expect(result.archived).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("停留时间不足");
  });

  it("skips a card with pending automation", async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const system = await setupSystem({
      archiveDays: "30",
      tasks: [{
        id: "t-pending",
        columnId: "done",
        boardId: "board-1",
        laneSessions: [{
          sessionId: "s-1",
          columnId: "done",
          status: "running",
          startedAt: oldDate,
        }],
      }],
    });

    const result = await runAutoArchiveTick(system);
    expect(result.archived).toBe(0);
    expect(result.skipped[0].reason).toContain("未完成的自动化步骤");
  });

  it("skips a card with an open PR", async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    const system = await setupSystem({
      archiveDays: "30",
      tasks: [{
        id: "t-pr",
        columnId: "done",
        boardId: "board-1",
        pullRequestUrl: "https://github.com/org/repo/pull/1",
        laneSessions: [{
          sessionId: "s-1",
          columnId: "done",
          status: "completed",
          startedAt: oldDate,
        }],
      }],
    });

    const result = await runAutoArchiveTick(system);
    expect(result.archived).toBe(0);
    expect(result.skipped[0].reason).toContain("未合并的 PR");
  });

  it("does not skip a card with a merged PR", async () => {
    const now = new Date();
    const mergedAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);

    const system = await setupSystem({
      archiveDays: "30",
      tasks: [{
        id: "t-merged-pr",
        columnId: "done",
        boardId: "board-1",
        pullRequestUrl: "https://github.com/org/repo/pull/1",
        pullRequestMergedAt: mergedAt,
        laneSessions: [{
          sessionId: "s-1",
          columnId: "done",
          status: "completed",
          startedAt: mergedAt.toISOString(),
        }],
      }],
    });

    const result = await runAutoArchiveTick(system);
    expect(result.archived).toBe(1);
  });

  it("skips cards not in the done column", async () => {
    const system = await setupSystem({
      tasks: [{
        id: "t-dev",
        columnId: "dev",
        boardId: "board-1",
      }],
    });

    const result = await runAutoArchiveTick(system);
    expect(result.examined).toBe(0);
    expect(result.archived).toBe(0);
  });

  it("uses default archive days when workspace metadata has no config", async () => {
    const now = new Date();
    // Just past DEFAULT_AUTO_ARCHIVE_DAYS days old — must exceed both thresholds
    const boundaryDate = new Date(
      now.getTime() - (DEFAULT_AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000 + 1),
    ).toISOString();

    const system = await setupSystem({
      tasks: [{
        id: "t-boundary",
        columnId: "done",
        boardId: "board-1",
        laneSessions: [{
          sessionId: "s-1",
          columnId: "done",
          status: "completed",
          startedAt: boundaryDate,
        }],
      }],
    });

    const result = await runAutoArchiveTick(system);
    expect(result.archived).toBe(1);
  });

  it("emits a column transition event when archiving", async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    const system = await setupSystem({
      archiveDays: "30",
      tasks: [{
        id: "t-event",
        columnId: "done",
        boardId: "board-1",
        laneSessions: [{
          sessionId: "s-1",
          columnId: "done",
          status: "completed",
          startedAt: oldDate,
        }],
      }],
    });

    const emitted: any[] = [];
    system.eventBus.on("test-listener", (event) => {
      emitted.push(event);
    });

    await runAutoArchiveTick(system);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe("COLUMN_TRANSITION");
    expect(emitted[0].data.cardId).toBe("t-event");
    expect(emitted[0].data.fromColumnId).toBe("done");
    expect(emitted[0].data.toColumnId).toBe("archived");
  });
});
