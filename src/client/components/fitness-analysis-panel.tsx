"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";

import { FitnessAnalysisContent } from "./fitness-analysis-content";
import {
  PROFILE_DEFS,
  PROFILE_ORDER,
  VIEW_MODES,
  buildAnalysisPayload,
  buildAnalysisQuery,
  clampPercent,
  formatDuration,
  formatTime,
  normalizeApiResponse,
  profileStateTone,
  readinessBarTone,
  type AnalyzeResponse,
  type FitnessProfile,
  type FitnessProfileState,
  type ProfilePanelState,
  type ViewMode,
  toMessage,
} from "./fitness-analysis-types";

type FitnessAnalysisPanelProps = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
  codebaseLabel?: string;
};

const EMPTY_STATE: Record<FitnessProfile, ProfilePanelState> = {
  generic: { state: "idle" },
  agent_orchestrator: { state: "idle" },
};

function StatusBadge({ state }: { state: FitnessProfileState }) {
  const labels: Record<FitnessProfileState, string> = {
    idle: "待运行",
    loading: "分析中",
    ready: "已就绪",
    empty: "未生成",
    error: "异常",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${profileStateTone(state)}`}>
      {labels[state]}
    </span>
  );
}

export function FitnessAnalysisPanel({
  workspaceId,
  codebaseId,
  repoPath,
  codebaseLabel,
}: FitnessAnalysisPanelProps) {
  const [selectedProfile, setSelectedProfile] = useState<FitnessProfile>("generic");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [compareLast, setCompareLast] = useState(true);
  const [noSave, setNoSave] = useState(false);
  const [profiles, setProfiles] = useState<Record<FitnessProfile, ProfilePanelState>>(EMPTY_STATE);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);

  const hasContext = Boolean(workspaceId?.trim() || codebaseId?.trim() || repoPath?.trim());
  const contextQuery = buildAnalysisQuery({ workspaceId, codebaseId, repoPath });
  const contextPayload = buildAnalysisPayload({ workspaceId, codebaseId, repoPath });
  const contextLabel = codebaseLabel || repoPath || null;

  const selectedState = profiles[selectedProfile];
  const peerProfile = selectedProfile === "generic" ? "agent_orchestrator" : "generic";
  const peerState = profiles[peerProfile];

  const applyProfiles = useCallback((entries: ReturnType<typeof normalizeApiResponse>) => {
    setProfiles((current) => {
      const next = { ...current };

      for (const profile of PROFILE_ORDER) {
        const entry = entries.find((item) => item.profile === profile);

        if (!entry) {
          next[profile] = {
            ...next[profile],
            state: "empty",
            error: `${new Date().toLocaleTimeString()} 未返回结果`,
          };
          continue;
        }

        if (entry.status === "ok" && entry.report) {
          next[profile] = {
            state: "ready",
            source: entry.source,
            durationMs: entry.durationMs,
            report: entry.report,
            console: entry.console ?? next[profile].console,
            updatedAt: entry.report.generatedAt,
          };
          continue;
        }

        if (entry.status === "missing") {
          next[profile] = {
            state: "empty",
            source: entry.source,
            console: entry.console ?? next[profile].console,
            error: entry.error ?? "暂无快照",
          };
          continue;
        }

        next[profile] = {
          state: "error",
          source: entry.source,
          durationMs: entry.durationMs,
          console: entry.console ?? next[profile].console,
          error: entry.error ?? "分析失败",
        };
      }

      return next;
    });

    setGlobalError(null);
  }, []);

  const syncProfiles = useCallback(async () => {
    if (!hasContext) {
      setProfiles(EMPTY_STATE);
      setLastSnapshotAt(null);
      setGlobalError("请先选择要分析的 Workspace 与 Repository");
      return;
    }

    setGlobalError(null);

    try {
      const reportUrl = contextQuery ? `/api/fitness/report?${contextQuery}` : "/api/fitness/report";
      const response = await desktopAwareFetch(reportUrl, { cache: "no-store" });

      if (!response.ok) {
        const body = await response.text();
        setGlobalError(`获取快照失败: ${response.status} ${body}`);
        return;
      }

      const raw = await response.json().catch(() => null);
      if (raw && typeof raw === "object" && typeof (raw as { generatedAt?: unknown }).generatedAt === "string") {
        setLastSnapshotAt((raw as { generatedAt: string }).generatedAt);
      } else {
        setLastSnapshotAt(new Date().toLocaleString());
      }

      applyProfiles(normalizeApiResponse(raw));
    } catch (error) {
      setGlobalError(`获取快照失败: ${toMessage(error)}`);
    }
  }, [applyProfiles, contextQuery, hasContext]);

  useEffect(() => {
    queueMicrotask(() => {
      void syncProfiles();
    });
  }, [syncProfiles]);

  const runProfiles = useCallback(async (targetProfiles: FitnessProfile[]) => {
    if (targetProfiles.length === 0) {
      return;
    }

    if (!hasContext) {
      const message = "请先在上方选择 Workspace 与 Repository";
      setGlobalError(message);
      setProfiles((current) => {
        const next = { ...current };
        for (const profile of targetProfiles) {
          next[profile] = {
            ...next[profile],
            state: "error",
            source: "analysis",
            error: message,
          };
        }
        return next;
      });
      return;
    }

    setGlobalError(null);
    setProfiles((current) => {
      const next = { ...current };
      for (const profile of targetProfiles) {
        next[profile] = {
          ...next[profile],
          state: "loading",
          error: undefined,
          updatedAt: new Date().toLocaleString(),
        };
      }
      return next;
    });

    try {
      const response = await desktopAwareFetch("/api/fitness/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profiles: targetProfiles,
          compareLast,
          noSave,
          ...contextPayload,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        const message = `执行失败: ${response.status} ${body || "空响应"}`;
        setGlobalError(message);
        setProfiles((current) => {
          const next = { ...current };
          for (const profile of targetProfiles) {
            next[profile] = {
              state: "error",
              source: "analysis",
              error: message,
            };
          }
          return next;
        });
        return;
      }

      const payload: AnalyzeResponse = await response.json().catch(() => ({
        generatedAt: new Date().toISOString(),
        requestedProfiles: targetProfiles,
        profiles: [],
      }));

      applyProfiles(normalizeApiResponse(payload));
      setLastSnapshotAt(payload.generatedAt);
    } catch (error) {
      const message = `执行失败: ${toMessage(error)}`;
      setGlobalError(message);
      setProfiles((current) => {
        const next = { ...current };
        for (const profile of targetProfiles) {
          next[profile] = {
            state: "error",
            source: "analysis",
            error: message,
          };
        }
        return next;
      });
    }
  }, [applyProfiles, compareLast, contextPayload, hasContext, noSave]);

  const onRunSelectedProfile = useCallback(() => {
    void runProfiles([selectedProfile]);
  }, [runProfiles, selectedProfile]);

  const onRunAllProfiles = useCallback(() => {
    void runProfiles([...PROFILE_ORDER]);
  }, [runProfiles]);

  const selectedDef = PROFILE_DEFS.find((item) => item.id === selectedProfile) ?? PROFILE_DEFS[0];
  const selectedReport = selectedState.report;
  const peerReport = peerState.report;
  const peerDelta = useMemo(() => {
    if (!selectedReport || !peerReport) {
      return null;
    }

    return clampPercent(selectedReport.currentLevelReadiness) - clampPercent(peerReport.currentLevelReadiness);
  }, [peerReport, selectedReport]);

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Profiles</div>
          <div className="mt-3 space-y-3">
            {PROFILE_DEFS.map((profile) => {
              const state = profiles[profile.id];
              const report = state.report;
              const active = profile.id === selectedProfile;
              const score = clampPercent(report?.currentLevelReadiness ?? 0);

              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfile(profile.id)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    active
                      ? "border-desktop-accent bg-desktop-bg-primary shadow-sm"
                      : "border-desktop-border bg-white/70 hover:bg-desktop-bg-primary/80 dark:bg-white/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-desktop-text-primary">{profile.name}</div>
                      <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{profile.focus}</div>
                    </div>
                    <StatusBadge state={state.state} />
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-desktop-bg-secondary">
                    <div className={`h-full rounded-full ${readinessBarTone(report?.currentLevelReadiness ?? 0)}`} style={{ width: `${score}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-desktop-text-secondary">
                    <span>{report?.overallLevelName ?? "未分析"}</span>
                    <span>{score}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Execution</div>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={onRunSelectedProfile}
              disabled={!hasContext || selectedState.state === "loading"}
              className="w-full rounded-full bg-desktop-accent px-4 py-2 text-sm font-semibold text-desktop-text-on-accent disabled:opacity-60"
            >
              运行当前 Profile
            </button>
            <button
              type="button"
              onClick={onRunAllProfiles}
              disabled={!hasContext || profiles.generic.state === "loading" || profiles.agent_orchestrator.state === "loading"}
              className="w-full rounded-full border border-desktop-border px-4 py-2 text-sm font-semibold text-desktop-text-primary hover:bg-desktop-bg-primary/80 disabled:opacity-60"
            >
              同时运行两套
            </button>
            <button
              type="button"
              onClick={() => void syncProfiles()}
              disabled={!hasContext}
              className="w-full rounded-full border border-desktop-border px-4 py-2 text-sm font-semibold text-desktop-text-primary hover:bg-desktop-bg-primary/80 disabled:opacity-60"
            >
              刷新快照
            </button>
          </div>
          <div className="mt-4 space-y-2 text-[11px] text-desktop-text-secondary">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={compareLast}
                onChange={(event) => setCompareLast(event.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-300 text-desktop-accent"
              />
              与上次对比
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={noSave}
                onChange={(event) => setNoSave(event.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-300 text-desktop-accent"
              />
              不落盘
            </label>
          </div>
          <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
            {lastSnapshotAt ? `最近快照：${formatTime(lastSnapshotAt)}` : "尚未读取快照"}
          </div>
          {globalError ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-[11px] text-rose-700">
              {globalError}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Views</div>
          <div className="mt-3 space-y-2">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setViewMode(mode.id)}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                  viewMode === mode.id
                    ? "border-desktop-accent bg-desktop-bg-primary"
                    : "border-desktop-border bg-white/70 hover:bg-desktop-bg-primary/80 dark:bg-white/5"
                }`}
              >
                <div className="text-sm font-semibold text-desktop-text-primary">{mode.label}</div>
                <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{mode.description}</div>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <div className="space-y-4">
        <section className="rounded-[28px] border border-desktop-border bg-desktop-bg-secondary/60 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                {selectedDef.name}
              </div>
              <h3 className="mt-1 text-xl font-semibold text-desktop-text-primary">
                {selectedReport?.overallLevelName ?? "未生成报告"}
              </h3>
              <p className="mt-2 max-w-3xl text-[12px] leading-6 text-desktop-text-secondary">
                {selectedDef.description}。{selectedDef.focus}。当前可靠性：{selectedDef.reliability}。
              </p>
            </div>
            <StatusBadge state={selectedState.state} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              Readiness:
              <span className="ml-1 font-semibold text-desktop-text-primary">
                {selectedReport ? `${clampPercent(selectedReport.currentLevelReadiness)}%` : "N/A"}
              </span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              Source:
              <span className="ml-1 font-semibold text-desktop-text-primary">
                {selectedState.source === "analysis" ? "实时分析" : selectedState.source === "snapshot" ? "快照" : "未运行"}
              </span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              Duration:
              <span className="ml-1 font-semibold text-desktop-text-primary">{formatDuration(selectedState.durationMs)}</span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              Updated:
              <span className="ml-1 font-semibold text-desktop-text-primary">
                {selectedState.updatedAt ? formatTime(selectedState.updatedAt) : "尚未更新"}
              </span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              Context:
              <span className="ml-1 font-semibold text-desktop-text-primary">{contextLabel ?? "未设置"}</span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              Sibling:
              <span className="ml-1 font-semibold text-desktop-text-primary">
                {peerDelta === null ? "N/A" : `${peerDelta >= 0 ? "+" : ""}${peerDelta}%`}
              </span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              Console:
              <span className="ml-1 font-semibold text-desktop-text-primary">
                {selectedState.console?.data ? "Captured" : "N/A"}
              </span>
            </div>
          </div>
        </section>

        <FitnessAnalysisContent
          selectedProfile={selectedProfile}
          viewMode={viewMode}
          profileState={selectedState}
          report={selectedReport}
          peerReport={peerReport}
        />
      </div>
    </div>
  );
}
