"use client";

import { useMemo, useState } from "react";
import { TerminalBubble } from "@/client/components/terminal/terminal-bubble";

import {
  clampPercent,
  criterionShortLabel,
  criterionStatusTone,
  formatTime,
  humanizeToken,
  levelChangeTone,
  readinessBadgeTone,
  readinessBarTone,
  type CellResult,
  type CriterionResult,
  type FitnessProfile,
  type FitnessReport,
  type ProfilePanelState,
  type ViewMode,
} from "./fitness-analysis-types";

type FitnessAnalysisContentProps = {
  selectedProfile: FitnessProfile;
  viewMode: ViewMode;
  profileState: ProfilePanelState;
  report?: FitnessReport;
  peerReport?: FitnessReport;
};

type DimensionGroup = {
  key: string;
  name: string;
  cells: CellResult[];
  failedCriteria: number;
  criticalFailures: number;
  averageScore: number;
};

function sortCells(left: CellResult, right: CellResult) {
  if (left.passed !== right.passed) {
    return left.passed ? 1 : -1;
  }

  return left.score - right.score;
}

function buildDimensionGroups(report: FitnessReport): DimensionGroup[] {
  const groups = new Map<string, DimensionGroup>();

  for (const cell of report.cells) {
    const current = groups.get(cell.dimension) ?? {
      key: cell.dimension,
      name: cell.dimensionName,
      cells: [],
      failedCriteria: 0,
      criticalFailures: 0,
      averageScore: 0,
    };

    current.cells.push(cell);
    current.failedCriteria += cell.criteria.filter((criterion) => criterion.status === "fail").length;
    current.criticalFailures += cell.criteria.filter((criterion) => criterion.critical && criterion.status === "fail").length;
    groups.set(cell.dimension, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      cells: group.cells.slice().sort(sortCells),
      averageScore: group.cells.reduce((sum, cell) => sum + cell.score, 0) / Math.max(group.cells.length, 1),
    }))
    .sort((left, right) => {
      if (left.criticalFailures !== right.criticalFailures) {
        return right.criticalFailures - left.criticalFailures;
      }
      if (left.failedCriteria !== right.failedCriteria) {
        return right.failedCriteria - left.failedCriteria;
      }
      return left.averageScore - right.averageScore;
    });
}

function CapabilityCellCard({ cell }: { cell: CellResult }) {
  const score = clampPercent(cell.score);
  const failedCriteria = cell.criteria.filter((criterion) => criterion.status === "fail");
  const criticalFailures = failedCriteria.filter((criterion) => criterion.critical);

  return (
    <article className="rounded-2xl border border-desktop-border bg-white/85 p-4 shadow-sm dark:bg-white/6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
            {cell.dimensionName}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
            {humanizeToken(cell.level)}
          </div>
          <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">{cell.levelName}</h4>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${readinessBadgeTone(cell.score)}`}>
          {score}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-desktop-bg-primary">
        <div className={`h-full rounded-full ${readinessBarTone(cell.score)}`} style={{ width: `${score}%` }} />
      </div>

      <div className="mt-3 grid gap-2 text-[11px] text-desktop-text-secondary sm:grid-cols-3">
        <div>{cell.passedWeight}/{cell.applicableWeight} weighted checks</div>
        <div>{failedCriteria.length} failing criteria</div>
        <div>{criticalFailures.length} critical blockers</div>
      </div>

      {failedCriteria.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {failedCriteria.slice(0, 4).map((criterion) => (
            <span
              key={criterion.id}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${criterionStatusTone(criterion.status)}`}
            >
              {criterionShortLabel(criterion.id)}
            </span>
          ))}
          {failedCriteria.length > 4 ? (
            <span className="rounded-full border border-desktop-border px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              +{failedCriteria.length - 4}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-emerald-700">该 cell 当前没有失败项。</p>
      )}
    </article>
  );
}

function CriterionList({ criteria }: { criteria: CriterionResult[] }) {
  if (criteria.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
        当前没有阻塞 criterion。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {criteria.map((criterion) => (
        <article key={criterion.id} className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-desktop-text-primary">{criterionShortLabel(criterion.id)}</div>
              <div className="mt-1 font-mono text-[10px] text-desktop-text-secondary">{criterion.id}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {criterion.critical ? (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                  critical
                </span>
              ) : null}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${criterionStatusTone(criterion.status)}`}>
                {criterion.status}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{criterion.whyItMatters}</p>
          <div className="mt-2 rounded-xl border border-desktop-border bg-white/75 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
            动作：{criterion.recommendedAction}
          </div>
          <div className="mt-2 text-[11px] text-desktop-text-secondary">证据线索：{criterion.evidenceHint}</div>
        </article>
      ))}
    </div>
  );
}

function OverviewView({ report, peerReport }: { report: FitnessReport; peerReport?: FitnessReport }) {
  const blockers = report.blockingCriteria ?? [];
  const failedCriteria = report.criteria.filter((criterion) => criterion.status === "fail");
  const capabilityHighlights = buildDimensionGroups(report)
    .map((group) => group.cells[0])
    .filter((cell): cell is CellResult => Boolean(cell))
    .slice(0, 6);
  const peerDelta = peerReport
    ? clampPercent(report.currentLevelReadiness) - clampPercent(peerReport.currentLevelReadiness)
    : null;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap gap-2">
        <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary/60 px-3 py-2 text-[11px] text-desktop-text-secondary">
          Current level:
          <span className="ml-1 font-semibold text-desktop-text-primary">{report.overallLevelName}</span>
        </div>
        <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary/60 px-3 py-2 text-[11px] text-desktop-text-secondary">
          Next target:
          <span className="ml-1 font-semibold text-desktop-text-primary">{report.nextLevelName ?? "Current max"}</span>
        </div>
        <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary/60 px-3 py-2 text-[11px] text-desktop-text-secondary">
          Blocking:
          <span className="ml-1 font-semibold text-desktop-text-primary">{blockers.length}</span>
        </div>
        <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary/60 px-3 py-2 text-[11px] text-desktop-text-secondary">
          Failed criteria:
          <span className="ml-1 font-semibold text-desktop-text-primary">{failedCriteria.length}</span>
        </div>
        <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary/60 px-3 py-2 text-[11px] text-desktop-text-secondary">
          Peer delta:
          <span className="ml-1 font-semibold text-desktop-text-primary">
            {peerDelta === null ? "N/A" : `${peerDelta >= 0 ? "+" : ""}${peerDelta}%`}
          </span>
        </div>
      </section>

      <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Capability hotspots</div>
            <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">当前最需要盯住的细粒度能力项</h3>
          </div>
          <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
            按 cell 粒度排序
          </div>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {capabilityHighlights.map((cell) => (
            <CapabilityCellCard key={cell.id} cell={cell} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Blocking signals</div>
          <div className="mt-3">
            <CriterionList criteria={blockers.slice(0, 6)} />
          </div>
        </div>
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Top recommendations</div>
          {report.recommendations.length > 0 ? (
            <div className="mt-3 space-y-2">
              {report.recommendations.slice(0, 5).map((item) => (
                <article key={item.criterionId} className="rounded-xl border border-desktop-border bg-white/80 p-3 dark:bg-white/6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-desktop-text-primary">{item.action}</div>
                    {item.critical ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                        critical
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-[11px] text-desktop-text-secondary">{item.whyItMatters}</div>
                  <div className="mt-2 text-[11px] text-desktop-text-secondary">证据线索：{item.evidenceHint}</div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-desktop-text-secondary">当前没有建议项。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function CapabilitiesView({ report }: { report: FitnessReport }) {
  const groups = useMemo(() => buildDimensionGroups(report), [report]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                {group.name}
              </div>
              <p className="mt-1 text-[11px] text-desktop-text-secondary">
                {group.cells.length} cells · {group.failedCriteria} failing criteria · {group.criticalFailures} critical blockers
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${readinessBadgeTone(group.averageScore)}`}>
              {clampPercent(group.averageScore)}%
            </span>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {group.cells.map((cell) => (
              <CapabilityCellCard key={cell.id} cell={cell} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RecommendationsView({ report }: { report: FitnessReport }) {
  if (report.recommendations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
        当前 Profile 没有建议数据。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {report.recommendations.map((item) => (
        <article key={item.criterionId} className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold text-desktop-text-primary">{item.action}</h4>
            {item.critical ? (
              <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                Critical
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-desktop-text-secondary">{item.whyItMatters}</p>
          <p className="mt-2 text-[11px] text-desktop-text-secondary">证据线索：{item.evidenceHint}</p>
        </article>
      ))}
    </div>
  );
}

function ChangesView({ report }: { report: FitnessReport }) {
  if (!report.comparison) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border p-4 text-sm text-desktop-text-secondary">
        当前快照未开启历史对比，或缺少历史快照。重新运行时勾选“与上次对比”即可补充。
      </div>
    );
  }

  const comp = report.comparison;

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <div className="text-sm text-desktop-text-primary">与上次对比：{formatTime(comp.previousGeneratedAt)}</div>
        <div className="mt-2 text-xs text-desktop-text-secondary">
          上次总体：{comp.previousOverallLevel} → 当前总体：{report.overallLevel}
          <span className={`ml-2 font-semibold ${levelChangeTone(comp.overallChange)}`}>
            {comp.overallChange === "up" ? "上升" : comp.overallChange === "down" ? "下降" : "持平"}
          </span>
        </div>
      </article>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">维度变化</div>
          {comp.dimensionChanges.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {comp.dimensionChanges.map((item) => (
                <li key={`${item.dimension}-${item.currentLevel}`} className="flex items-center justify-between text-sm">
                  <span className="text-desktop-text-secondary">{humanizeToken(item.dimension)}</span>
                  <span className="font-semibold text-desktop-text-primary">
                    {item.previousLevel}
                    <span className="px-1 text-desktop-text-secondary">→</span>
                    {item.currentLevel}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">当前未检测到维度变化。</p>
          )}
        </div>
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">关键项状态变化</div>
          {comp.criteriaChanges.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {comp.criteriaChanges.slice(0, 8).map((item) => (
                <li key={item.id} className="rounded-xl border border-desktop-border bg-white/85 p-3 dark:bg-white/6">
                  <div className="font-mono text-[11px] text-desktop-text-secondary">{item.id}</div>
                  <div className="mt-1 text-xs text-desktop-text-secondary">
                    {item.previousStatus ?? "unknown"} → {item.currentStatus ?? "unknown"}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">暂无关键项状态变化。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function RawView({ report }: { report: FitnessReport }) {
  const [copied, setCopied] = useState(false);
  const jsonText = JSON.stringify(report, null, 2);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={async () => {
            if (typeof window === "undefined") {
              return;
            }
            await navigator.clipboard.writeText(jsonText);
            setCopied(true);
            window.setTimeout(() => {
              setCopied(false);
            }, 1200);
          }}
          className="rounded-full border border-desktop-border px-3 py-1.5 text-xs font-semibold text-desktop-text-secondary hover:bg-desktop-bg-primary/70"
        >
          {copied ? "已复制" : "复制 JSON"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-2xl border border-desktop-border bg-slate-950 p-4 text-xs leading-5 text-slate-100">
        <code>{jsonText}</code>
      </pre>
    </div>
  );
}

function ConsoleView({ profileState }: { profileState: ProfilePanelState }) {
  const consoleState = profileState.console;

  if (!consoleState?.data) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
        当前没有 console transcript。先运行一次 profile，后端会捕获 `cargo … fitness fluency` 的 stdout / stderr。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4 text-[11px] text-desktop-text-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <span>
            Command:
            <span className="ml-1 font-mono text-desktop-text-primary">{consoleState.command}</span>
          </span>
          <span>
            Exit:
            <span className="ml-1 font-semibold text-desktop-text-primary">
              {consoleState.signal ? `signal ${consoleState.signal}` : consoleState.exitCode ?? "unknown"}
            </span>
          </span>
        </div>
      </div>
      <TerminalBubble
        terminalId={`fluency-console-${profileState.updatedAt ?? "latest"}`}
        command={consoleState.command}
        args={consoleState.args}
        data={consoleState.data}
        exited
        exitCode={consoleState.signal ? 130 : typeof consoleState.exitCode === "number" ? consoleState.exitCode : 0}
      />
    </div>
  );
}

export function FitnessAnalysisContent({
  selectedProfile,
  viewMode,
  profileState,
  report,
  peerReport,
}: FitnessAnalysisContentProps) {
  if (viewMode === "console") {
    return <ConsoleView profileState={profileState} />;
  }

  if (!report) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-8 text-sm text-desktop-text-secondary">
        {profileState.state === "loading"
          ? "正在生成 fluency 报告。"
          : profileState.error ?? `当前还没有 ${selectedProfile} 的报告，先运行一次分析。`}
      </div>
    );
  }

  if (viewMode === "capabilities") {
    return <CapabilitiesView report={report} />;
  }

  if (viewMode === "recommendations") {
    return <RecommendationsView report={report} />;
  }

  if (viewMode === "changes") {
    return <ChangesView report={report} />;
  }

  if (viewMode === "raw") {
    return <RawView report={report} />;
  }

  return <OverviewView report={report} peerReport={peerReport} />;
}
