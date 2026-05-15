"use client";

import { useEffect, useState, useCallback } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { TaskInfo, WorktreeInfo } from "../../types";

interface UseKanbanWorktreeOptions {
  localTasks: TaskInfo[];
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  setLocalTasks: React.Dispatch<React.SetStateAction<TaskInfo[]>>;
}

export function useKanbanWorktree({ localTasks, patchTask, setLocalTasks }: UseKanbanWorktreeOptions) {
  const [worktreeCache, setWorktreeCache] = useState<Record<string, WorktreeInfo>>({});
  const [missingWorktreeIds, setMissingWorktreeIds] = useState<Record<string, true>>({});

  useEffect(() => {
    const worktreeIds = [...new Set(localTasks.map((t) => t.worktreeId).filter((id): id is string => Boolean(id)))];
    if (worktreeIds.length === 0) return;

    const missing = worktreeIds.filter((id) => !worktreeCache[id] && !missingWorktreeIds[id]);
    if (missing.length === 0) return;

    let cancelled = false;

    (async () => {
      const results: Record<string, WorktreeInfo> = {};
      const staleIds = new Set<string>();
      await Promise.allSettled(
        missing.map(async (id) => {
          try {
            const res = await desktopAwareFetch(`/api/worktrees/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (res.ok) {
              const data = await res.json();
              if (data.worktree) results[id] = data.worktree as WorktreeInfo;
              return;
            }
            if (res.status === 404) {
              staleIds.add(id);
            }
          } catch { /* ignore */ }
        })
      );

      if (cancelled) return;

      if (Object.keys(results).length > 0) {
        setWorktreeCache((prev) => ({ ...prev, ...results }));
      }
      if (staleIds.size > 0) {
        const staleIdList = [...staleIds];
        setMissingWorktreeIds((prev) => ({
          ...prev,
          ...Object.fromEntries(staleIdList.map((id) => [id, true] as const)),
        }));
        setWorktreeCache((prev) => {
          const next = { ...prev };
          for (const id of staleIdList) delete next[id];
          return next;
        });
        // Clean up localTasks — remove stale worktreeId references
        setLocalTasks((current) => current.map((task) => (
          task.worktreeId && staleIds.has(task.worktreeId)
            ? { ...task, worktreeId: undefined }
            : task
        )));
        // Patch backend to clear stale worktree references
        const linkedTasks = localTasks
          .filter((task) => task.worktreeId && staleIds.has(task.worktreeId))
          .map((task) => task.id);
        await Promise.allSettled(linkedTasks.map(async (taskId) => {
          try {
            await patchTask(taskId, { worktreeId: null });
          } catch {
            // Ignore patch failures; the missing worktree cache prevents repeated 404 noise.
          }
        }));
      }
    })();

    return () => { cancelled = true; };
  }, [localTasks, missingWorktreeIds, patchTask, setLocalTasks, worktreeCache]);

  const removeFromCache = useCallback((ids: string[]) => {
    setWorktreeCache((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
  }, []);

  return {
    worktreeCache,
    missingWorktreeIds,
    removeFromCache,
  };
}
