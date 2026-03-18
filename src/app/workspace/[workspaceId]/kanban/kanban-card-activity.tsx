"use client";

import { useState, type ReactNode } from "react";
import type { SessionInfo, TaskInfo } from "../types";
import {
  buildSessionDisplayLabel,
  formatSessionTimestamp,
  getLaneSessionStepLabel,
  getOrderedSessionIds,
  getSpecialistName,
  type KanbanSpecialistOption,
} from "./kanban-card-session-utils";

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
  currentSessionId,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  sessions: SessionInfo[];
  specialists: KanbanSpecialistOption[];
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const tabs: Array<{ id: ActivityTabId; label: string; count?: number }> = [
    { id: "runs", label: "Runs", count: getOrderedSessionIds(task).length },
    ...((task.laneHandoffs?.length ?? 0) > 0 ? [{ id: "handoffs" as const, label: "Handoffs", count: task.laneHandoffs?.length }] : []),
    ...(task.githubNumber ? [{ id: "github" as const, label: "GitHub" }] : []),
  ];
  const [activeTab, setActiveTab] = useState<ActivityTabId>(tabs[0]?.id ?? "runs");
  const visibleTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? "runs");

  return (
    <ActivitySection
      title="Activity"
      description={compact ? undefined : "Run history, lane handoffs, and issue linkage collected on the right for faster switching."}
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
  currentSessionId,
  onSelectSession,
}: {
  task: TaskInfo;
  sessions?: SessionInfo[];
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
}) {
  const orderedSessionIds = getOrderedSessionIds(task);
  const laneSessions = task.laneSessions ?? [];
  const laneSessionMap = new Map(laneSessions.map((entry) => [entry.sessionId, entry]));
  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const selectedRunId = currentSessionId && orderedSessionIds.includes(currentSessionId)
    ? currentSessionId
    : orderedSessionIds[orderedSessionIds.length - 1];

  if (orderedSessionIds.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white/90 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-[#121620] dark:text-gray-400">
        No ACP runs yet
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white/95 px-3 py-2 shadow-sm dark:border-[#232736] dark:bg-[#121620]">
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-center gap-1.5">
          {orderedSessionIds.map((sessionId, index) => {
            const active = sessionId === selectedRunId;
            const laneSession = laneSessionMap.get(sessionId);
            const laneLabel = laneSession?.columnName ?? laneSession?.columnId;
            const stepLabel = getLaneSessionStepLabel(laneSession);
            const runLabel = buildSessionDisplayLabel(sessionId, index, sessionMap);

            return (
              <button
                key={sessionId}
                type="button"
                onClick={() => onSelectSession?.(sessionId)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200"
                    : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400 dark:hover:text-gray-200"
                }`}
                aria-pressed={active}
                title={`${runLabel} (${sessionId.slice(0, 8)})`}
              >
                <span className="max-w-36 truncate">{runLabel}</span>
                {laneLabel && (
                  <span className={`max-w-24 truncate rounded-full px-1.5 py-0.5 text-[10px] ${
                    active
                      ? "bg-amber-200/70 text-amber-900 dark:bg-amber-800/50 dark:text-amber-100"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  }`}>
                    {laneLabel}
                  </span>
                )}
                {stepLabel && (
                  <span className={`max-w-28 truncate rounded-full px-1.5 py-0.5 text-[10px] ${
                    active
                      ? "bg-sky-200/70 text-sky-900 dark:bg-sky-800/50 dark:text-sky-100"
                      : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                  }`}>
                    {stepLabel}
                  </span>
                )}
                {laneSession?.status && active && (
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                    {laneSession.status}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SessionHistoryPanel({
  task,
  specialists,
  sessions,
  currentSessionId,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  specialists: KanbanSpecialistOption[];
  sessions: SessionInfo[];
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const laneSessions = task.laneSessions ?? [];
  const orderedSessionIds = getOrderedSessionIds(task);

  if (orderedSessionIds.length === 0) {
    return (
      <div className={`rounded-2xl border border-dashed border-gray-300 bg-white text-sm text-gray-500 dark:border-gray-700 dark:bg-[#121620] dark:text-gray-400 ${compact ? "px-3 py-4" : "px-4 py-5"}`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Run History</div>
        <div className="mt-2">No ACP runs yet. Once this card enters an automated lane, each run will show up here.</div>
      </div>
    );
  }

  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const laneSessionMap = new Map(laneSessions.map((entry) => [entry.sessionId, entry]));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Run History</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {orderedSessionIds.length} recorded automation runs for this card.
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
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
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
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
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
