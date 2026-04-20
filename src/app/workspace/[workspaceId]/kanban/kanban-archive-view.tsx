"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { Archive, Search, Tag, X, FileText, MessageSquare, ChevronDown, ChevronRight } from "lucide-react";
import type { TaskInfo } from "../types";

// ── Helpers ──────────────────────────────────────────────

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function extractLabels(tasks: TaskInfo[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) {
    for (const l of t.labels ?? []) set.add(l);
  }
  return Array.from(set).sort();
}

function deriveArchivedAt(task: TaskInfo): string {
  // Prefer the last laneSession that moved into archived column
  const archivedSession = (task.laneSessions ?? [])
    .filter((s) => s.columnId === "archived")
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.completedAt ?? a.startedAt))[0];
  if (archivedSession?.completedAt) return archivedSession.completedAt;
  if (archivedSession?.startedAt) return archivedSession.startedAt;
  return task.updatedAt ?? task.createdAt;
}

// ── Sub-components ───────────────────────────────────────

function ArchiveEmptyState({ t }: { t: ReturnType<typeof useTranslation>["t"] }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <Archive className="h-10 w-10 text-slate-300 dark:text-slate-600" />
      <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">{t.archiveHistory.emptyTitle}</h3>
      <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">{t.archiveHistory.emptySubtitle}</p>
    </div>
  );
}

function ArchiveCardItem({
  task,
  onClick,
  t,
}: {
  task: TaskInfo;
  onClick: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const labels = task.labels ?? [];
  const archivedAt = deriveArchivedAt(task);

  return (
    <button
      onClick={onClick}
      className="group w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#1c1f2e] dark:bg-[#12141c] dark:hover:border-[#2a2d3e] dark:hover:bg-[#181b26]"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] font-medium text-slate-800 dark:text-slate-200 line-clamp-2">{task.title}</h4>
        <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">{formatDate(archivedAt)}</span>
      </div>
      {labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {labels.map((label) => (
            <span
              key={label}
              className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-[#1c1f2e] dark:text-slate-400"
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {task.objective && (
        <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500 line-clamp-1">{task.objective}</p>
      )}
    </button>
  );
}

function ArchiveDetailPanel({
  task,
  onClose,
  t,
}: {
  task: TaskInfo;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const comments = task.comments ?? [];

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-xl dark:border-[#1c1f2e] dark:bg-[#0f1117]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-[#1c1f2e]">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-1">{task.title}</h3>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[#1c1f2e] dark:hover:text-slate-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* Description */}
        <section>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <FileText className="h-3.5 w-3.5" />
            {t.archiveHistory.description}
          </h4>
          {task.objective ? (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700 dark:border-[#1c1f2e] dark:bg-[#12141c] dark:text-slate-300">
              <MarkdownViewer content={task.objective} />
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-slate-400 dark:text-slate-500 italic">{t.archiveHistory.noDescription}</p>
          )}
        </section>

        {/* Comments timeline */}
        <section>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <MessageSquare className="h-3.5 w-3.5" />
            {t.archiveHistory.comments}
          </h4>
          {comments.length > 0 ? (
            <div className="mt-2 space-y-3">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#1c1f2e] dark:bg-[#12141c]"
                >
                  <p className="text-[12px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{c.body}</p>
                  <span className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">{formatDate(c.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-slate-400 dark:text-slate-500 italic">{t.archiveHistory.noComments}</p>
          )}
        </section>

        {/* Metadata */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Meta</h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            <dt className="text-slate-400 dark:text-slate-500">Status</dt>
            <dd className="text-slate-700 dark:text-slate-300">{task.status}</dd>
            <dt className="text-slate-400 dark:text-slate-500">{t.archiveHistory.archivedAt}</dt>
            <dd className="text-slate-700 dark:text-slate-300">{formatDate(deriveArchivedAt(task))}</dd>
            {(task.labels ?? []).length > 0 && (
              <>
                <dt className="text-slate-400 dark:text-slate-500">Labels</dt>
                <dd className="text-slate-700 dark:text-slate-300">{(task.labels ?? []).join(", ")}</dd>
              </>
            )}
          </dl>
        </section>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────

export interface KanbanArchiveViewProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

export function KanbanArchiveView({ workspaceId, open, onClose }: KanbanArchiveViewProps) {
  const { t } = useTranslation();
  const [allTasks, setAllTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskInfo | null>(null);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);

  // Fetch all tasks with archived columnId
  const fetchArchivedTasks = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      const tasks: TaskInfo[] = Array.isArray(data?.tasks) ? data.tasks : [];
      // Filter to only archived tasks (columnId === 'archived')
      setAllTasks(tasks.filter((task) => task.columnId === "archived"));
    } catch {
      setAllTasks([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open) {
      fetchArchivedTasks();
    }
  }, [open, fetchArchivedTasks]);

  // Derive label list from archived tasks
  const labels = useMemo(() => extractLabels(allTasks), [allTasks]);

  // Filter tasks by search and label
  const filteredTasks = useMemo(() => {
    let result = allTasks;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (task) =>
          task.title.toLowerCase().includes(q) ||
          (task.comment ?? "").toLowerCase().includes(q) ||
          (task.objective ?? "").toLowerCase().includes(q),
      );
    }
    if (selectedLabel) {
      result = result.filter((task) => (task.labels ?? []).includes(selectedLabel));
    }
    return result;
  }, [allTasks, searchQuery, selectedLabel]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50"
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl dark:border-[#1c1f2e] dark:bg-[#0f1117]">
        {/* Header */}
        <div className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-[#1c1f2e]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.archiveHistory.title}</h2>
              {!loading && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  {t.archiveHistory.cardCount.replace("{count}", String(allTasks.length))}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[#1c1f2e] dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search & Filter bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.archiveHistory.searchPlaceholder}
                className="h-7 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-slate-300 focus:outline-none dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-slate-600"
              />
            </div>

            {/* Label filter */}
            {labels.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setLabelMenuOpen((v) => !v)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-300 dark:hover:bg-[#191c28]"
                >
                  <Tag className="h-3 w-3" />
                  {selectedLabel ?? t.archiveHistory.allLabels}
                  {labelMenuOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                {labelMenuOpen && (
                  <div className="absolute right-0 top-8 z-10 min-w-[140px] rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-[#12141c]">
                    <button
                      onClick={() => { setSelectedLabel(null); setLabelMenuOpen(false); }}
                      className="w-full px-3 py-1.5 text-left text-[12px] text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#191c28]"
                    >
                      {t.archiveHistory.allLabels}
                    </button>
                    {labels.map((label) => (
                      <button
                        key={label}
                        onClick={() => { setSelectedLabel(label); setLabelMenuOpen(false); }}
                        className={`w-full px-3 py-1.5 text-left text-[12px] hover:bg-slate-50 dark:hover:bg-[#191c28] ${
                          selectedLabel === label
                            ? "font-medium text-slate-900 dark:text-white"
                            : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedLabel && (
              <button
                onClick={() => setSelectedLabel(null)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-[#191c28]"
              >
                <X className="h-3 w-3" />
                {t.archiveHistory.labelFilterClear}
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300" />
            </div>
          ) : filteredTasks.length === 0 ? (
            allTasks.length === 0 ? (
              <ArchiveEmptyState t={t} />
            ) : (
              <div className="flex flex-col items-center py-10 text-center">
                <Search className="h-6 w-6 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-[12px] text-slate-400 dark:text-slate-500">{t.archiveHistory.noResults}</p>
              </div>
            )
          ) : (
            <div className="space-y-2">
              {filteredTasks.map((task) => (
                <ArchiveCardItem
                  key={task.id}
                  task={task}
                  t={t}
                  onClick={() => setSelectedTask(task)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail overlay */}
      {selectedTask && (
        <ArchiveDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          t={t}
        />
      )}
    </>
  );
}
