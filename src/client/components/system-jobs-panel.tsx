"use client";

import { useSystemJobs } from "@/client/hooks/use-system-jobs";
import { useTranslation } from "@/i18n";
import { RefreshCw } from "lucide-react";

function statusDotColor(status: string): string {
  switch (status) {
    case "running": return "bg-blue-400 animate-pulse";
    case "success": return "bg-green-500";
    case "error":   return "bg-red-500";
    default:        return "bg-gray-400";
  }
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SystemJobsPanel() {
  const { jobs, loading, error, refetch } = useSystemJobs();
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-desktop-text-tertiary">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-desktop-border border-t-desktop-accent" />
        <span className="ml-3 text-sm">{t.ui.loading}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  // Group jobs by group
  const groups = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const list = groups.get(job.group) ?? [];
    list.push(job);
    groups.set(job.group, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-desktop-text-tertiary">
          {t.systemJobs.description}
        </p>
        <button
          onClick={() => void refetch()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-desktop-text-secondary hover:bg-desktop-bg-active transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t.systemJobs.refresh}
        </button>
      </div>

      {Array.from(groups.entries()).map(([group, groupJobs]) => (
        <div key={group}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-desktop-text-tertiary">
            {group === "scheduler" ? t.systemJobs.groupScheduler : t.systemJobs.groupKanban}
          </h3>
          <div className="space-y-3">
            {groupJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function JobCard({ job }: { job: ReturnType<typeof useSystemJobs>["jobs"][number] }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDotColor(job.lastStatus)}`} />
          <div>
            <h4 className="text-sm font-medium text-desktop-text-primary">{job.name}</h4>
            <p className="text-xs text-desktop-text-tertiary">{job.description}</p>
          </div>
        </div>
        <span className="rounded-full bg-desktop-bg-active px-2 py-0.5 text-[10px] font-medium text-desktop-text-tertiary">
          {job.interval}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
        <div>
          <span className="text-desktop-text-tertiary">{t.systemJobs.lastRun}</span>
          <p className="mt-0.5 text-desktop-text-primary">{formatTime(job.lastStartedAt)}</p>
        </div>
        <div>
          <span className="text-desktop-text-tertiary">{t.systemJobs.duration}</span>
          <p className="mt-0.5 text-desktop-text-primary">{formatDuration(job.lastDurationMs)}</p>
        </div>
        <div>
          <span className="text-desktop-text-tertiary">{t.systemJobs.status}</span>
          <p className={`mt-0.5 ${job.lastStatus === "error" ? "text-red-500" : "text-desktop-text-primary"}`}>
            {job.lastStatus === "idle" ? t.systemJobs.statusIdle
              : job.lastStatus === "running" ? t.systemJobs.statusRunning
              : job.lastStatus === "success" ? t.systemJobs.statusSuccess
              : t.systemJobs.statusError}
          </p>
        </div>
      </div>

      {job.lastError && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {job.lastError}
        </div>
      )}
    </div>
  );
}
