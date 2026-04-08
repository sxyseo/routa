"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { KanbanEnhancedFileChangesPanel } from "./kanban-enhanced-file-changes-panel";
import { CommitRow, TaskCommitDiffPreview } from "../kanban-diff-preview";
import type {
  KanbanCommitChangeItem,
  KanbanCommitDiffPreview,
  KanbanTaskChanges,
} from "../kanban-file-changes-types";

interface KanbanTaskChangesTabProps {
  taskId: string;
  workspaceId: string;
  refreshSignal?: number;
  onRefresh: () => void;
}

export function KanbanTaskChangesTab({
  taskId,
  workspaceId,
  refreshSignal,
  onRefresh,
}: KanbanTaskChangesTabProps) {
  const { t } = useTranslation();
  const [taskChanges, setTaskChanges] = useState<KanbanTaskChanges | null>(null);
  const [taskChangesLoading, setTaskChangesLoading] = useState(false);
  const [activeCommitSha, setActiveCommitSha] = useState<string | null>(null);
  const [commitDiffCache, setCommitDiffCache] = useState<Record<string, KanbanCommitDiffPreview>>({});
  const [commitDiffErrors, setCommitDiffErrors] = useState<Record<string, string>>({});
  const [loadingCommitSha, setLoadingCommitSha] = useState<string | null>(null);

  useEffect(() => {
    setTaskChanges(null);
    setTaskChangesLoading(false);
    setActiveCommitSha(null);
    setCommitDiffCache({});
    setCommitDiffErrors({});
    setLoadingCommitSha(null);
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    setTaskChangesLoading(true);

    void (async () => {
      try {
        const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(taskId)}/changes`, {
          cache: "no-store",
        });
        const payload = await response.json() as { changes?: KanbanTaskChanges; error?: string };
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(payload.error ?? t.common.unavailable);
        }
        setTaskChanges(payload.changes ?? null);
      } catch (error) {
        if (!cancelled) {
          setTaskChanges({
            codebaseId: "",
            repoPath: "",
            label: t.kanbanDetail.repo,
            branch: "unknown",
            status: { clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 },
            files: [],
            source: "repo",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!cancelled) {
          setTaskChangesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId, refreshSignal, t.common.unavailable, t.kanbanDetail.repo]);

  const commits = useMemo(() => taskChanges?.commits ?? [], [taskChanges?.commits]);
  const hasCommittedChanges = commits.length > 0;
  const hasLocalChanges = (taskChanges?.files.length ?? 0) > 0;
  const scopePath = taskChanges?.worktreePath ?? taskChanges?.repoPath ?? "";
  const sourceLabel = taskChanges?.source === "worktree" ? t.kanbanDetail.worktreeSource : t.kanbanDetail.repoSource;
  const selectedCommit = useMemo(
    () => commits.find((commit) => commit.sha === activeCommitSha) ?? null,
    [commits, activeCommitSha]
  );
  const selectedCommitDiff = selectedCommit ? commitDiffCache[selectedCommit.sha] : undefined;
  const selectedCommitError = selectedCommit ? commitDiffErrors[selectedCommit.sha] : undefined;
  const selectedCommitLoading = selectedCommit ? loadingCommitSha === selectedCommit.sha : false;

  useEffect(() => {
    if (!commits.some((commit) => commit.sha === activeCommitSha)) {
      setActiveCommitSha(null);
    }
  }, [commits, activeCommitSha]);

  useEffect(() => {
    if (!selectedCommit || commitDiffCache[selectedCommit.sha]) {
      return;
    }

    const controller = new AbortController();

    const loadDiff = async (commit: KanbanCommitChangeItem) => {
      setLoadingCommitSha(commit.sha);
      setCommitDiffErrors((current) => {
        if (!(commit.sha in current)) return current;
        const next = { ...current };
        delete next[commit.sha];
        return next;
      });

      try {
        const response = await desktopAwareFetch(
          `/api/tasks/${encodeURIComponent(taskId)}/changes/commit?sha=${encodeURIComponent(commit.sha)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(data.error ?? t.kanbanDetail.failedToLoadCommitDiff);
        }

        const diff = (data.diff ?? {
          ...commit,
          patch: "",
        }) as KanbanCommitDiffPreview;
        setCommitDiffCache((current) => ({ ...current, [commit.sha]: diff }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setCommitDiffErrors((current) => ({
          ...current,
          [commit.sha]: error instanceof Error ? error.message : t.kanbanDetail.failedToLoadCommitDiff,
        }));
      } finally {
        if (!controller.signal.aborted) {
          setLoadingCommitSha((current) => (current === commit.sha ? null : current));
        }
      }
    };

    void loadDiff(selectedCommit);
    return () => controller.abort();
  }, [selectedCommit, commitDiffCache, taskId, t.kanbanDetail.failedToLoadCommitDiff]);

  return (
    <div className="space-y-3">
      {!taskChangesLoading && taskChanges && !taskChanges.error ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 pb-2 text-[11px] dark:border-slate-800/80">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300">
            {taskChanges.label}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-500 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-400">
            {sourceLabel}
          </span>
          {scopePath ? (
            <span className="truncate text-slate-500 dark:text-slate-400" title={scopePath}>
              {scopePath}
            </span>
          ) : null}
        </div>
      ) : null}

      {hasCommittedChanges ? (
        <section className="space-y-2">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              {t.kanbanDetail.committedChanges}
            </div>
            {taskChanges?.baseRef ? (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t.kanbanDetail.baseComparison.replace("{baseRef}", taskChanges.baseRef)}
              </div>
            ) : null}
          </div>

          <div className="space-y-1">
            {commits.map((commit) => (
              <CommitRow
                key={commit.sha}
                commit={commit}
                selected={selectedCommit?.sha === commit.sha}
                onClick={() => setActiveCommitSha(commit.sha)}
              />
            ))}
          </div>

          <TaskCommitDiffPreview
            commit={selectedCommit}
            diff={selectedCommitDiff}
            loading={selectedCommitLoading}
            error={selectedCommitError}
            compact={true}
          />
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          {t.kanbanDetail.localChanges}
        </div>
        {hasLocalChanges || taskChangesLoading || !taskChanges || taskChanges.error ? (
          <KanbanEnhancedFileChangesPanel
            taskId={taskId}
            workspaceId={workspaceId}
            changes={taskChanges}
            loading={taskChangesLoading}
            onRefresh={onRefresh}
            embedded={true}
          />
        ) : (
          <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
            {t.kanbanDetail.noChanges}
          </div>
        )}
      </section>
    </div>
  );
}
