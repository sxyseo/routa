"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import type { TaskInfo } from "../types";
import { ArchiveCardList } from "./components/archive-card-list";
import { ArchiveDetailPanel } from "./components/archive-detail-panel";
import { ArchiveEmptyState } from "./components/archive-empty-state";
import { ArchiveSearchBar } from "./components/archive-search-bar";
import { ArchiveLabelFilter } from "./components/archive-label-filter";

const ARCHIVED_STATUSES = ["COMPLETED", "CANCELLED"];

export function ArchivePageClient() {
  const params = useParams();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;

  const { t } = useTranslation();
  const router = useRouter();
  const workspacesHook = useWorkspaces();
  const workspaceTitle = workspacesHook.workspaces.find((w) => w.id === workspaceId)?.title;

  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskInfo | null>(null);

  // Fetch archived tasks
  const fetchArchivedTasks = useCallback(async () => {
    if (!workspaceId || workspaceId === "__placeholder__") return;
    setLoading(true);
    setError(null);
    try {
      const allTasks: TaskInfo[] = [];
      const seenIds = new Set<string>();

      // Fetch by status for COMPLETED and CANCELLED tasks
      for (const status of ARCHIVED_STATUSES) {
        const response = await desktopAwareFetch(
          `/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}&status=${status}`,
          { cache: "no-store" },
        );
        if (!response.ok) continue;
        const data = await response.json();
        if (Array.isArray(data.tasks)) {
          for (const task of data.tasks) {
            if (!seenIds.has(task.id)) {
              seenIds.add(task.id);
              allTasks.push(task);
            }
          }
        }
      }

      // Also fetch all tasks and include those in 'archived' column
      const allResponse = await desktopAwareFetch(
        `/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" },
      );
      if (allResponse.ok) {
        const allData = await allResponse.json();
        if (Array.isArray(allData.tasks)) {
          for (const task of allData.tasks) {
            if (task.columnId === "archived" && !seenIds.has(task.id)) {
              seenIds.add(task.id);
              allTasks.push(task);
            }
          }
        }
      }

      setTasks(allTasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load archived tasks");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchArchivedTasks();
  }, [fetchArchivedTasks]);

  // Derive all available labels from tasks
  const allLabels = useMemo(() => {
    const labelSet = new Set<string>();
    for (const task of tasks) {
      if (task.labels) {
        for (const label of task.labels) {
          if (label) labelSet.add(label);
        }
      }
    }
    return Array.from(labelSet).sort();
  }, [tasks]);

  // Filter tasks by search query and selected labels
  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (task) =>
          task.title.toLowerCase().includes(query) ||
          (task.objective && task.objective.toLowerCase().includes(query)) ||
          (task.comment && task.comment.toLowerCase().includes(query)),
      );
    }

    if (selectedLabels.length > 0) {
      result = result.filter(
        (task) =>
          task.labels &&
          selectedLabels.some((label) => task.labels!.includes(label)),
      );
    }

    // Sort by updatedAt descending
    return result.sort((a, b) => {
      const dateA = a.updatedAt || a.createdAt;
      const dateB = b.updatedAt || b.createdAt;
      return dateB.localeCompare(dateA);
    });
  }, [tasks, searchQuery, selectedLabels]);

  const handleToggleLabel = useCallback((label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label],
    );
  }, []);

  const handleClearLabels = useCallback(() => {
    setSelectedLabels([]);
  }, []);

  const handleSelectTask = useCallback((task: TaskInfo) => {
    setSelectedTask(task);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedTask(null);
  }, []);

  const handleWorkspaceSelect = useCallback((id: string) => {
    router.push(`/workspace/${id}/archive`);
  }, [router]);

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspaceTitle}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspaceTitle}
          onSelect={handleWorkspaceSelect}
          loading={workspacesHook.loading}
          desktop
        />
      )}
    >
      <div className="flex h-full flex-col" data-testid="archive-page">
        {/* Header */}
        <div className="shrink-0 border-b border-slate-200/80 bg-white px-6 py-4 dark:border-[#1c1f2e] dark:bg-[#12141c]">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t.archiveHistory.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t.archiveHistory.subtitle}
          </p>

          {/* Search and filters */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ArchiveSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t.archiveHistory.searchPlaceholder}
            />
            {allLabels.length > 0 && (
              <ArchiveLabelFilter
                labels={allLabels}
                selectedLabels={selectedLabels}
                onToggleLabel={handleToggleLabel}
                onClearLabels={handleClearLabels}
                filterByLabel={t.archiveHistory.filterByLabel}
                allLabels={t.archiveHistory.allLabels}
                clearLabel={t.archiveHistory.labelFilterClear}
              />
            )}
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {t.archiveHistory.cardCount.replace("{count}", String(filteredTasks.length))}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-sm text-slate-400 dark:text-slate-500">
                {t.common.loading}
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
            </div>
          ) : filteredTasks.length === 0 && tasks.length === 0 ? (
            <ArchiveEmptyState
              title={t.archiveHistory.emptyTitle}
              subtitle={t.archiveHistory.emptySubtitle}
            />
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                {t.archiveHistory.noResults}
              </p>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0 overflow-y-auto">
                <ArchiveCardList
                  tasks={filteredTasks}
                  selectedTaskId={selectedTask?.id ?? null}
                  onSelectTask={handleSelectTask}
                  archivedAtLabel={t.archiveHistory.archivedAt}
                  viewDetailLabel={t.archiveHistory.viewDetail}
                />
              </div>
              {selectedTask && (
                <ArchiveDetailPanel
                  task={selectedTask}
                  onClose={handleCloseDetail}
                  closeLabel={t.archiveHistory.closeDetail}
                  descriptionLabel={t.archiveHistory.description}
                  commentsLabel={t.archiveHistory.comments}
                  noDescriptionLabel={t.archiveHistory.noDescription}
                  noCommentsLabel={t.archiveHistory.noComments}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DesktopAppShell>
  );
}
