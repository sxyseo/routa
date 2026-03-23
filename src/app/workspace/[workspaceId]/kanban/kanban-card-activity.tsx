"use client";

import { useState, type ReactNode } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import type { KanbanColumnInfo } from "../types";
import type { SessionInfo, TaskInfo } from "../types";
import {
  buildSessionDisplayLabel,
  createKanbanSpecialistResolver,
  formatSessionTimestamp,
  getLaneSessionStepLabel,
  getOrderedSessionIds,
  getSpecialistName,
  type KanbanSpecialistOption,
} from "./kanban-card-session-utils";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";
import { getKanbanSessionCopy } from "./i18n/kanban-session-copy";

type ActivityTabId = "runs" | "handoffs" | "github";

function ActivitySection({
  title,
  description,
  children,
  compact = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`border border-gray-200/80 bg-white shadow-sm dark:border-[#232736] dark:bg-[#121620] ${compact ? "rounded-2xl p-3" : "rounded-3xl p-4"}`}>
      <div className={compact ? "mb-2" : "mb-3"}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">{title}</div>
        {description && (
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</div>
        )}
      </div>
      {children}
    </section>
  );
}

export function KanbanCardActivityPanel({
  task,
  sessions,
  specialists,
  specialistLanguage = "en",
  currentSessionId,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  sessions: SessionInfo[];
  specialists: KanbanSpecialistOption[];
  specialistLanguage?: KanbanSpecialistLanguage;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const copy = getKanbanSessionCopy(specialistLanguage);
  const tabs: Array<{ id: ActivityTabId; label: string; count?: number }> = [
    { id: "runs", label: copy.runs, count: getOrderedSessionIds(task).length },
    ...((task.laneHandoffs?.length ?? 0) > 0 ? [{ id: "handoffs" as const, label: copy.handoffs, count: task.laneHandoffs?.length }] : []),
    ...(task.githubNumber ? [{ id: "github" as const, label: "GitHub" }] : []),
  ];
  const [activeTab, setActiveTab] = useState<ActivityTabId>(tabs[0]?.id ?? "runs");
  const visibleTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? "runs");

  return (
    <ActivitySection
      title={copy.activityTitle}
      description={compact ? undefined : copy.activityDescription}
      compact={compact}
    >
      <div>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200"
                    : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-amber-200/70 text-amber-900 dark:bg-amber-800/50 dark:text-amber-100" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className={compact ? "mt-3" : "mt-4"}>
          {visibleTab === "runs" && (
            <SessionHistoryPanel
              task={task}
              specialists={specialists}
              sessions={sessions}
              specialistLanguage={specialistLanguage}
              currentSessionId={currentSessionId}
              onSelectSession={onSelectSession}
              compact={compact}
            />
          )}
          {visibleTab === "handoffs" && (
            <HandoffPanel
              task={task}
              compact={compact}
            />
          )}
          {visibleTab === "github" && (
            <GitHubPanel task={task} compact={compact} />
          )}
        </div>
      </div>
    </ActivitySection>
  );
}

export function KanbanCardActivityBar({
  task,
  sessions = [],
  specialistLanguage = "en",
  currentSessionId,
  onSelectSession,
  onCloseSession,
}: {
  task: TaskInfo;
  sessions?: SessionInfo[];
  specialistLanguage?: KanbanSpecialistLanguage;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  onCloseSession?: () => void;
}) {
  const copy = getKanbanSessionCopy(specialistLanguage);
  const orderedSessionIds = getOrderedSessionIds(task);
  const laneSessions = task.laneSessions ?? [];
  const laneSessionMap = new Map(laneSessions.map((entry) => [entry.sessionId, entry]));
  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const selectedRunId = currentSessionId && orderedSessionIds.includes(currentSessionId)
    ? currentSessionId
    : orderedSessionIds[orderedSessionIds.length - 1];
  const selectedLaneSession = selectedRunId ? laneSessionMap.get(selectedRunId) : undefined;
  const selectedStepLabel = getLaneSessionStepLabel(selectedLaneSession);

  if (orderedSessionIds.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-gray-300 bg-white/90 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-[#121620] dark:text-gray-400">
        <span>{copy.noRunsInline}</span>
        {onCloseSession && (
          <button
            type="button"
            onClick={onCloseSession}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-500 transition-colors hover:border-gray-300 hover:bg-white hover:text-gray-800 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-[#131826] dark:hover:text-gray-200"
            aria-label={copy.closeSessionPane}
            title={copy.closeSessionPane}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white/95 px-3 pt-2 pb-2 shadow-sm dark:border-[#232736] dark:bg-[#121620]">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5">
          {orderedSessionIds.map((sessionId, index) => {
            const active = sessionId === selectedRunId;
            const laneSession = laneSessionMap.get(sessionId);
            const laneLabel = laneSession?.columnName ?? laneSession?.columnId ?? "Run";
            const runLabel = buildSessionDisplayLabel(sessionId, index, sessionMap);

            return (
              <button
                key={sessionId}
                type="button"
                onClick={() => onSelectSession?.(sessionId)}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-t-lg border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-gray-300 border-b-white bg-white text-gray-900 dark:border-[#3b4158] dark:border-b-[#121620] dark:bg-[#161b27] dark:text-gray-100"
                    : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-white hover:text-gray-800 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-[#131826] dark:hover:text-gray-200"
                }`}
                aria-pressed={active}
                title={`${laneLabel} · Run ${index + 1} (${runLabel})`}
              >
                <span className="truncate font-semibold">{laneLabel}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                  active
                    ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    : "bg-white text-gray-500 dark:bg-[#141926] dark:text-gray-400"
                }`}>
                  #{index + 1}
                </span>
              </button>
            );
          })}
        </div>
        {onCloseSession && (
          <button
            type="button"
            onClick={onCloseSession}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-500 transition-colors hover:border-gray-300 hover:bg-white hover:text-gray-800 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-[#131826] dark:hover:text-gray-200"
            aria-label={copy.closeSessionPane}
            title={copy.closeSessionPane}
          >
            ×
          </button>
        )}
      </div>
      {(selectedLaneSession?.columnName || selectedStepLabel || selectedLaneSession?.status) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-200/80 pt-2 text-[10px] dark:border-[#232736]">
          {selectedLaneSession?.columnName && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
              {selectedLaneSession.columnName}
            </span>
          )}
          {selectedStepLabel && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {selectedStepLabel}
            </span>
          )}
          {selectedLaneSession?.status && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              {selectedLaneSession.status}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SessionHistoryPanel({
  task,
  specialists,
  sessions,
  specialistLanguage = "en",
  currentSessionId,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  specialists: KanbanSpecialistOption[];
  sessions: SessionInfo[];
  specialistLanguage?: KanbanSpecialistLanguage;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const copy = getKanbanSessionCopy(specialistLanguage);
  const laneSessions = task.laneSessions ?? [];
  const orderedSessionIds = getOrderedSessionIds(task);

  if (orderedSessionIds.length === 0) {
    return (
      <div className={`rounded-2xl border border-dashed border-gray-300 bg-white text-sm text-gray-500 dark:border-gray-700 dark:bg-[#121620] dark:text-gray-400 ${compact ? "px-3 py-4" : "px-4 py-5"}`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">{copy.runHistoryTitle}</div>
        <div className="mt-2">{copy.noRunsHistory} {copy.noRunsHistoryHint}</div>
      </div>
    );
  }

  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const laneSessionMap = new Map(laneSessions.map((entry) => [entry.sessionId, entry]));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">{copy.runHistoryTitle}</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {copy.runHistoryCount(orderedSessionIds.length)}
          </div>
        </div>
        <div className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600 shadow-sm dark:bg-[#0d1018] dark:text-gray-300">
          Current lane: {task.columnId ?? "backlog"}
        </div>
      </div>
      <div className={`overflow-y-auto pr-1 ${compact ? "mt-3 max-h-80 space-y-1.5" : "mt-4 max-h-[34rem] space-y-2"}`}>
        {orderedSessionIds.map((sessionId, index) => {
          const session = sessionMap.get(sessionId);
          const isCurrent = sessionId === currentSessionId;
          const laneSession = laneSessionMap.get(sessionId);
          const laneSpecialist = getSpecialistName(
            laneSession?.specialistId,
            laneSession?.specialistName,
            specialists,
          );
          const stepLabel = getLaneSessionStepLabel(laneSession);

          return (
            <button
              key={sessionId}
              onClick={() => onSelectSession?.(sessionId)}
              className={`w-full rounded-xl border text-left transition-colors ${compact ? "px-2.5 py-2" : "px-3 py-2.5"} ${
                isCurrent
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-[#191c28]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  Run {index + 1}
                </span>
                {laneSession?.columnName && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                    {laneSession.columnName}
                  </span>
                )}
                {stepLabel && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {stepLabel}
                  </span>
                )}
                {isCurrent && (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-800/40 dark:text-amber-200">
                    Active
                  </span>
                )}
                {laneSession?.status && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                    {laneSession.status}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`truncate font-medium text-gray-900 dark:text-gray-100 ${compact ? "text-[13px]" : "text-sm"}`}>
                    {session?.name ?? session?.provider ?? "ACP Session"}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {(laneSession?.provider ?? session?.provider ?? "Unknown provider")} · {(laneSession?.role ?? session?.role ?? "Unknown role")} · {laneSpecialist}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                    {formatSessionTimestamp(session?.createdAt)}
                  </div>
                </div>
                <span className={`shrink-0 rounded-lg bg-gray-100 font-mono text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300 ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`}>
                  {sessionId.slice(0, 8)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-gray-500 dark:text-gray-400">
                <span className="truncate">{session?.cwd ?? "Working directory unavailable"}</span>
                <span className="font-medium text-amber-600 dark:text-amber-300">Open</span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function KanbanEmptySessionPane({
  task,
  boardColumns,
  availableProviders,
  specialists,
  specialistLanguage = "en",
  onCloseSession,
}: {
  task: TaskInfo;
  boardColumns: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  specialists: KanbanSpecialistOption[];
  specialistLanguage?: KanbanSpecialistLanguage;
  onCloseSession?: () => void;
}) {
  const copy = getKanbanSessionCopy(specialistLanguage);
  const resolveSpecialist = createKanbanSpecialistResolver(specialists);
  const effectiveAutomation = resolveEffectiveTaskAutomation(task, boardColumns, resolveSpecialist);
  const providerName = effectiveAutomation.providerId
    ? availableProviders.find((provider) => provider.id === effectiveAutomation.providerId)?.name ?? effectiveAutomation.providerId
    : "Workspace default";
  const specialistName = getSpecialistName(
    effectiveAutomation.specialistId,
    effectiveAutomation.specialistName,
    specialists,
  );
  const target = `${providerName} · ${effectiveAutomation.role ?? "DEVELOPER"} · ${specialistName}`;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-gray-200/80 bg-gray-50/80 p-2 dark:border-[#202433] dark:bg-[#10131a]">
        <KanbanCardActivityBar
          task={task}
          specialistLanguage={specialistLanguage}
          onCloseSession={onCloseSession}
        />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gradient-to-br from-white via-sky-50/40 to-amber-50/40 p-6 dark:from-[#12141c] dark:via-[#101824] dark:to-[#17131c]">
        <div className="w-full max-w-lg rounded-3xl border border-sky-200/70 bg-white/95 p-6 shadow-sm dark:border-sky-900/40 dark:bg-[#121620]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-600 dark:text-sky-300">{copy.emptyPaneEyebrow}</div>
          <div className="mt-2 text-xl font-semibold text-gray-950 dark:text-gray-50">{copy.emptyPaneTitle}</div>
          <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{copy.emptyPaneDescription}</p>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{copy.emptyPaneHint}</p>
          <div className="mt-4 rounded-2xl border border-dashed border-sky-300 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-900/20 dark:text-sky-100">
            {copy.expectedTarget(target)}
          </div>
        </div>
      </div>
    </div>
  );
}

function HandoffPanel({ task, compact = false }: { task: TaskInfo; compact?: boolean }) {
  const handoffs = task.laneHandoffs ?? [];
  if (handoffs.length === 0) {
    return (
      <div className={`rounded-2xl border border-dashed border-gray-300 bg-white text-sm text-gray-500 dark:border-gray-700 dark:bg-[#121620] dark:text-gray-400 ${compact ? "px-3 py-4" : "px-4 py-5"}`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Lane Handoffs</div>
        <div className="mt-2">No lane handoffs were captured for this card yet.</div>
      </div>
    );
  }

  const orderedHandoffs = handoffs.slice().sort((left, right) => (
    new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime()
  ));

  return (
    <>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Lane Handoffs</div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Requests and responses exchanged between adjacent Kanban lanes.
        </div>
      </div>
      <div className={`space-y-2 ${compact ? "mt-3" : "mt-4"}`}>
        {orderedHandoffs.map((handoff) => (
          <div
            key={handoff.id}
            className={`rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-[#0d1018] ${compact ? "px-3 py-2" : "px-3 py-3"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                {handoff.requestType.replace(/_/g, " ")}
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                {handoff.status}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-800 dark:text-gray-200">{handoff.request}</div>
            {handoff.responseSummary && (
              <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-200">
                {handoff.responseSummary}
              </div>
            )}
            <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              Requested {formatSessionTimestamp(handoff.requestedAt)}{handoff.respondedAt ? ` · Responded ${formatSessionTimestamp(handoff.respondedAt)}` : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function GitHubPanel({ task, compact = false }: { task: TaskInfo; compact?: boolean }) {
  if (!task.githubNumber) {
    return null;
  }

  return (
    <div className={`rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-[#0d1018] ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">GitHub</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          {task.githubState ?? "linked"}
        </span>
        {task.githubRepo && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{task.githubRepo}</span>
        )}
      </div>
      <a
        href={task.githubUrl}
        target="_blank"
        rel="noreferrer"
        className={`mt-3 inline-flex text-amber-600 hover:underline dark:text-amber-400 ${compact ? "text-[13px]" : "text-sm"}`}
      >
        #{task.githubNumber}
      </a>
      {task.githubSyncedAt && (
        <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
          Synced {formatSessionTimestamp(task.githubSyncedAt)}
        </div>
      )}
    </div>
  );
}
