"use client";

import { useEffect, useMemo, useState } from "react";
import type { AcpTaskAdaptiveHarnessOptions } from "@/client/acp-client";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { desktopAwareFetch, toErrorMessage } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";
import type { TaskAdaptiveHarnessPack, TaskAdaptiveMatchedFileDetail } from "@/core/harness/task-adaptive";
import type { TaskInfo } from "../types";
import { buildKanbanTaskAdaptiveHarnessOptions } from "./kanban-task-adaptive";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

function formatTimestamp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString();
}

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

function hasTaskAdaptiveSearchHints(options: AcpTaskAdaptiveHarnessOptions): boolean {
  return Boolean(
    options.query?.trim()
    || options.featureId?.trim()
    || (options.featureIds?.length ?? 0) > 0
    || (options.filePaths?.length ?? 0) > 0
    || (options.routeCandidates?.length ?? 0) > 0
    || (options.apiCandidates?.length ?? 0) > 0
    || (options.historySessionIds?.length ?? 0) > 0
    || (options.moduleHints?.length ?? 0) > 0
    || (options.symptomHints?.length ?? 0) > 0
  );
}

function getMatchedFileDetails(pack: TaskAdaptiveHarnessPack | null): TaskAdaptiveMatchedFileDetail[] {
  if (!pack) {
    return [];
  }

  if ((pack.matchedFileDetails?.length ?? 0) > 0) {
    return pack.matchedFileDetails;
  }

  return pack.selectedFiles.map((filePath) => ({
    filePath,
    changes: 0,
    sessions: 0,
    updatedAt: "",
  }));
}

function formatMatchConfidenceLabel(
  confidence: TaskAdaptiveHarnessPack["matchConfidence"] | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (confidence) {
    case "high":
      return t.kanbanDetail.matchConfidenceHigh;
    case "medium":
      return t.kanbanDetail.matchConfidenceMedium;
    case "low":
    default:
      return t.kanbanDetail.matchConfidenceLow;
  }
}

function formatMatchedFileSeed(fileDetail: TaskAdaptiveMatchedFileDetail): string {
  const stats: string[] = [];
  if (fileDetail.changes > 0) {
    stats.push(`changes ${fileDetail.changes}`);
  }
  if (fileDetail.sessions > 0) {
    stats.push(`sessions ${fileDetail.sessions}`);
  }
  return stats.length > 0 ? `${fileDetail.filePath} (${stats.join(", ")})` : fileDetail.filePath;
}

function buildJitContextSessionPrompt(
  task: TaskInfo,
  pack: TaskAdaptiveHarnessPack,
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[],
  specialistLanguage: KanbanSpecialistLanguage,
): string {
  const fileLines = matchedFileDetails.slice(0, 8).map((fileDetail, index) => `${index + 1}. ${formatMatchedFileSeed(fileDetail)}`);
  const warningLines = pack.warnings.slice(0, 3).map((warning) => `- ${warning}`);
  const failureLines = pack.failures.slice(0, 3).map((failure) => `- ${failure.message} [${failure.toolName}] (${failure.sessionId})`);
  const repeatedReadLines = pack.repeatedReadFiles.slice(0, 5).map((filePath) => `- ${filePath}`);
  const sessionLines = (pack.historySummary?.seedSessions ?? pack.sessions).slice(0, 3).map((session) => `- ${session.sessionId}: ${session.promptSnippet}`);
  const historySummary = pack.historySummary?.overview?.trim() || pack.summary;

  if (specialistLanguage === "zh-CN") {
    return [
      "继续当前 Kanban 卡片，不要复述下面的上下文，把它当作阅读和排查线索直接使用。",
      "",
      "卡片上下文：",
      `- 标题：${task.title}`,
      task.objective ? `- 目标：${task.objective}` : null,
      pack.featureName || pack.featureId ? `- 命中功能：${pack.featureName ?? pack.featureId}` : null,
      historySummary ? `- History Summary：${historySummary}` : null,
      "",
      fileLines.length > 0 ? "优先阅读文件：" : null,
      ...fileLines,
      "",
      warningLines.length > 0 ? "检索警告：" : null,
      ...warningLines,
      "",
      failureLines.length > 0 ? "历史问题：" : null,
      ...failureLines,
      "",
      repeatedReadLines.length > 0 ? "重复读取热点：" : null,
      ...repeatedReadLines,
      "",
      sessionLines.length > 0 ? "优先看的种子会话：" : null,
      ...sessionLines,
      "",
      "下一步：先阅读优先文件，再继续当前卡片最小的下一步实现、修复或验证动作。",
    ].filter(Boolean).join("\n");
  }

  return [
    "Continue the current Kanban card. Do not summarize the context back; use it as a reading and debugging seed.",
    "",
    "Card context:",
    `- Title: ${task.title}`,
    task.objective ? `- Objective: ${task.objective}` : null,
    pack.featureName || pack.featureId ? `- Matched feature: ${pack.featureName ?? pack.featureId}` : null,
    historySummary ? `- History summary: ${historySummary}` : null,
    "",
    fileLines.length > 0 ? "Read these files first:" : null,
    ...fileLines,
    "",
    warningLines.length > 0 ? "Retrieval warnings:" : null,
    ...warningLines,
    "",
    failureLines.length > 0 ? "Historical friction:" : null,
    ...failureLines,
    "",
    repeatedReadLines.length > 0 ? "Repeated-read hotspots:" : null,
    ...repeatedReadLines,
    "",
    sessionLines.length > 0 ? "Start from these history seed sessions:" : null,
    ...sessionLines,
    "",
    "Next: inspect the priority files first, then continue with the smallest useful implementation, debugging, or verification step for this card.",
  ].filter(Boolean).join("\n");
}

function buildHistorySummaryToolArgs(
  workspaceId: string | undefined,
  repoPath: string | null | undefined,
  harnessOptions: AcpTaskAdaptiveHarnessOptions,
): Record<string, unknown> {
  const toolArgs: Record<string, unknown> = {};

  if (workspaceId?.trim()) {
    toolArgs.workspaceId = workspaceId.trim();
  }
  if (repoPath?.trim()) {
    toolArgs.repoPath = repoPath.trim();
  }
  if (harnessOptions.taskLabel?.trim()) {
    toolArgs.taskLabel = harnessOptions.taskLabel.trim();
  }
  if (harnessOptions.locale?.trim()) {
    toolArgs.locale = harnessOptions.locale.trim();
  }
  if (harnessOptions.query?.trim()) {
    toolArgs.query = harnessOptions.query.trim();
  }
  if (harnessOptions.featureId?.trim()) {
    toolArgs.featureId = harnessOptions.featureId.trim();
  }
  if ((harnessOptions.featureIds?.length ?? 0) > 0) {
    toolArgs.featureIds = [...(harnessOptions.featureIds ?? [])];
  }
  if ((harnessOptions.filePaths?.length ?? 0) > 0) {
    toolArgs.filePaths = [...(harnessOptions.filePaths ?? [])];
  }
  if ((harnessOptions.routeCandidates?.length ?? 0) > 0) {
    toolArgs.routeCandidates = [...(harnessOptions.routeCandidates ?? [])];
  }
  if ((harnessOptions.apiCandidates?.length ?? 0) > 0) {
    toolArgs.apiCandidates = [...(harnessOptions.apiCandidates ?? [])];
  }
  if ((harnessOptions.historySessionIds?.length ?? 0) > 0) {
    toolArgs.historySessionIds = [...(harnessOptions.historySessionIds ?? [])];
  }
  if ((harnessOptions.moduleHints?.length ?? 0) > 0) {
    toolArgs.moduleHints = [...(harnessOptions.moduleHints ?? [])];
  }
  if ((harnessOptions.symptomHints?.length ?? 0) > 0) {
    toolArgs.symptomHints = [...(harnessOptions.symptomHints ?? [])];
  }
  if (harnessOptions.taskType) {
    toolArgs.taskType = harnessOptions.taskType;
  }
  if (typeof harnessOptions.maxFiles === "number") {
    toolArgs.maxFiles = harnessOptions.maxFiles;
  }
  if (typeof harnessOptions.maxSessions === "number") {
    toolArgs.maxSessions = harnessOptions.maxSessions;
  }
  if (harnessOptions.role?.trim()) {
    toolArgs.role = harnessOptions.role.trim();
  }

  return toolArgs;
}

function buildJitHistoryAnalysisPrompt(
  task: TaskInfo,
  pack: TaskAdaptiveHarnessPack,
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[],
  specialistLanguage: KanbanSpecialistLanguage,
  workspaceId: string | undefined,
  repoPath: string | null | undefined,
  harnessOptions: AcpTaskAdaptiveHarnessOptions,
): string {
  const toolArgs = buildHistorySummaryToolArgs(workspaceId, repoPath, harnessOptions);
  const toolArgsBlock = JSON.stringify(toolArgs, null, 2);
  const historySummary = pack.historySummary?.overview?.trim() || pack.summary.trim();
  const featureLine = pack.featureName ?? pack.featureId;
  const fileLines = matchedFileDetails
    .slice(0, 8)
    .map((fileDetail, index) => `${index + 1}. ${formatMatchedFileSeed(fileDetail)}`);
  const seedSessionLines = (pack.historySummary?.seedSessions ?? [])
    .slice(0, 5)
    .map((session, index) => `${index + 1}. ${session.sessionId}: ${session.promptSnippet}`);
  const warningLines = pack.warnings.slice(0, 4).map((warning) => `- ${warning}`);
  const reasonLines = pack.matchReasons.slice(0, 4).map((reason) => `- ${reason}`);

  if (specialistLanguage === "zh-CN") {
    return [
      "为这张 Kanban 卡片启动一次 History Summary 分析。",
      "",
      "先做这件事：",
      "1. 首先调用 `summarize_task_history_context`，参数如下：",
      "```json",
      toolArgsBlock,
      "```",
      "",
      "卡片上下文：",
      `- 标题：${task.title}`,
      task.objective ? `- 目标：${task.objective}` : null,
      featureLine ? `- 当前命中功能：${featureLine}` : null,
      historySummary ? `- 当前 History Summary：${historySummary}` : null,
      "",
      fileLines.length > 0 ? "当前候选文件：" : null,
      ...fileLines,
      "",
      seedSessionLines.length > 0 ? "当前种子会话：" : null,
      ...seedSessionLines,
      "",
      reasonLines.length > 0 ? "当前命中原因：" : null,
      ...reasonLines,
      "",
      warningLines.length > 0 ? "当前检索警告：" : null,
      ...warningLines,
      "",
      "输出要求：",
      "1. 解释这些种子会话到底提供了什么上下文，而不是复述全部 transcript。",
      "2. 区分“种子会话”和“最终命中会话”。",
      "3. 给出最值得继续深挖的 3-5 个会话或文件。",
      "4. 总结最高信号的历史问题、重复读取热点、路径/读取失败。",
      "5. 明确推荐下一次实现/规划会话应该注入哪些上下文。",
      "6. 产出 2-4 条可直接复用的后续提示词。",
      "",
      "除非摘要明显不足，否则不要重新通读全部 14 个会话。",
    ].filter(Boolean).join("\n");
  }

  return [
    "Start a History Summary analysis for this Kanban card.",
    "",
    "Do this first:",
    "1. Call `summarize_task_history_context` with the following arguments:",
    "```json",
    toolArgsBlock,
    "```",
    "",
    "Card context:",
    `- Title: ${task.title}`,
    task.objective ? `- Objective: ${task.objective}` : null,
    featureLine ? `- Current matched feature: ${featureLine}` : null,
    historySummary ? `- Current History Summary: ${historySummary}` : null,
    "",
    fileLines.length > 0 ? "Current candidate files:" : null,
    ...fileLines,
    "",
    seedSessionLines.length > 0 ? "Current seed sessions:" : null,
    ...seedSessionLines,
    "",
    reasonLines.length > 0 ? "Current match reasons:" : null,
    ...reasonLines,
    "",
    warningLines.length > 0 ? "Current retrieval warnings:" : null,
    ...warningLines,
    "",
    "Output requirements:",
    "1. Explain what these seed sessions actually contribute instead of replaying every transcript.",
    "2. Distinguish retrieval seeds from recovered file-grounded sessions.",
    "3. Recommend the top 3-5 sessions or files worth deeper follow-up.",
    "4. Summarize the highest-signal historical issues, repeated-read hotspots, and failed reads.",
    "5. State exactly what context should be injected into the next implementation or planning session.",
    "6. Produce 2-4 reusable follow-up prompts.",
    "",
    "Do not reread all linked sessions end to end unless the summary is clearly insufficient.",
  ].filter(Boolean).join("\n");
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

export function EvidenceBundlePanel({
  task,
  compact = false,
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
  const missingRequiredArtifacts = evidence.artifact.missingRequired ?? [];
  const missingRequired = missingRequiredArtifacts.length > 0
    ? missingRequiredArtifacts.join(", ")
    : t.kanbanDetail.none;
  const artifactBreakdown = Object.entries(evidence.artifact.byType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ") || t.kanbanDetail.none;

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        reviewable
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            reviewable
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
          }`}>
            {reviewable ? t.kanbanDetail.reviewable : t.kanbanDetail.reviewBlocked}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {t.kanbanDetail.requiredArtifacts}: {missingRequired}
          </span>
        </div>
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
        <SummaryGridItem
          label={t.kanbanDetail.requiredArtifacts}
          value={`${evidence.artifact.total}`}
          detail={artifactBreakdown}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.verification}
          value={evidence.verification.verdict ?? formatCheckStatus(evidence.verification.hasVerdict, t)}
          detail={evidence.verification.hasReport ? t.kanbanDetail.reportPresent : t.kanbanDetail.reportMissing}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.completion}
          value={evidence.completion.hasSummary ? t.kanbanDetail.summaryPresent : t.kanbanDetail.summaryMissing}
          compact={compact}
        />
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

export function JitContextPanel({
  task,
  workspaceId,
  repoPath,
  specialistLanguage,
  activeSessionId,
  onLoadIntoSession,
  onOpenHistoryAnalysis,
  compact = false,
  showTitle = false,
}: {
  task: TaskInfo;
  workspaceId?: string;
  repoPath?: string | null;
  specialistLanguage: KanbanSpecialistLanguage;
  activeSessionId?: string | null;
  onLoadIntoSession?: (sessionId: string, prompt: string) => Promise<void>;
  onOpenHistoryAnalysis?: (prompt: string) => Promise<void>;
  compact?: boolean;
  showTitle?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<TaskAdaptiveHarnessPack | null>(null);
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [injectSuccess, setInjectSuccess] = useState(false);
  const [openingAnalysis, setOpeningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSuccess, setAnalysisSuccess] = useState(false);
  const harnessOptions = useMemo(
    () => buildKanbanTaskAdaptiveHarnessOptions(task.title, {
      locale: specialistLanguage,
      role: task.assignedRole,
      task,
    }),
    [specialistLanguage, task],
  );
  const canLoadContext = hasTaskAdaptiveSearchHints(harnessOptions);
  const historicalIssueCount = (pack?.failures.length ?? 0) + (pack?.repeatedReadFiles.length ?? 0);
  const historySummary = pack?.historySummary ?? null;
  const historySeedSessionCount = historySummary?.seedSessionCount ?? 0;
  const recoveredSessionCount = pack?.sessions.length ?? 0;
  const matchedFileDetails = getMatchedFileDetails(pack);
  const matchedFileCount = matchedFileDetails.length;
  const matchConfidence = pack?.matchConfidence ?? "low";
  const matchReasons = pack?.matchReasons ?? [];
  const harnessSignature = useMemo(
    () => JSON.stringify(harnessOptions),
    [harnessOptions],
  );

  useEffect(() => {
    setExpanded(false);
    setLoading(false);
    setLoaded(false);
    setError(null);
    setPack(null);
    setInjecting(false);
    setInjectError(null);
    setInjectSuccess(false);
    setOpeningAnalysis(false);
    setAnalysisError(null);
    setAnalysisSuccess(false);
  }, [harnessSignature, repoPath, workspaceId]);

  const loadContext = async () => {
    if (loading) {
      return;
    }

    if (!workspaceId && !repoPath) {
      setPack(null);
      setLoaded(true);
      setError(t.kanbanDetail.jitContextUnavailable);
      return;
    }

    if (!canLoadContext) {
      setPack(null);
      setLoaded(true);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setInjectError(null);
    setInjectSuccess(false);
    setAnalysisError(null);
    setAnalysisSuccess(false);

    try {
      const response = await desktopAwareFetch("/api/harness/task-adaptive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          repoPath,
          taskAdaptiveHarness: harnessOptions,
        }),
      });
      const data = await response.json().catch(() => ({})) as TaskAdaptiveHarnessPack & { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(data.details ?? data.error ?? t.kanbanDetail.jitContextSearchFailed);
      }
      setPack(data);
      setLoaded(true);
    } catch (fetchError) {
      setPack(null);
      setLoaded(true);
      setError(toErrorMessage(fetchError));
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !loaded) {
      void loadContext();
    }
  };

  const handleLoadIntoSession = async () => {
    if (!pack || !activeSessionId || !onLoadIntoSession || injecting) {
      return;
    }

    setInjecting(true);
    setInjectError(null);
    setInjectSuccess(false);

    try {
      await onLoadIntoSession(
        activeSessionId,
        buildJitContextSessionPrompt(task, pack, matchedFileDetails, specialistLanguage),
      );
      setInjectSuccess(true);
    } catch (sessionError) {
      setInjectError(toErrorMessage(sessionError));
    } finally {
      setInjecting(false);
    }
  };

  const handleOpenHistoryAnalysis = async () => {
    if (!pack || !onOpenHistoryAnalysis || openingAnalysis) {
      return;
    }

    setOpeningAnalysis(true);
    setAnalysisError(null);
    setAnalysisSuccess(false);

    try {
      await onOpenHistoryAnalysis(
        buildJitHistoryAnalysisPrompt(
          task,
          pack,
          matchedFileDetails,
          specialistLanguage,
          workspaceId,
          repoPath,
          harnessOptions,
        ),
      );
      setAnalysisSuccess(true);
    } catch (sessionError) {
      setAnalysisError(toErrorMessage(sessionError));
    } finally {
      setOpeningAnalysis(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 ${compact ? "px-3 py-2" : "px-3.5 py-2.5"} dark:border-slate-700/70 dark:bg-slate-900/20`}>
        <div className="space-y-1">
          {showTitle ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.jitContext}
            </div>
          ) : null}
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {t.kanbanDetail.jitContextHint}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {loaded && pack ? (
              <>
                <span>{t.kanbanDetail.historicalIssues}: {historicalIssueCount}</span>
                <span>{t.kanbanDetail.historySeedSessions}: {historySeedSessionCount}</span>
                <span>{t.kanbanDetail.relatedSessions}: {recoveredSessionCount}</span>
                <span>{t.kanbanDetail.matchedFiles}: {matchedFileCount}</span>
              </>
            ) : (
              <span>{canLoadContext ? t.kanbanDetail.jitContextHint : t.kanbanDetail.jitContextNoHistorySessions}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {expanded && loaded && pack && onOpenHistoryAnalysis ? (
            <button
              type="button"
              onClick={() => {
                void handleOpenHistoryAnalysis();
              }}
              disabled={openingAnalysis}
              className="rounded-md border border-sky-200 px-2 py-1 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-900/50 dark:text-sky-300 dark:hover:bg-sky-900/20"
            >
              {openingAnalysis ? t.kanbanDetail.openingJitContextHistoryAnalysis : t.kanbanDetail.openJitContextHistoryAnalysis}
            </button>
          ) : null}
          {expanded && loaded && pack && activeSessionId && onLoadIntoSession ? (
            <button
              type="button"
              onClick={() => {
                void handleLoadIntoSession();
              }}
              disabled={injecting}
              className="rounded-md border border-emerald-200 px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
            >
              {injecting ? t.kanbanDetail.loadingJitContextIntoCurrentSession : t.kanbanDetail.loadJitContextIntoCurrentSession}
            </button>
          ) : null}
          {expanded && canLoadContext && loaded ? (
            <button
              type="button"
              onClick={() => {
                void loadContext();
              }}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t.kanbanDetail.refreshJitContext}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleExpanded}
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-expanded={expanded}
          >
            {expanded ? t.kanbanDetail.hideJitContext : t.kanbanDetail.showJitContext}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3">
          {analysisError ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-200">
              {analysisError}
            </div>
          ) : null}

          {analysisSuccess ? (
            <div className="rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 py-2.5 text-sm text-sky-700 dark:border-sky-900/50 dark:bg-sky-900/10 dark:text-sky-200">
              {t.kanbanDetail.jitContextHistoryAnalysisOpened}
            </div>
          ) : null}

          {injectError ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-200">
              {injectError}
            </div>
          ) : null}

          {injectSuccess ? (
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-3 py-2.5 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/10 dark:text-emerald-200">
              {t.kanbanDetail.jitContextLoadedIntoCurrentSession}
            </div>
          ) : null}

          {loading ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.loadingJitContext}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-200">
              {error}
            </div>
          ) : !canLoadContext ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.jitContextNoHistorySessions}
            </div>
          ) : !pack || (pack.failures.length === 0 && pack.repeatedReadFiles.length === 0 && pack.sessions.length === 0 && matchedFileDetails.length === 0 && pack.warnings.length === 0 && !pack.historySummary) ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.noJitContext}
            </div>
          ) : (
            <>
              {historySummary ? (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.historySummary}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
                    {historySummary.overview}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{t.kanbanDetail.historySeedSessions}: {historySummary.seedSessionCount}</span>
                    <span>{t.kanbanDetail.relatedSessions}: {historySummary.recoveredSessionCount}</span>
                    <span>{t.kanbanDetail.matchedFiles}: {historySummary.matchedFileCount}</span>
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.matchConfidence}
                </div>
                <div className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                  {formatMatchConfidenceLabel(matchConfidence, t)}
                </div>
                {matchReasons.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      {t.kanbanDetail.matchReasons}
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                      {matchReasons.map((reason) => (
                        <div key={reason}>{reason}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {historySummary && historySummary.seedSessions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.historySeedSessions}
                  </div>
                  <div className="space-y-2">
                    {historySummary.seedSessions.map((session) => (
                      <div
                        key={`seed:${session.sessionId}`}
                        className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                          <span>{session.sessionId}</span>
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            {session.provider}
                          </span>
                          {formatTimestamp(session.updatedAt) ? (
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                              {formatTimestamp(session.updatedAt)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                          {session.promptSnippet}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {session.failedReadSignals.length > 0 ? (
                            <span>{t.kanbanDetail.historicalIssues}: {session.failedReadSignals.length}</span>
                          ) : null}
                          {session.repeatedReadFiles.length > 0 ? (
                            <span>{t.kanbanDetail.repeatedReadHotspots}: {session.repeatedReadFiles.length}</span>
                          ) : null}
                          {session.toolNames.length > 0 ? (
                            <span>{session.toolNames.join(", ")}</span>
                          ) : null}
                        </div>
                        {session.touchedFiles.length > 0 ? (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {t.kanbanDetail.matchedFiles}: {session.touchedFiles.join(", ")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {pack.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-900/10">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                    {t.kanbanDetail.warnings}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-100">
                    {pack.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.historicalIssues}
                </div>
                {pack.failures.length > 0 ? (
                  <div className="space-y-2">
                    {pack.failures.map((failure) => (
                      <div
                        key={`${failure.sessionId}:${failure.toolName}:${failure.message}`}
                        className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-900/10"
                      >
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {failure.message}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {failure.sessionId} · {failure.toolName}
                        </div>
                        {failure.command ? (
                          <div className="mt-2 rounded-md bg-white/80 px-2 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-950/60 dark:text-slate-300">
                            {failure.command}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
                    {t.kanbanDetail.noHistoricalIssues}
                  </div>
                )}

                {pack.repeatedReadFiles.length > 0 ? (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      {t.kanbanDetail.repeatedReadHotspots}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pack.repeatedReadFiles.map((filePath) => (
                        <span
                          key={filePath}
                          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300"
                        >
                          {filePath}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {matchedFileDetails.length > 0 ? (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                  {(pack.featureName || pack.featureId) ? (
                    <div className="mb-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        {t.kanbanDetail.matchedFeature}
                      </div>
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                        <span>{pack.featureName ?? pack.featureId}</span>
                        {pack.featureName && pack.featureId ? (
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {pack.featureId}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.matchedFiles}
                  </div>
                  <div className="mt-2 space-y-2">
                    {matchedFileDetails.map((fileDetail) => (
                      <div
                        key={fileDetail.filePath}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60"
                      >
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                          {fileDetail.filePath}
                        </div>
                        {(fileDetail.changes > 0 || fileDetail.sessions > 0 || fileDetail.updatedAt) ? (
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {fileDetail.changes > 0 ? (
                              <span>{t.kanbanDetail.changes}: {fileDetail.changes}</span>
                            ) : null}
                            {fileDetail.sessions > 0 ? (
                              <span>{t.trace.sessions}: {fileDetail.sessions}</span>
                            ) : null}
                            {fileDetail.updatedAt ? (
                              <span>{t.kanbanDetail.updatedAt}: {formatTimestamp(fileDetail.updatedAt) ?? fileDetail.updatedAt}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {pack.sessions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.relatedSessions}
                  </div>
                  <div className="space-y-2">
                    {pack.sessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                          <span>{session.sessionId}</span>
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            {session.provider}
                          </span>
                          {formatTimestamp(session.updatedAt) ? (
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                              {formatTimestamp(session.updatedAt)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                          {session.promptSnippet}
                        </div>
                        {session.matchedFiles.length > 0 ? (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {t.kanbanDetail.matchedFiles}: {session.matchedFiles.join(", ")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
