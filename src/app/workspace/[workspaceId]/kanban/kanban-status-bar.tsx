"use client";

import { GitBranch, FileCode, Activity, Zap } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { RuntimeFitnessModeSummary, RuntimeFitnessStatusResponse } from "@/core/fitness/runtime-status-types";
import type { KanbanBoardInfo } from "../types";
import type { RepoSyncState } from "./kanban-repo-sync-status";

interface KanbanStatusBarProps {
  /** 当前默认仓库 */
  defaultCodebase: CodebaseData | null;
  /** 所有仓库列表 */
  codebases: CodebaseData[];
  /** 文件变更统计 */
  fileChangesSummary: {
    changedFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
  /** 当前看板 */
  board: KanbanBoardInfo | null;
  /** 看板队列状态 */
  boardQueue?: KanbanBoardInfo["queue"];
  /** 看板与 session/repo 绑定健康状态 */
  repoHealth?: { missingRepoTasks: number; cwdMismatchTasks: number };
  /** 当前选中的 Provider */
  selectedProvider?: AcpProviderInfo | null;
  /** 点击仓库时的回调 */
  onRepoClick?: () => void;
  /** 点击文件变更时的回调 */
  onFileChangesClick?: () => void;
  /** 点击 Git Log 时的回调 */
  onGitLogClick?: () => void;
  /** 点击 Provider 时的回调 */
  onProviderClick?: () => void;
  /** 点击 Runtime Fitness 时的回调 */
  onFitnessClick?: () => void;
  /** 文件变更面板是否打开 */
  fileChangesOpen?: boolean;
  /** Git Log 面板是否打开 */
  gitLogOpen?: boolean;
  /** 仓库同步状态 */
  repoSync?: RepoSyncState;
  /** Runtime Fitness 状态 */
  runtimeFitness?: RuntimeFitnessStatusResponse | null;
  /** Runtime Fitness 是否加载中 */
  runtimeFitnessLoading?: boolean;
  /** Runtime Fitness 加载错误 */
  runtimeFitnessError?: string | null;
}

function formatModeLabel(summary: RuntimeFitnessModeSummary | null, fastLabel: string, fullLabel: string) {
  if (!summary) return null;
  return summary.mode === "fast" ? fastLabel : fullLabel;
}

function formatScore(value: number | null | undefined): string | null {
  return typeof value === "number" ? value.toFixed(1) : null;
}

function formatObservedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleString();
}

export function KanbanStatusBar({
  defaultCodebase,
  codebases,
  fileChangesSummary,
  board,
  boardQueue,
  repoHealth,
  selectedProvider,
  onRepoClick,
  onFileChangesClick,
  onGitLogClick,
  onProviderClick,
  onFitnessClick,
  fileChangesOpen = false,
  gitLogOpen = false,
  repoSync,
  runtimeFitness,
  runtimeFitnessLoading = false,
  runtimeFitnessError,
}: KanbanStatusBarProps) {
  const { t } = useTranslation();
  const latestFitness = runtimeFitness?.latest ?? null;
  const latestModeLabel = formatModeLabel(latestFitness, t.kanban.fitnessModeFast, t.kanban.fitnessModeFull);
  const currentScore = latestFitness?.currentStatus === "running"
    ? formatScore(latestFitness.lastCompleted?.finalScore)
    : formatScore(latestFitness?.finalScore ?? latestFitness?.lastCompleted?.finalScore);
  const statusLabel = latestFitness?.currentStatus === "running"
    ? t.kanban.runningLabel
    : latestFitness?.currentStatus === "failed"
      ? t.kanban.fitnessBlocked
      : latestFitness?.currentStatus === "skipped"
        ? t.kanban.fitnessSkipped
        : latestFitness?.currentStatus === "passed"
          ? t.kanban.synced
          : runtimeFitnessLoading
            ? t.kanban.fitnessLoading
            : runtimeFitnessError
              ? t.kanban.fitnessIssue
              : t.kanban.fitnessNoData;
  const fitnessDotClass = latestFitness?.currentStatus === "running"
    ? "animate-pulse bg-sky-500"
    : latestFitness?.currentStatus === "failed"
      ? "bg-rose-500"
      : latestFitness?.currentStatus === "skipped"
        ? "bg-amber-500"
        : latestFitness?.currentStatus === "passed"
          ? "bg-emerald-500"
          : runtimeFitnessLoading
            ? "animate-pulse bg-slate-400"
            : runtimeFitnessError
              ? "bg-rose-500"
              : "bg-slate-400";
  const fitnessTitleParts = [
    `${t.kanban.fitnessLabel}: ${[
      latestModeLabel,
      statusLabel,
      currentScore,
      formatObservedAt(latestFitness?.currentObservedAt),
    ].filter(Boolean).join(" · ") || t.kanban.fitnessNoData}`,
  ];
  if (latestFitness?.currentStatus === "running" && latestFitness.lastCompleted) {
    fitnessTitleParts.push(
      `${t.kanban.fitnessLast}: ${[
        latestFitness.lastCompleted.status === "failed"
          ? t.kanban.fitnessBlocked
          : latestFitness.lastCompleted.status === "skipped"
            ? t.kanban.fitnessSkipped
            : t.kanban.synced,
        formatScore(latestFitness.lastCompleted.finalScore),
        formatObservedAt(latestFitness.lastCompleted.observedAt),
      ].filter(Boolean).join(" · ")}`,
    );
  }
  if (runtimeFitnessError) {
    fitnessTitleParts.push(runtimeFitnessError);
  }
  if (onFitnessClick) {
    fitnessTitleParts.push(t.kanban.fitnessOpenDetails);
  }

  return (
    <div
      className="h-6 shrink-0 flex items-center justify-between border-t border-desktop-border bg-desktop-bg-tertiary text-[11px] select-none"
      data-testid="kanban-status-bar"
    >
      {/* 左侧：仓库和状态信息 */}
      <div className="flex items-center divide-x divide-desktop-border/50">
        {/* 仓库信息 */}
        {defaultCodebase ? (
          <button
            onClick={onRepoClick}
            className="flex items-center gap-1.5 px-2.5 h-6 text-desktop-text-primary hover:bg-desktop-bg-active transition-colors"
            title={`${defaultCodebase.repoPath}${defaultCodebase.branch ? ` @ ${defaultCodebase.branch}` : ""}`}
          >
            <GitBranch className="w-3 h-3" />
            <span className="max-w-[180px] truncate font-medium">
              {defaultCodebase.label ?? defaultCodebase.repoPath.split("/").pop() ?? defaultCodebase.repoPath}
            </span>
            {defaultCodebase.branch && (
              <span className="text-desktop-text-secondary">@ {defaultCodebase.branch}</span>
            )}
            {codebases.length > 1 && (
              <span className="text-desktop-text-secondary">+{codebases.length - 1}</span>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 h-6 text-desktop-text-secondary">
            <GitBranch className="w-3 h-3" />
            <span>{t.kanbanBoard.noReposLinked}</span>
          </div>
        )}

        {/* 文件变更 */}
        {defaultCodebase && (
          <button
            onClick={onFileChangesClick}
            data-testid="kanban-file-changes-open"
            className={`flex items-center gap-1.5 px-2.5 h-6 transition-colors ${
              fileChangesOpen
                ? "bg-desktop-bg-active text-desktop-accent"
                : "text-desktop-text-primary hover:bg-desktop-bg-active"
            }`}
            title={`${fileChangesSummary.changedFiles} file${fileChangesSummary.changedFiles === 1 ? "" : "s"} changed`}
          >
            <FileCode className="w-3 h-3" />
            <span>{fileChangesSummary.changedFiles > 0 ? fileChangesSummary.changedFiles : "0"}</span>
            {fileChangesSummary.changedFiles > 0 && (
              <>
                <span className="text-emerald-500">+{fileChangesSummary.totalAdditions}</span>
                <span className="text-rose-500">-{fileChangesSummary.totalDeletions}</span>
              </>
            )}
          </button>
        )}

        {/* Git Log */}
        {defaultCodebase && (
          <button
            onClick={onGitLogClick}
            className={`flex items-center gap-1.5 px-2.5 h-6 transition-colors ${
              gitLogOpen
                ? "bg-desktop-bg-active text-desktop-accent"
                : "text-desktop-text-primary hover:bg-desktop-bg-active"
            }`}
            title={t.gitLog.title}
          >
            <Activity className="w-3 h-3" />
            <span>{t.gitLog.title}</span>
          </button>
        )}
      </div>

      {/* 右侧：同步状态、运行状态和 Provider */}
      <div className="flex items-center divide-x divide-desktop-border/50">
        {/* 看板健康 */}
        {repoHealth && (repoHealth.missingRepoTasks > 0 || repoHealth.cwdMismatchTasks > 0) && (
          <div className="flex items-center gap-2 px-2.5 h-6 text-amber-600 dark:text-amber-300">
            <span className="font-medium">{t.kanban.kanbanHealth}</span>
            {repoHealth.missingRepoTasks > 0 && (
              <span>{repoHealth.missingRepoTasks} {t.kanban.missing}</span>
            )}
            {repoHealth.cwdMismatchTasks > 0 && (
              <span>{repoHealth.cwdMismatchTasks} {t.kanban.sessionMismatch}</span>
            )}
          </div>
        )}

        {/* 同步状态 */}
        {repoSync && repoSync.status !== "idle" && (
          <div
            className="flex items-center gap-1.5 px-2.5 h-6 text-desktop-text-secondary text-[11px]"
            data-testid="kanban-repo-sync-progress"
          >
            <span
              className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                repoSync.status === "error"
                  ? "bg-rose-500"
                  : repoSync.status === "done"
                    ? "bg-emerald-500"
                    : "animate-pulse bg-sky-500"
              }`}
            />
            <span className="max-w-[150px] truncate">
              {repoSync.status === "syncing"
                ? repoSync.total > 0
                  ? `${t.kanban.syncingProgress} ${repoSync.completed}/${repoSync.total}`
                  : t.kanban.syncingRepos
                : repoSync.status === "done"
                  ? `${repoSync.total} ${repoSync.total === 1 ? t.kanban.repoUpdated : t.kanban.reposUpdated}`
                  : t.kanban.syncIssue}
            </span>
          </div>
        )}

        {defaultCodebase && (
          onFitnessClick ? (
            <button
              onClick={onFitnessClick}
              className="flex items-center gap-1.5 px-2.5 h-6 text-desktop-text-secondary hover:bg-desktop-bg-active transition-colors"
              title={fitnessTitleParts.join("\n")}
              data-testid="kanban-runtime-fitness-status"
            >
              <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${fitnessDotClass}`} />
              <span className="font-medium text-desktop-text-primary">{t.kanban.fitnessLabel}</span>
              <span className="max-w-[220px] truncate">
                {[
                  latestModeLabel,
                  statusLabel,
                  currentScore,
                ].filter(Boolean).join(" · ") || t.kanban.fitnessNoData}
              </span>
            </button>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2.5 h-6 text-desktop-text-secondary"
              title={fitnessTitleParts.join("\n")}
              data-testid="kanban-runtime-fitness-status"
            >
              <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${fitnessDotClass}`} />
              <span className="font-medium text-desktop-text-primary">{t.kanban.fitnessLabel}</span>
              <span className="max-w-[220px] truncate">
                {[
                  latestModeLabel,
                  statusLabel,
                  currentScore,
                ].filter(Boolean).join(" · ") || t.kanban.fitnessNoData}
              </span>
            </div>
          )
        )}

        {/* 运行状态 */}
        {board && (
          <div className="flex items-center gap-2 px-2.5 h-6 text-desktop-text-secondary">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {t.kanban.runningLabel} {boardQueue?.runningCount ?? 0}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {t.kanban.queuedLabel} {boardQueue?.queuedCount ?? 0}
            </span>
          </div>
        )}

        {/* Provider */}
        {selectedProvider && (
          <button
            onClick={onProviderClick}
            className="flex items-center gap-1.5 px-2.5 h-6 text-desktop-text-primary hover:bg-desktop-bg-active transition-colors"
            title={selectedProvider.description}
          >
            <Zap className="w-3 h-3" />
            <span className="max-w-[120px] truncate">{selectedProvider.name}</span>
          </button>
        )}
      </div>
    </div>
  );
}
