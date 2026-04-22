import { useCallback, useState } from "react";

const DEFAULT_PAGE_SIZE = 10;

/** Columns that use virtual scrolling (batch loading). */
const VIRTUAL_COLUMNS = new Set(["done", "blocked", "archived"]);

/**
 * Manages per-column virtual scroll state.
 * For done/blocked/archived columns, only the first `pageSize` cards are shown initially.
 * Each "Load more" click appends another `pageSize` cards.
 */
export function useColumnVirtualScroll(pageSize = DEFAULT_PAGE_SIZE) {
  // Map<columnId, number of cards to show>
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});

  const getVisibleCount = useCallback(
    (columnId: string, total: number, stage?: string): number => {
      if (!stage || !VIRTUAL_COLUMNS.has(stage)) return total;
      const existing = visibleCounts[columnId];
      if (existing !== undefined) return existing;
      // Default: show first page
      return Math.min(pageSize, total);
    },
    [visibleCounts, pageSize],
  );

  const loadMore = useCallback(
    (columnId: string, currentCount: number, total: number) => {
      const next = Math.min(currentCount + pageSize, total);
      setVisibleCounts((prev) => ({ ...prev, [columnId]: next }));
    },
    [pageSize],
  );

  return { getVisibleCount, loadMore };
}
