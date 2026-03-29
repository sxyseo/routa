"use client";

import { useCallback, useEffect, useState } from "react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";

import { FitnessAnalysisContent } from "./fitness-analysis-content";
import {
  PROFILE_ORDER,
  buildAnalysisPayload,
  buildAnalysisQuery,
  normalizeApiResponse,
  profileStateTone,
  type AnalyzeResponse,
  type FitnessProfile,
  type FitnessProfileState,
  type ProfilePanelState,
  toMessage,
} from "./fitness-analysis-types";
import { buildHeroModel, buildPrimaryActionLabel } from "./fitness-analysis-view-model";

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

type MatrixColumn = {
  key: string;
  title: string[];
  subtitle?: string;
  color: string;
};

type MatrixRow = {
  title: string[];
  subtitle?: string;
};

type MatrixPoint = {
  x: number; // 0~5, 0.5 means first column center
  y: number; // 0~5, 0.5 means first row center
  color: string;
};

const LEVEL_INDEX: Record<string, number> = {
  awareness: 0,
  assisted_coding: 1,
  structured_ai_coding: 2,
  agent_centric: 3,
  agent_first: 4,
};

const MATRIX_COLUMNS: MatrixColumn[] = [
  {
    key: "collaboration",
    title: ["Human-AI Collaboration"],
    subtitle: "（人机协作）",
    color: "#0D4E63",
  },
  {
    key: "sdlc",
    title: ["AI SDLC Coverage"],
    subtitle: "（生命周期覆盖度）",
    color: "#53A8B7",
  },
  {
    key: "harness",
    title: ["AI Engineering Harness"],
    subtitle: "（工程化支撑）",
    color: "#EF6A82",
  },
  {
    key: "governance",
    title: ["Governance & Quality"],
    subtitle: "（质量与治理）",
    color: "#6C548F",
  },
  {
    key: "context",
    title: ["Context Engineering"],
    subtitle: "（上下文工程）",
    color: "#D28A07",
  },
];

const MATRIX_ROWS: MatrixRow[] = [
  {
    title: ["Awareness"],
    subtitle: "认识/意识唤醒",
  },
  {
    title: ["Assisted", "Coding"],
    subtitle: "Chat、代码补全",
  },
  {
    title: ["Structured AI", "Coding"],
    subtitle: "Spec → Code → Test",
  },
  {
    title: ["Agent-Centric"],
    subtitle: "Code Agent、PR Agent",
  },
  {
    title: ["Agent-First"],
    subtitle: "Ralph Loop Agent",
  },
];

function SvgMultilineText({
  x,
  y,
  lines,
  fontSize = 16,
  lineGap = 1.2,
  fill = "#111",
  fontWeight = 600,
  textAnchor = "middle",
}: {
  x: number;
  y: number;
  lines: string[];
  fontSize?: number;
  lineGap?: number;
  fill?: string;
  fontWeight?: number | string;
  textAnchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x}
      y={y}
      fill={fill}
      fontSize={fontSize}
      fontWeight={fontWeight}
      textAnchor={textAnchor}
      fontFamily="Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    >
      {lines.map((line, i) => (
        <tspan key={line + i} x={x} dy={i === 0 ? 0 : fontSize * lineGap}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function CapabilityPin({ x, y, color, size = 22 }: { x: number; y: number; color: string; size?: number }) {
  const scale = size / 24;

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale}) translate(-12, -24)`}>
      <path
        d="M12 2C7.58 2 4 5.58 4 10c0 6.2 8 14 8 14s8-7.8 8-14c0-4.42-3.58-8-8-8z"
        fill={color}
      />
      <circle cx="12" cy="10" r="2.7" fill="#fff" />
    </g>
  );
}

function FitnessMatrix({ selectedReport }: { selectedReport?: { dimensions?: Record<string, { level?: string | null }> } | undefined }) {
  const matrixWidth = 1600;
  const matrixHeight = 560;
  const margin = { top: 96, right: 30, bottom: 54, left: 214 };
  const plotX = margin.left;
  const plotY = margin.top;
  const plotW = matrixWidth - margin.left - margin.right;
  const plotH = matrixHeight - margin.top - margin.bottom;
  const colCount = MATRIX_COLUMNS.length;
  const rowCount = MATRIX_ROWS.length;
  const colW = plotW / colCount;
  const rowH = plotH / rowCount;
  const toX = (value: number) => plotX + value * colW;
  const toY = (value: number) => plotY + value * rowH;

  const dimensionMap = selectedReport?.dimensions ?? {};
  const points: MatrixPoint[] = MATRIX_COLUMNS.flatMap((column, index) => {
    const level = dimensionMap[column.key]?.level ?? null;
    const levelIndex = level ? LEVEL_INDEX[level] : undefined;
    if (levelIndex === undefined) {
      return [];
    }

    return [{
      x: index + 0.5,
      y: levelIndex + 0.5,
      color: column.color,
    }];
  });

  const hasPointData = points.length > 0;
  const polylinePoints = points.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ");

  if (!selectedReport) {
    return <div className="mt-2 rounded-xl border border-dashed border-desktop-border px-3 py-2 text-[11px] text-desktop-text-secondary">No report yet.</div>;
  }

  return (
    <div className="mt-2 overflow-x-auto">
      <div className="min-w-[640px]">
        <svg
          viewBox={`0 0 ${matrixWidth} ${matrixHeight}`}
          className="h-auto w-full"
          role="img"
          aria-label="AI capability matrix"
        >
          <rect
            x={plotX}
            y={plotY}
            width={plotW}
            height={plotH}
            fill="#EEF1F2"
          />

          {Array.from({ length: colCount + 1 }).map((_, i) => {
            const x = plotX + i * colW;
            return (
              <line
                key={`v-${i}`}
                x1={x}
                y1={plotY}
                x2={x}
                y2={plotY + plotH}
                stroke="#FFFFFF"
                strokeWidth={1}
              />
            );
          })}
          {Array.from({ length: rowCount + 1 }).map((_, i) => {
            const y = plotY + i * rowH;
            return (
              <line
                key={`h-${i}`}
                x1={plotX}
                y1={y}
                x2={plotX + plotW}
                y2={y}
                stroke="#FFFFFF"
                strokeWidth={1}
              />
            );
          })}

          {MATRIX_COLUMNS.map((column, index) => {
            const cx = plotX + (index + 0.5) * colW;
            return (
              <g key={column.key}>
                <SvgMultilineText
                  x={cx}
                  y={54}
                  lines={column.title}
                  fontSize={16}
                  fontWeight={700}
                  fill={column.color}
                  textAnchor="middle"
                />
                {column.subtitle ? (
                  <text
                    x={cx}
                    y={88}
                    fill={column.color}
                    fontSize={14}
                    fontWeight={700}
                    textAnchor="middle"
                    fontFamily="Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
                  >
                    {column.subtitle}
                  </text>
                ) : null}
              </g>
            );
          })}

          {MATRIX_ROWS.map((row, index) => {
            const cy = plotY + (index + 0.5) * rowH;
            const labelX = plotX - 28;
            return (
              <g key={row.title.join("-")}>
                <SvgMultilineText
                  x={labelX}
                  y={cy - (row.title.length - 1) * 11 - 8}
                  lines={row.title}
                  fontSize={18}
                  fontWeight={600}
                  fill="#111"
                  textAnchor="end"
                />
                {row.subtitle ? (
                  <text
                    x={labelX}
                    y={cy + 28}
                    fill="#A1A1A1"
                    fontSize={11}
                    fontWeight={500}
                    textAnchor="end"
                    fontFamily="Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
                  >
                    {row.subtitle}
                  </text>
                ) : null}
              </g>
            );
          })}

          {hasPointData ? (
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="#757575"
              strokeWidth={3}
              strokeDasharray="4 12"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {points.map((point) => (
            <CapabilityPin key={`${point.x}-${point.y}`} x={toX(point.x)} y={toY(point.y)} color={point.color} size={24} />
          ))}

          <text
            x={matrixWidth - 40}
            y={matrixHeight - 20}
            textAnchor="end"
            fill="#111"
            fontSize={12}
            fontWeight={500}
            fontFamily="Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
          >
            Adapted from Agile Fluency® project
          </text>
        </svg>
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: FitnessProfileState }) {
  const labels: Record<FitnessProfileState, string> = {
    idle: "Idle",
    loading: "Running",
    ready: "Ready",
    empty: "Empty",
    error: "Error",
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
  const [profiles, setProfiles] = useState<Record<FitnessProfile, ProfilePanelState>>(EMPTY_STATE);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const hasContext = Boolean(workspaceId?.trim() || codebaseId?.trim() || repoPath?.trim());
  const contextQuery = buildAnalysisQuery({ workspaceId, codebaseId, repoPath });
  const contextPayload = buildAnalysisPayload(
    { workspaceId, codebaseId, repoPath },
    { mode: "deterministic" },
  );
  const contextLabel = codebaseLabel || repoPath || null;
  const compareLast = true;
  const noSave = false;

  const selectedProfile: FitnessProfile = "generic";
  const selectedState = profiles.generic;

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
            updatedAt: entry.report.generatedAt,
          };
          continue;
        }

        if (entry.status === "missing") {
          next[profile] = {
            state: "empty",
            source: entry.source,
            error: entry.error ?? "暂无快照",
          };
          continue;
        }

        next[profile] = {
          state: "error",
          source: entry.source,
          durationMs: entry.durationMs,
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

  const selectedReport = selectedState.report;
  const blockers = selectedReport?.blockingCriteria ?? [];
  const failedCriteria = selectedReport?.criteria.filter((criterion) => criterion.status === "fail") ?? [];
  const heroModel = buildHeroModel(selectedReport, selectedProfile, selectedState.state);
  const primaryActionLabel = buildPrimaryActionLabel(selectedReport, selectedState.state);
  const reportSource = selectedState.source === "analysis"
    ? "Live"
    : selectedState.source === "snapshot"
      ? "Snapshot"
      : "No data";
  const reportReadiness = selectedReport ? `${Math.round(selectedReport.currentLevelReadiness * 100)}%` : "N/A";

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-desktop-border bg-desktop-bg-secondary/60 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] uppercase tracking-[0.14em] text-desktop-text-secondary">
              Generic report · Repo <span className="text-desktop-text-primary">{contextLabel ?? "未设置"}</span>
            </div>
            <div className="mt-1 truncate text-[11px] leading-tight text-desktop-text-secondary">
              {heroModel.currentLevel} → {heroModel.targetLevel}
              <span className="text-desktop-text-secondary"> · {heroModel.confidenceSummary}</span>
              <span className="text-desktop-text-secondary"> · Blockers {selectedReport ? blockers.length : "N/A"}</span>
              <span className="text-desktop-text-secondary"> · Failed {selectedReport ? failedCriteria.length : "N/A"}</span>
              <span className="text-desktop-text-secondary"> · {reportSource}</span>
            </div>
          </div>
          <StatusBadge state={selectedState.state} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRunSelectedProfile}
            disabled={!hasContext || selectedState.state === "loading"}
            className="h-7 rounded-full bg-desktop-accent px-3 text-[12px] font-semibold leading-none text-desktop-text-on-accent disabled:opacity-60"
          >
            {primaryActionLabel}
          </button>
          <button
            type="button"
            onClick={() => void syncProfiles()}
            disabled={!hasContext}
            className="h-7 rounded-full border border-desktop-border px-3 text-[12px] font-semibold leading-none text-desktop-text-primary hover:bg-desktop-bg-primary/80 disabled:opacity-60"
          >
            Refresh latest report
          </button>
          <span className="ml-auto inline-flex items-center rounded-full border border-desktop-border px-2 py-0.5 text-[11px] text-desktop-text-secondary">
            Fit {reportReadiness}
          </span>
        </div>

        <div className="mt-2 border-t border-desktop-border/80 pt-2">
          <div className="text-[11px] uppercase tracking-[0.1em] text-desktop-text-secondary">Capability Matrix</div>
          <FitnessMatrix selectedReport={selectedReport} />
        </div>

        {globalError ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700">
            {globalError}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-desktop-border bg-desktop-bg-secondary/60 p-4 shadow-sm">
        <FitnessAnalysisContent
          selectedProfile={selectedProfile}
          viewMode="overview"
          profileState={selectedState}
          report={selectedReport}
        />
      </section>
    </div>
  );
}
