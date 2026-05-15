"use client";

import type { TaskInfo } from "../../types";

interface ArchiveCardListProps {
  tasks: TaskInfo[];
  selectedTaskId: string | null;
  onSelectTask: (task: TaskInfo) => void;
  archivedAtLabel: string;
  viewDetailLabel: string;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  CANCELLED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export function ArchiveCardList({
  tasks,
  selectedTaskId,
  onSelectTask,
  archivedAtLabel,
  viewDetailLabel,
}: ArchiveCardListProps) {
  return (
    <div className="space-y-2 p-4" data-testid="archive-card-list">
      {tasks.map((task) => {
        const isSelected = task.id === selectedTaskId;
        const updatedAt = task.updatedAt || task.createdAt;
        const statusStyle = STATUS_STYLES[task.status] ?? STATUS_STYLES.CANCELLED;

        return (
          <button
            key={task.id}
            type="button"
            onClick={() => onSelectTask(task)}
            className={`w-full rounded-lg border p-4 text-left transition-all ${
              isSelected
                ? "border-amber-300 bg-amber-50/60 shadow-sm dark:border-amber-700 dark:bg-amber-900/10"
                : "border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-sm dark:border-[#232736] dark:bg-[#12141c] dark:hover:border-[#3a3f53]"
            }`}
            data-testid={`archive-card-${task.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {task.title}
                  </h3>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusStyle}`}>
                    {task.status}
                  </span>
                  {task.priority && (
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.medium}`}>
                      {task.priority}
                    </span>
                  )}
                </div>
                {task.objective && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {task.objective}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {task.labels && task.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {task.labels.map((label) => (
                        <span
                          key={label}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-[#202433] dark:text-slate-400"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {archivedAtLabel} {formatRelativeDate(updatedAt)}
                  </span>
                </div>
              </div>
              <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                {viewDetailLabel}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
