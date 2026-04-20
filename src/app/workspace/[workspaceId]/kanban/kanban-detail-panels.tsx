"use client";

import { useState, useMemo, useCallback } from "react";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { useTranslation } from "@/i18n";
import { Link2, AlertTriangle } from "lucide-react";
import type { TaskInfo } from "../types";

function formatReadinessFieldLabel(field: string, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (field) {
    case "scope":
      return t.kanbanDetail.scope;
    case "acceptance_criteria":
      return t.kanbanDetail.acceptanceCriteria;
    case "verification_commands":
      return t.kanbanDetail.verificationCommands;
    case "test_cases":
      return t.kanbanDetail.testCases;
    case "verification_plan":
      return t.kanbanDetail.verificationPlan;
    case "dependencies_declared":
      return t.kanbanDetail.dependenciesDeclared;
    default:
      return field;
  }
}

function formatCheckStatus(value: boolean, t: ReturnType<typeof useTranslation>["t"]): string {
  return value ? t.kanbanDetail.present : t.kanbanDetail.missing;
}

function formatAnalysisStatus(value: string, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (value) {
    case "pass":
      return t.kanbanDetail.pass;
    case "warning":
      return t.kanbanDetail.warning;
    case "fail":
      return t.kanbanDetail.fail;
    default:
      return value.toUpperCase();
  }
}

function formatVerificationVerdictLabel(
  verdict: string | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (verdict) {
    case "NOT_APPROVED":
      return t.kanbanDetail.reviewRequestedChanges;
    case "BLOCKED":
      return t.kanbanDetail.reviewBlockedVerdict;
    case "APPROVED":
      return t.kanbanDetail.reviewApprovedVerdict;
    default:
      return t.kanbanDetail.reviewFeedback;
  }
}

function SummaryGridItem({
  label,
  value,
  detail,
  compact = false,
}: {
  label: string;
  value: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-0.5 border-b border-slate-200/70 px-1.5 py-1.5 text-sm dark:border-slate-700/60">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="font-medium text-slate-900 dark:text-slate-100">{value}</div>
      {detail && !compact && (
        <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</div>
      )}
    </div>
  );
}

export function StoryReadinessPanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const readiness = task.storyReadiness;
  const investValidation = task.investValidation;
  const readinessChecks = readiness?.checks;
  const investChecks = investValidation?.checks;
  const requiredLabels = readiness?.requiredTaskFields.map((field) => formatReadinessFieldLabel(field, t)) ?? [];
  const missingLabels = readiness?.missing.map((field) => formatReadinessFieldLabel(field, t)) ?? [];

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        readiness?.ready
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            readiness?.ready
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
          }`}>
            {readiness?.ready ? t.kanbanDetail.readyForDev : t.kanbanDetail.blockedForDev}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {requiredLabels.length > 0
              ? `${t.kanbanDetail.requiredForNextMove}: ${requiredLabels.join(", ")}`
              : t.kanbanDetail.gateNotConfigured}
          </span>
        </div>
        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
          {missingLabels.length > 0
            ? `${t.kanbanDetail.missingFields}: ${missingLabels.join(", ")}`
            : t.kanbanDetail.allRequiredFields}
        </div>
      </div>

      {readinessChecks && (
        <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
          <SummaryGridItem
            label={t.kanbanDetail.scope}
            value={formatCheckStatus(readinessChecks.scope, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.acceptanceCriteria}
            value={formatCheckStatus(readinessChecks.acceptanceCriteria, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.verificationCommands}
            value={formatCheckStatus(readinessChecks.verificationCommands, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.testCases}
            value={formatCheckStatus(readinessChecks.testCases, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.verificationPlan}
            value={formatCheckStatus(readinessChecks.verificationPlan, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.dependenciesDeclared}
            value={formatCheckStatus(readinessChecks.dependenciesDeclared, t)}
            compact={compact}
          />
        </div>
      )}

      {investValidation && investChecks && (
        <div className="space-y-2 border-t border-slate-200/70 pt-2 dark:border-slate-700/70">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.investSummary}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t.kanbanDetail.source}: {investValidation.source === "canonical_story"
                ? t.kanbanDetail.sourceCanonicalStory
                : t.kanbanDetail.sourceHeuristic}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t.kanbanDetail.overall}: {formatAnalysisStatus(investValidation.overallStatus, t)}
            </span>
          </div>
          <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
            <SummaryGridItem
              label={t.kanbanDetail.investIndependent}
              value={formatAnalysisStatus(investChecks.independent.status, t)}
              detail={investChecks.independent.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investNegotiable}
              value={formatAnalysisStatus(investChecks.negotiable.status, t)}
              detail={investChecks.negotiable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investValuable}
              value={formatAnalysisStatus(investChecks.valuable.status, t)}
              detail={investChecks.valuable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investEstimable}
              value={formatAnalysisStatus(investChecks.estimable.status, t)}
              detail={investChecks.estimable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investSmall}
              value={formatAnalysisStatus(investChecks.small.status, t)}
              detail={investChecks.small.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investTestable}
              value={formatAnalysisStatus(investChecks.testable.status, t)}
              detail={investChecks.testable.reason}
              compact={compact}
            />
          </div>
          {investValidation.issues.length > 0 && (
            <div className="mt-2 border-t border-amber-200/70 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:text-amber-300">
              {investValidation.issues.join(" ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ met, label }: { met: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${met ? "bg-emerald-500" : "bg-amber-400"}`} />
      <span className={`font-medium ${met ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
        {label}
      </span>
    </span>
  );
}

export function EvidenceBundlePanel({
  task,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const evidence = task.evidenceSummary;
  if (!evidence) {
    return (
      <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.noEvidenceSummary}
      </div>
    );
  }

  const reviewable = evidence.artifact.requiredSatisfied
    && (evidence.verification.hasReport || evidence.verification.hasVerdict || evidence.completion.hasSummary);

  return (
    <div className={`border-l-2 px-3 py-2.5 ${
      reviewable
        ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
        : "border-l-amber-400/80 dark:border-l-amber-500/70"
    }`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
          reviewable
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
        }`}>
          {reviewable ? t.kanbanDetail.reviewable : t.kanbanDetail.reviewBlocked}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
          <StatusDot met={evidence.artifact.requiredSatisfied ?? false} label={t.kanbanDetail.evidenceArtifactsMet} />
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <StatusDot met={evidence.verification.hasVerdict || evidence.verification.hasReport} label={t.kanbanDetail.evidenceVerificationMet} />
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <StatusDot met={evidence.completion.hasSummary} label={t.kanbanDetail.evidenceCompletionMet} />
        </div>
        {evidence.verification.verdict && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {evidence.verification.verdict}
          </span>
        )}
      </div>
    </div>
  );
}

export function ReviewFeedbackPanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const report = task.verificationReport?.trim();
  const verdict = task.verificationVerdict;

  if (!report && !verdict) {
    return (
      <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.reportMissing}
      </div>
    );
  }

  const verdictLabel = formatVerificationVerdictLabel(verdict, t);
  const verdictTone = verdict === "BLOCKED"
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200"
    : verdict === "APPROVED"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200";

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        verdict === "APPROVED"
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : verdict === "BLOCKED"
            ? "border-l-rose-400/80 dark:border-l-rose-500/70"
            : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictTone}`}>
            {task.columnId === "dev" && verdict !== "APPROVED"
              ? t.kanbanDetail.reviewReturnedToDev
              : verdictLabel}
          </span>
          {verdict && (
            <span className="text-xs text-slate-600 dark:text-slate-300">
              {t.kanbanDetail.verification}: {verdictLabel}
            </span>
          )}
        </div>
      </div>
      {report ? (
        <div className={`border-b border-slate-200/70 text-sm text-slate-700 dark:border-slate-700/70 dark:text-slate-200 ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
          <MarkdownViewer
            content={report}
            className="prose prose-sm max-w-none text-slate-800 dark:prose-invert dark:text-slate-200"
          />
        </div>
      ) : (
        <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
          {t.kanbanDetail.reportMissing}
        </div>
      )}
    </div>
  );
}

export function TaskHierarchyPanel({
  task,
  compact = false,
  onViewTask,
}: {
  task: TaskInfo;
  compact?: boolean;
  onViewTask?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const hasParent = Boolean(task.parentTaskId);
  const childTasks = task.childTasks ?? [];
  const hasChildTasks = childTasks.length > 0;

  if (!hasParent && !hasChildTasks) {
    return null;
  }

  const completedCount = childTasks.filter(
    (child) => child.status === "COMPLETED" || child.columnId === "done",
  ).length;
  const totalCount = childTasks.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className={`space-y-2.5 ${compact ? "px-2 py-2" : "px-3 py-2.5"}`}>
      {/* Parent task link */}
      {hasParent && (
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            {t.kanbanDetail.parentTask}
          </div>
          <button
            type="button"
            onClick={() => onViewTask?.(task.parentTaskId!)}
            className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:border-amber-300 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-200 dark:hover:border-amber-700 dark:hover:bg-amber-900/20"
            title={t.kanbanDetail.viewParentTask}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
            <span className="truncate max-w-[200px]">{task.parentTaskId!.slice(0, 8)}…</span>
          </button>
        </div>
      )}

      {/* Child tasks list */}
      {hasChildTasks && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            {t.kanbanDetail.childTasks}
          </div>
          <div className={`space-y-1 ${compact ? "" : "pl-0.5"}`}>
            {childTasks.map((child) => {
              const isCompleted = child.status === "COMPLETED" || child.columnId === "done";
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => onViewTask?.(child.id)}
                  className="flex w-full items-center gap-2 rounded border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-900/30 dark:hover:border-slate-600 dark:hover:bg-slate-800/50"
                >
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      isCompleted
                        ? "bg-emerald-500 dark:bg-emerald-400"
                        : "bg-slate-300 dark:bg-slate-600"
                    }`}
                  />
                  <span className={`flex-1 truncate text-sm ${isCompleted ? "text-slate-500 dark:text-slate-400 line-through" : "font-medium text-slate-800 dark:text-slate-200"}`}>
                    {child.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                    {isCompleted
                      ? t.kanbanDetail.childTaskCompleted
                      : child.columnId ?? child.status}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Progress bar */}
          {totalCount > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>{t.kanbanDetail.childTasksProgress.replace("{completed}", String(completedCount)).replace("{total}", String(totalCount))}</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/60">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all dark:bg-emerald-400"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface DependenciesPanelProps {
  task: TaskInfo;
  boardTasks: Array<{ id: string; title: string; status?: string; columnId?: string; dependencies?: string[] }>;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onOpenTask?: (taskId: string) => void;
}

export function DependenciesPanel({
  task,
  boardTasks,
  onPatchTask,
  onOpenTask,
}: DependenciesPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(false);

  const deps = task.dependencies ?? [];
  const blockedByTasks = useMemo(
    () => boardTasks.filter((bt) => (bt.dependencies ?? []).includes(task.id)),
    [boardTasks, task.id],
  );

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return boardTasks.slice(0, 20);
    const q = search.toLowerCase();
    return boardTasks.filter((bt) => bt.title.toLowerCase().includes(q)).slice(0, 20);
  }, [boardTasks, search]);

  const updateDeps = useCallback(
    async (next: string[]) => {
      setUpdating(true);
      try {
        await onPatchTask(task.id, { dependencies: next });
      } catch {
        // Error handling is done by the caller via toast
      } finally {
        setUpdating(false);
      }
    },
    [task.id, onPatchTask],
  );

  const removeDep = (depId: string) => {
    void updateDeps(deps.filter((id) => id !== depId));
  };

  const addDep = (depId: string) => {
    if (depId === task.id) return;
    if (deps.includes(depId)) return;
    void updateDeps([...deps, depId]);
    setSearch("");
  };

  const isTerminal = (status?: string) => status === "done" || status === "completed";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {t.kanbanDetail.dependsOnLabel}
        </span>
        {updating && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">…</span>
        )}
      </div>

      {deps.length > 0 ? (
        <div className="flex flex-col gap-1">
          {deps.map((depId) => {
            const depTask = boardTasks.find((bt) => bt.id === depId);
            const completed = isTerminal(depTask?.status);
            return (
              <div
                key={depId}
                className="group flex items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2 py-1.5 text-sm dark:border-slate-700/60 dark:bg-[#0d1018]"
              >
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    completed ? "bg-emerald-500" : "bg-amber-400"
                  }`}
                />
                {depTask && onOpenTask ? (
                  <button
                    type="button"
                    onClick={() => onOpenTask(depId)}
                    className="min-w-0 truncate text-slate-700 underline decoration-slate-300 underline-offset-2 transition hover:text-amber-600 dark:text-slate-200 dark:decoration-slate-600 dark:hover:text-amber-300"
                  >
                    {depTask.title}
                  </button>
                ) : (
                  <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                    {depTask?.title ?? depId.slice(0, 8)}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                  {completed ? "✓" : depTask?.columnId ?? ""}
                </span>
                <button
                  type="button"
                  onClick={() => removeDep(depId)}
                  className="shrink-0 rounded px-1 py-0.5 text-[10px] text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-900/20 dark:hover:text-rose-300"
                  title={t.kanbanDetail.removeDependency}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {t.kanbanDetail.noDependencies}
        </div>
      )}

      {/* Add dependency search */}
      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.kanbanDetail.dependencySearchPlaceholder}
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/40 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-100"
          disabled={updating}
        />
        {search.trim() && (
          <div className="absolute left-0 top-full z-10 mt-1 max-h-36 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-[#12141c]">
            {filteredTasks.length === 0 && (
              <div className="px-2.5 py-2 text-xs text-slate-400">{t.kanbanDetail.noDependencies}</div>
            )}
            {filteredTasks.map((bt) => {
              const isSelected = deps.includes(bt.id);
              const isSelf = bt.id === task.id;
              return (
                <button
                  key={bt.id}
                  type="button"
                  disabled={isSelected || isSelf}
                  onClick={() => addDep(bt.id)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                    isSelected || isSelf
                      ? "cursor-not-allowed text-slate-400 dark:text-slate-500"
                      : "text-slate-700 hover:bg-amber-50 dark:text-slate-200 dark:hover:bg-amber-900/10"
                  }`}
                >
                  <span className="min-w-0 truncate">{bt.title}</span>
                  {isSelf && (
                    <span className="shrink-0 text-[10px] text-slate-400">{t.kanbanDetail.dependencySelfReference}</span>
                  )}
                  {isSelected && !isSelf && (
                    <span className="shrink-0 text-[10px] text-slate-400">{t.kanbanDetail.dependencyAlreadyAdded}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Blocked by */}
      {blockedByTasks.length > 0 && (
        <div className="mt-2 border-t border-slate-200/70 pt-2 dark:border-slate-700/70">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {t.kanbanDetail.blockedByLabel}
          </div>
          <div className="flex flex-col gap-1">
            {blockedByTasks.map((bt) => (
              <div
                key={bt.id}
                className="flex items-center gap-2 rounded-lg border border-amber-200/70 bg-amber-50/50 px-2 py-1.5 text-xs dark:border-amber-900/30 dark:bg-amber-900/10"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                {onOpenTask ? (
                  <button
                    type="button"
                    onClick={() => onOpenTask(bt.id)}
                    className="min-w-0 truncate text-amber-700 underline decoration-amber-300 underline-offset-2 transition hover:text-amber-600 dark:text-amber-300 dark:decoration-amber-700"
                  >
                    {bt.title}
                  </button>
                ) : (
                  <span className="min-w-0 truncate text-amber-700 dark:text-amber-300">{bt.title}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
