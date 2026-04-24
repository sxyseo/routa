import { describe, it, expect } from "vitest";
import { detectStuckPatterns } from "../done-lane-recovery-tick";
import type { Task } from "../../models/task";
import type { KanbanBoard } from "../../models/kanban";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    id: overrides.id,
    title: overrides.title ?? "Test task",
    status: overrides.status ?? ("COMPLETED" as Task["status"]),
    columnId: overrides.columnId ?? "done",
    workspaceId: overrides.workspaceId ?? "ws-1",
    boardId: overrides.boardId ?? "board-1",
    pullRequestUrl: overrides.pullRequestUrl,
    pullRequestMergedAt: overrides.pullRequestMergedAt,
    lastSyncError: overrides.lastSyncError,
    triggerSessionId: overrides.triggerSessionId,
    worktreeId: overrides.worktreeId,
    updatedAt: overrides.updatedAt ?? new Date(),
    createdAt: overrides.createdAt ?? new Date(),
    version: 1,
    comment: overrides.comment,
    comments: overrides.comments ?? [],
    sessionIds: overrides.sessionIds ?? [],
    laneSessions: overrides.laneSessions ?? [],
  } as Task;
}

function makeBoard(): KanbanBoard {
  return {
    id: "board-1",
    name: "Test Board",
    workspaceId: "ws-1",
    columns: [
      { id: "todo", name: "Todo", position: 0, stage: "backlog" },
      { id: "dev", name: "Dev", position: 1, stage: "dev" },
      { id: "done", name: "Done", position: 2, stage: "done" },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as KanbanBoard;
}

describe("detectStuckPatterns", () => {
  const board = makeBoard();

  it("returns empty for non-done column tasks", () => {
    const task = makeTask({ id: "t1", columnId: "dev" });
    expect(detectStuckPatterns(task, board)).toEqual([]);
  });

  it("detects webhook_missed for PR not merged but old enough", () => {
    const task = makeTask({
      id: "t2",
      pullRequestUrl: "https://github.com/o/r/pull/1",
      pullRequestMergedAt: undefined,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
    });
    const patterns = detectStuckPatterns(task, board);
    expect(patterns.some((p) => p.pattern === "webhook_missed")).toBe(true);
  });

  it("does not detect webhook_missed for recently updated tasks", () => {
    const task = makeTask({
      id: "t3",
      pullRequestUrl: "https://github.com/o/r/pull/1",
      pullRequestMergedAt: undefined,
      updatedAt: new Date(), // just now
    });
    const patterns = detectStuckPatterns(task, board);
    expect(patterns.some((p) => p.pattern === "webhook_missed")).toBe(false);
  });

  it("detects cb_exhausted_pr_unmerged for CB-exhausted tasks with unmerged PR", () => {
    const task = makeTask({
      id: "t4",
      pullRequestUrl: "https://github.com/o/r/pull/2",
      pullRequestMergedAt: undefined,
      lastSyncError: "[circuit-breaker:reset=5] pending retry.",
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const patterns = detectStuckPatterns(task, board);
    expect(patterns.some((p) => p.pattern === "cb_exhausted_pr_unmerged")).toBe(true);
  });

  it("detects orphan_in_progress for IN_PROGRESS with no session", () => {
    const task = makeTask({
      id: "t5",
      status: "IN_PROGRESS" as Task["status"],
      triggerSessionId: undefined,
      updatedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
    });
    const patterns = detectStuckPatterns(task, board);
    expect(patterns.some((p) => p.pattern === "orphan_in_progress")).toBe(true);
  });

  it("does not detect orphan_in_progress for IN_PROGRESS with active session", () => {
    const task = makeTask({
      id: "t6",
      status: "IN_PROGRESS" as Task["status"],
      triggerSessionId: "active-session-1",
      updatedAt: new Date(Date.now() - 15 * 60 * 1000),
    });
    const patterns = detectStuckPatterns(task, board);
    expect(patterns.some((p) => p.pattern === "orphan_in_progress")).toBe(false);
  });

  it("detects no_pr_completed for COMPLETED tasks without PR", () => {
    const task = makeTask({
      id: "t7",
      pullRequestUrl: undefined,
      worktreeId: undefined,
      updatedAt: new Date(Date.now() - 15 * 60 * 1000),
    });
    const patterns = detectStuckPatterns(task, board);
    expect(patterns.some((p) => p.pattern === "no_pr_completed")).toBe(true);
  });

  it("returns empty for healthy done tasks", () => {
    const task = makeTask({
      id: "t8",
      pullRequestUrl: "https://github.com/o/r/pull/3",
      pullRequestMergedAt: new Date(),
      updatedAt: new Date(),
    });
    expect(detectStuckPatterns(task, board)).toEqual([]);
  });
});
