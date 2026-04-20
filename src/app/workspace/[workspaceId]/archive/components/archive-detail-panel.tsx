"use client";

import { X } from "lucide-react";
import type { TaskInfo } from "../../types";

interface ArchiveDetailPanelProps {
  task: TaskInfo;
  onClose: () => void;
  closeLabel: string;
  descriptionLabel: string;
  commentsLabel: string;
  noDescriptionLabel: string;
  noCommentsLabel: string;
}

export function ArchiveDetailPanel({
  task,
  onClose,
  closeLabel,
  descriptionLabel,
  commentsLabel,
  noDescriptionLabel,
  noCommentsLabel,
}: ArchiveDetailPanelProps) {
  const updatedAt = task.updatedAt || task.createdAt;

  return (
    <aside
      className="hidden w-[420px] shrink-0 flex-col overflow-hidden border-l border-slate-200/80 bg-white dark:border-[#1c1f2e] dark:bg-[#12141c] md:flex"
      data-testid="archive-detail-panel"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200/80 px-4 py-3 dark:border-[#202433]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {task.title}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {task.status} · {new Date(updatedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 dark:border-[#2a2f43] dark:text-slate-300 dark:hover:bg-[#202433]"
          >
            {closeLabel}
          </button>
        </div>
        {/* Labels */}
        {task.labels && task.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Description */}
        <section className="mb-6">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            {descriptionLabel}
          </h3>
          {task.objective || task.comment ? (
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 text-sm leading-relaxed text-slate-700 dark:border-[#232736] dark:bg-[#10131a] dark:text-slate-300">
              {task.objective || task.comment}
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">{noDescriptionLabel}</p>
          )}
        </section>

        {/* Comments */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            {commentsLabel}
          </h3>
          {task.comments && task.comments.length > 0 ? (
            <div className="space-y-3">
              {task.comments.map((comment, index) => (
                <div
                  key={comment.id || index}
                  className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-[#232736] dark:bg-[#10131a]"
                >
                  <div className="mb-1 flex items-center gap-2">
                    {comment.agentId && (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        {comment.agentId.slice(0, 8)}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {comment.body}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">{noCommentsLabel}</p>
          )}
        </section>

        {/* Additional metadata */}
        {(task.scope || task.acceptanceCriteria?.length || task.verificationVerdict) && (
          <section className="mt-6 border-t border-slate-200/80 pt-4 dark:border-[#202433]">
            {task.scope && (
              <div className="mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Scope</span>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{task.scope}</p>
              </div>
            )}
            {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
              <div className="mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Acceptance Criteria</span>
                <ul className="mt-1 list-inside list-disc space-y-1">
                  {task.acceptanceCriteria.map((ac, i) => (
                    <li key={i} className="text-sm text-slate-600 dark:text-slate-300">{ac}</li>
                  ))}
                </ul>
              </div>
            )}
            {task.verificationVerdict && (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Verification</span>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{task.verificationVerdict}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
