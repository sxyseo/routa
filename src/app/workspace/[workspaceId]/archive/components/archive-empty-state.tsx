"use client";

import { Archive } from "lucide-react";

interface ArchiveEmptyStateProps {
  title: string;
  subtitle: string;
}

export function ArchiveEmptyState({ title, subtitle }: ArchiveEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8" data-testid="archive-empty-state">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-[#202433]">
        <Archive className="h-8 w-8 text-slate-400 dark:text-slate-500" />
      </div>
      <div className="text-center">
        <h3 className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</h3>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}
