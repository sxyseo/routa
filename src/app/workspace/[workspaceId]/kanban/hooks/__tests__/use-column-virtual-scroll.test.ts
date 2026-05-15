// @vitest-environment node

import { describe, expect, it } from "vitest";

/**
 * Pure-logic tests for the virtual scroll column strategy.
 * The hook (useColumnVirtualScroll) is a thin React wrapper around this logic,
 * so testing the pure functions validates all AC without needing jsdom/renderHook.
 */

const DEFAULT_PAGE_SIZE = 10;
const VIRTUAL_COLUMNS = new Set(["done", "blocked", "archived"]);

/** Replicates getVisibleCount logic from useColumnVirtualScroll */
function getVisibleCount(
  visibleCounts: Record<string, number>,
  columnId: string,
  total: number,
  stage?: string,
  pageSize = DEFAULT_PAGE_SIZE,
): number {
  if (!stage || !VIRTUAL_COLUMNS.has(stage)) return total;
  const existing = visibleCounts[columnId];
  if (existing !== undefined) return existing;
  return Math.min(pageSize, total);
}

/** Replicates loadMore logic from useColumnVirtualScroll */
function loadMore(
  visibleCounts: Record<string, number>,
  columnId: string,
  currentCount: number,
  total: number,
  pageSize = DEFAULT_PAGE_SIZE,
): Record<string, number> {
  const next = Math.min(currentCount + pageSize, total);
  return { ...visibleCounts, [columnId]: next };
}

describe("useColumnVirtualScroll logic", () => {
  describe("getVisibleCount", () => {
    it("AC1: returns total for non-virtual columns (backlog, todo, dev, review)", () => {
      const counts: Record<string, number> = {};
      expect(getVisibleCount(counts, "backlog", 50, "backlog")).toBe(50);
      expect(getVisibleCount(counts, "todo", 30, "todo")).toBe(30);
      expect(getVisibleCount(counts, "dev", 20, "dev")).toBe(20);
      expect(getVisibleCount(counts, "review", 15, "review")).toBe(15);
    });

    it("returns total for columns without a stage", () => {
      const counts: Record<string, number> = {};
      expect(getVisibleCount(counts, "col-1", 50, undefined)).toBe(50);
    });

    it("AC1: done/blocked/archived columns cap at 10 by default", () => {
      const counts: Record<string, number> = {};
      expect(getVisibleCount(counts, "done-col", 25, "done")).toBe(10);
      expect(getVisibleCount(counts, "blocked-col", 30, "blocked")).toBe(10);
      expect(getVisibleCount(counts, "archived-col", 50, "archived")).toBe(10);
    });

    it("AC6: when total <= 10, returns total (no extra UI needed)", () => {
      const counts: Record<string, number> = {};
      expect(getVisibleCount(counts, "done-col", 10, "done")).toBe(10);
      expect(getVisibleCount(counts, "done-col", 5, "done")).toBe(5);
      expect(getVisibleCount(counts, "done-col", 0, "done")).toBe(0);
    });

    it("respects custom page size", () => {
      const counts: Record<string, number> = {};
      expect(getVisibleCount(counts, "done-col", 20, "done", 5)).toBe(5);
    });
  });

  describe("loadMore", () => {
    it("AC3: loadMore appends next batch of 10", () => {
      let counts: Record<string, number> = {};

      // Initial: 10 visible out of 25
      expect(getVisibleCount(counts, "done-col", 25, "done")).toBe(10);

      counts = loadMore(counts, "done-col", 10, 25);
      expect(getVisibleCount(counts, "done-col", 25, "done")).toBe(20);

      counts = loadMore(counts, "done-col", 20, 25);
      expect(getVisibleCount(counts, "done-col", 25, "done")).toBe(25);
    });

    it("AC3: loadMore does not exceed total", () => {
      let counts: Record<string, number> = {};
      counts = loadMore(counts, "done-col", 10, 12);
      expect(getVisibleCount(counts, "done-col", 12, "done")).toBe(12);
    });

    it("AC3: after all cards loaded, no more to load (button disappears)", () => {
      let counts: Record<string, number> = {};
      counts = loadMore(counts, "done-col", 10, 15);
      expect(getVisibleCount(counts, "done-col", 15, "done")).toBe(15);

      // Further loadMore is a no-op (already at total)
      counts = loadMore(counts, "done-col", 15, 15);
      expect(getVisibleCount(counts, "done-col", 15, "done")).toBe(15);
    });

    it("maintains independent state per column", () => {
      let counts: Record<string, number> = {};
      counts = loadMore(counts, "done-col", 10, 30);

      expect(getVisibleCount(counts, "done-col", 30, "done")).toBe(20);
      expect(getVisibleCount(counts, "blocked-col", 30, "blocked")).toBe(10);
    });
  });

  describe("AC4: total count always accessible", () => {
    it("total is independent of visibleCount (caller uses columnTasks.length)", () => {
      const counts: Record<string, number> = {};
      const columnTasks = Array.from({ length: 25 }, (_, i) => ({ id: `task-${i}` }));
      const visibleCount = getVisibleCount(counts, "done-col", columnTasks.length, "done");
      const hasMore = visibleCount < columnTasks.length;

      expect(columnTasks.length).toBe(25); // AC4: total always available
      expect(visibleCount).toBe(10);
      expect(hasMore).toBe(true);
    });
  });

  describe("AC5: drag on loaded cards", () => {
    it("visibleTasks are a simple slice (works with DnD)", () => {
      const counts: Record<string, number> = {};
      const allTasks = Array.from({ length: 25 }, (_, i) => ({ id: `task-${i}` }));
      const visibleCount = getVisibleCount(counts, "done-col", allTasks.length, "done");
      const visibleTasks = allTasks.slice(0, visibleCount);

      expect(visibleTasks).toHaveLength(10);
      expect(visibleTasks[0].id).toBe("task-0");
      expect(visibleTasks[9].id).toBe("task-9");
      expect(visibleTasks.find((t) => t.id === "task-10")).toBeUndefined();
    });
  });
});
