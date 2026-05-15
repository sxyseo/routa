"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { useTranslation } from "@/i18n";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";

export type GitLabCIJob = {
  id: string;
  name: string;
  stage: string;
  image: string | null;
  kind: "build" | "test" | "deploy" | "security" | "review";
  scriptCount: number;
  needs: string[];
  dependencies: string[];
  tags: string[];
  allowFailure: boolean;
  when: string;
};

export type GitLabCIStage = {
  name: string;
  jobs: GitLabCIJob[];
};

export type GitLabCIPipeline = {
  yaml: string;
  stages: GitLabCIStage[];
  jobs: GitLabCIJob[];
  defaultImage: string | null;
  totalStages: number;
  totalJobs: number;
};

export type GitLabCIResponse = {
  generatedAt: string;
  repoRoot: string;
  ciFilePath: string | null;
  pipeline: GitLabCIPipeline | null;
  warnings: string[];
};

type PipelineState = {
  error: string | null;
  pipeline: GitLabCIPipeline | null;
  loadedContextKey: string;
};

type HarnessGitLabCIPipelinePanelProps = {
  workspaceId: string;
  codebaseID?: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: GitLabCIResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  variant?: "full" | "compact";
  hideHeader?: boolean;
};

const JOB_KIND_STYLES: Record<GitLabCIJob["kind"], string> = {
  build: "border-slate-200 bg-white/90 text-slate-600",
  test: "border-emerald-200 bg-emerald-50 text-emerald-700",
  deploy: "border-violet-200 bg-violet-50 text-violet-700",
  security: "border-red-200 bg-red-50 text-red-700",
  review: "border-amber-200 bg-amber-50 text-amber-700",
};

const STAGE_COLORS = [
  "border-sky-200 bg-sky-50/60 text-sky-700",
  "border-emerald-200 bg-emerald-50/60 text-emerald-700",
  "border-violet-200 bg-violet-50/60 text-violet-700",
  "border-amber-200 bg-amber-50/60 text-amber-700",
  "border-red-200 bg-red-50/60 text-red-700",
  "border-slate-200 bg-slate-50/60 text-slate-700",
];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function stageColor(index: number) {
  return STAGE_COLORS[index % STAGE_COLORS.length];
}

// --- Dependency graph helpers ---

/** Build a reverse lookup: job id -> job */
function buildJobMap(jobs: GitLabCIJob[]): Map<string, GitLabCIJob> {
  const map = new Map<string, GitLabCIJob>();
  for (const job of jobs) map.set(job.id, job);
  return map;
}

/** Collect all upstream job IDs (transitive) for a given job */
function collectUpstream(jobId: string, jobMap: Map<string, GitLabCIJob>): Set<string> {
  const visited = new Set<string>();
  const stack = [jobId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const job = jobMap.get(current);
    if (!job) continue;
    for (const dep of job.dependencies) {
      if (!visited.has(dep)) {
        visited.add(dep);
        stack.push(dep);
      }
    }
    for (const need of job.needs) {
      if (!visited.has(need)) {
        visited.add(need);
        stack.push(need);
      }
    }
  }
  return visited;
}

/** Collect all downstream job IDs (transitive) for a given job */
function collectDownstream(jobId: string, jobs: GitLabCIJob[]): Set<string> {
  const visited = new Set<string>();
  const stack = [jobId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const job of jobs) {
      if (job.dependencies.includes(current) || job.needs.includes(current)) {
        if (!visited.has(job.id)) {
          visited.add(job.id);
          stack.push(job.id);
        }
      }
    }
  }
  return visited;
}

/** Build edges from job dependencies and needs */
function buildEdges(jobs: GitLabCIJob[]): Array<{ from: string; to: string }> {
  const seen = new Set<string>();
  const edges: Array<{ from: string; to: string }> = [];
  for (const job of jobs) {
    for (const dep of job.dependencies) {
      const key = `${dep}->${job.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: dep, to: job.id });
      }
    }
    for (const need of job.needs) {
      const key = `${need}->${job.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: need, to: job.id });
      }
    }
  }
  return edges;
}

// --- SVG Dependency Graph ---

/** Layout: arrange jobs in columns by stage, rows within each stage */
function computeNodePositions(
  stages: GitLabCIStage[],
  nodeWidth: number,
  nodeHeight: number,
  hGap: number,
  vGap: number,
  leftPadding: number,
  topPadding: number,
): Map<string, { x: number; y: number; col: number }> {
  const positions = new Map<string, { x: number; y: number; col: number }>();
  let currentX = leftPadding;

  for (let si = 0; si < stages.length; si++) {
    const stage = stages[si];
    const rows = stage.jobs.length;
    const totalHeight = rows * nodeHeight + (rows - 1) * vGap;
    const startY = topPadding;

    for (let ji = 0; ji < stage.jobs.length; ji++) {
      const job = stage.jobs[ji];
      positions.set(job.id, {
        x: currentX,
        y: startY + ji * (nodeHeight + vGap),
        col: si,
      });
    }

    currentX += nodeWidth + hGap;
  }

  return positions;
}

type DependencyGraphProps = {
  pipeline: GitLabCIPipeline;
  activeJobId: string;
  hoveredJobId: string | null;
  onJobSelect: (jobId: string) => void;
  onJobHover: (jobId: string | null) => void;
};

function DependencyGraph({
  pipeline,
  activeJobId,
  hoveredJobId,
  onJobSelect,
  onJobHover,
}: DependencyGraphProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  const jobMap = useMemo(() => buildJobMap(pipeline.jobs), [pipeline.jobs]);
  const edges = useMemo(() => buildEdges(pipeline.jobs), [pipeline.jobs]);

  const NODE_W = 120;
  const NODE_H = 44;
  const H_GAP = 56;
  const V_GAP = 12;
  const PAD_X = 20;
  const PAD_Y = 20;

  const activeStages = useMemo(
    () => pipeline.stages.filter((s) => s.jobs.length > 0),
    [pipeline.stages],
  );

  const positions = useMemo(
    () => computeNodePositions(activeStages, NODE_W, NODE_H, H_GAP, V_GAP, PAD_X, PAD_Y),
    [activeStages],
  );

  const hasAnyDeps = edges.length > 0;

  // Compute highlighted set when hovering
  const highlightedSet = useMemo(() => {
    if (!hoveredJobId) return null;
    const upstream = collectUpstream(hoveredJobId, jobMap);
    const downstream = collectDownstream(hoveredJobId, pipeline.jobs);
    const all = new Set([hoveredJobId, ...upstream, ...downstream]);
    return { set: all, source: hoveredJobId };
  }, [hoveredJobId, jobMap, pipeline.jobs]);

  // Compute SVG dimensions
  let maxX = PAD_X * 2;
  let maxY = PAD_Y * 2;
  for (const pos of positions.values()) {
    const right = pos.x + NODE_W + PAD_X;
    const bottom = pos.y + NODE_H + PAD_Y;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }

  const svgW = maxX;
  const svgH = maxY;

  // Determine if an edge should be highlighted
  const isEdgeHighlighted = useCallback(
    (from: string, to: string): boolean => {
      if (!highlightedSet) return false;
      return highlightedSet.set.has(from) && highlightedSet.set.has(to);
    },
    [highlightedSet],
  );

  const isNodeHighlighted = useCallback(
    (jobId: string): boolean => {
      if (!highlightedSet) return false;
      return highlightedSet.set.has(jobId);
    },
    [highlightedSet],
  );

  // Edge path: from right-center of source to left-center of target
  function edgePath(fromId: string, toId: string): string {
    const from = positions.get(fromId);
    const to = positions.get(toId);
    if (!from || !to) return "";
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const cx = (x1 + x2) / 2;
    return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
  }

  return (
    <div ref={containerRef} className="overflow-x-auto">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {t.settings.harness.gitlabCi?.dependencyGraph ?? "Dependency Graph"}
        </span>
        {!hasAnyDeps ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 italic">
            {t.settings.harness.gitlabCi?.noExplicitDeps ?? "No explicit dependencies"}
          </span>
        ) : (
          <span className="text-[10px] text-slate-400">
            {t.settings.harness.gitlabCi?.hoverHighlight ?? "Hover to highlight chain"}
          </span>
        )}
      </div>
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="select-none"
        style={{ minWidth: svgW }}
      >
        {/* Stage column labels */}
        {activeStages.map((stage, si) => {
          const stageJobs = stage.jobs;
          if (stageJobs.length === 0) return null;
          const firstPos = positions.get(stageJobs[0].id);
          if (!firstPos) return null;
          return (
            <text
              key={`stage-label:${stage.name}`}
              x={firstPos.x + NODE_W / 2}
              y={12}
              textAnchor="middle"
              className="fill-slate-400"
              fontSize={9}
              fontWeight={600}
              letterSpacing="0.12em"
            >
              {stage.name}
            </text>
          );
        })}

        {/* Edges (arrows) */}
        {edges.map((edge, idx) => {
          const highlighted = isEdgeHighlighted(edge.from, edge.to);
          const dimmed = highlightedSet && !highlighted;
          return (
            <path
              key={`edge:${idx}`}
              d={edgePath(edge.from, edge.to)}
              fill="none"
              stroke={highlighted ? "#0ea5e9" : dimmed ? "#e2e8f0" : "#94a3b8"}
              strokeWidth={highlighted ? 2 : 1.2}
              markerEnd={`url(#arrowhead${highlighted ? "-hl" : dimmed ? "-dim" : ""})`}
              style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
            />
          );
        })}

        {/* Arrow markers */}
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
          </marker>
          <marker id="arrowhead-hl" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#0ea5e9" />
          </marker>
          <marker id="arrowhead-dim" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#e2e8f0" />
          </marker>
        </defs>

        {/* Nodes */}
        {pipeline.jobs.map((job) => {
          const pos = positions.get(job.id);
          if (!pos) return null;
          const active = activeJobId === job.id;
          const highlighted = isNodeHighlighted(job.id);
          const dimmed = highlightedSet && !highlighted;
          const hovered = hoveredJobId === job.id;

          return (
            <g
              key={`node:${job.id}`}
              transform={`translate(${pos.x}, ${pos.y})`}
              onClick={() => onJobSelect(job.id)}
              onMouseEnter={() => onJobHover(job.id)}
              onMouseLeave={() => onJobHover(null)}
              className="cursor-pointer"
              style={{ transition: "opacity 0.15s" }}
              opacity={dimmed ? 0.35 : 1}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill={active ? "#f0f9ff" : hovered ? "#f8fafc" : "#fff"}
                stroke={active ? "#0ea5e9" : highlighted ? "#7dd3fc" : "#e2e8f0"}
                strokeWidth={active ? 1.8 : 1}
                style={{ transition: "fill 0.15s, stroke 0.15s" }}
              />
              {/* Job name */}
              <text
                x={NODE_W / 2}
                y={16}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                className="fill-slate-800"
              >
                {job.name.length > 14 ? job.name.slice(0, 13) + "…" : job.name}
              </text>
              {/* Kind badge */}
              <text
                x={NODE_W / 2}
                y={32}
                textAnchor="middle"
                fontSize={8}
                className={cx(
                  "font-medium",
                  job.kind === "build" && "fill-slate-400",
                  job.kind === "test" && "fill-emerald-500",
                  job.kind === "deploy" && "fill-violet-500",
                  job.kind === "security" && "fill-red-400",
                  job.kind === "review" && "fill-amber-500",
                )}
              >
                {job.kind}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// --- Sub-components ---

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-sm border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px]">
      <span className="font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className="text-[12px] font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function StageLane({
  stage,
  stageIndex,
  activeJobId,
  onJobSelect,
}: {
  stage: GitLabCIStage;
  stageIndex: number;
  activeJobId: string;
  onJobSelect: (jobId: string) => void;
}) {
  const color = stageColor(stageIndex);

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 items-center text-slate-300">
        <ArrowRight className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} />
      </div>
      <div className="shrink-0 space-y-2.5 w-64">
        <div className={cx("pl-1 text-[10px] font-semibold uppercase tracking-[0.18em]", color.split(" ")[2] || "text-slate-500")}>
          {stage.name}
        </div>
        {stage.jobs.length > 0 ? stage.jobs.map((job) => {
          const selected = activeJobId === job.id;
          return (
            <button
              key={job.id}
              type="button"
              onClick={() => onJobSelect(job.id)}
              className={cx(
                "w-full rounded-sm border px-3 py-2.5 text-left transition-all",
                selected
                  ? "border-sky-300 bg-sky-50/80"
                  : "border-slate-200 bg-white/92 hover:border-slate-300",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-slate-900">{job.name}</div>
                  <div className="mt-0.5 text-[10px] font-mono text-slate-500">
                    {job.image ?? "default image"}
                  </div>
                </div>
                <span className={cx("rounded-full border px-2 py-0.5 text-[10px]", JOB_KIND_STYLES[job.kind])}>
                  {job.kind}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {job.scriptCount > 0 ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                    {job.scriptCount} scripts
                  </span>
                ) : null}
                {job.needs.length > 0 ? job.needs.map((need) => (
                  <span key={`${job.id}:${need}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                    {need}
                  </span>
                )) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                    root
                  </span>
                )}
                {job.tags.length > 0 ? job.tags.map((tag) => (
                  <span key={`${job.id}:tag:${tag}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                    {tag}
                  </span>
                )) : null}
              </div>
            </button>
          );
        }) : (
          <div className="rounded-sm border border-dashed border-slate-200 bg-white/70 px-3 py-3 text-[10px] text-slate-400 italic">
            No jobs in this stage
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineCanvas({
  pipeline,
  activeJobId,
  onJobSelect,
  compactMode,
  hoveredJobId,
  onJobHover,
}: {
  pipeline: GitLabCIPipeline;
  activeJobId: string;
  onJobSelect: (jobId: string) => void;
  compactMode: boolean;
  hoveredJobId: string | null;
  onJobHover: (jobId: string | null) => void;
}) {
  const activeStages = pipeline.stages.filter((s) => s.jobs.length > 0);

  return (
    <section className="rounded-sm border border-slate-200/80 bg-white/95 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">GitLab CI Pipeline</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">.gitlab-ci.yml</h3>
          {pipeline.defaultImage ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-600 font-mono">
                {pipeline.defaultImage}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {pipeline.totalJobs} jobs
          </span>
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {pipeline.totalStages} stages
          </span>
        </div>
      </div>

      {/* SVG Dependency Graph */}
      <div className="mt-3 rounded-sm border border-slate-100 bg-slate-50/40 p-2">
        <DependencyGraph
          pipeline={pipeline}
          activeJobId={activeJobId}
          hoveredJobId={hoveredJobId}
          onJobSelect={onJobSelect}
          onJobHover={onJobHover}
        />
      </div>

      {/* Stage lanes (job cards) */}
      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex min-w-max items-start gap-3">
          <div className={cx(
            "shrink-0 rounded-sm border border-slate-200/80 bg-slate-50/70 p-3.5",
            compactMode ? "w-40" : "w-48",
          )}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Source</div>
            <div className="mt-2.5 rounded-sm border border-white/70 bg-white/90 px-2.5 py-1.5 text-[10px] font-medium text-slate-700 font-mono">
              .gitlab-ci.yml
            </div>
          </div>

          {activeStages.map((stage, stageIndex) => (
            <StageLane
              key={`stage:${stage.name}`}
              stage={stage}
              stageIndex={stageIndex}
              activeJobId={activeJobId}
              onJobSelect={onJobSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function DepChainSection({
  title,
  jobIds,
  jobMap,
  onJobSelect,
}: {
  title: string;
  jobIds: string[];
  jobMap: Map<string, GitLabCIJob>;
  onJobSelect: (jobId: string) => void;
}) {
  if (jobIds.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {jobIds.map((id) => {
          const job = jobMap.get(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onJobSelect(id)}
              className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700 hover:bg-sky-100 transition-colors"
            >
              {job?.name ?? id}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JobInspector({
  pipeline,
  activeJob,
  compactMode,
  onJobSelect,
}: {
  pipeline: GitLabCIPipeline;
  activeJob: GitLabCIJob | null;
  compactMode: boolean;
  onJobSelect: (jobId: string) => void;
}) {
  const { t } = useTranslation();
  const jobMap = useMemo(() => buildJobMap(pipeline.jobs), [pipeline.jobs]);

  // Compute dependency chains for active job
  const upstream = useMemo(() => {
    if (!activeJob) return [];
    const set = collectUpstream(activeJob.id, jobMap);
    return Array.from(set);
  }, [activeJob, jobMap]);

  const downstream = useMemo(() => {
    if (!activeJob) return [];
    const set = collectDownstream(activeJob.id, pipeline.jobs);
    return Array.from(set);
  }, [activeJob, pipeline.jobs]);

  const hasChain = upstream.length > 0 || downstream.length > 0;

  return (
    <aside className="rounded-sm border border-slate-200/80 bg-white/95 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t.settings.harness.gitlabCi?.selectedJob ?? "Inspector"}
          </div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
            {activeJob?.name ?? t.settings.harness.gitlabCi?.pipelineDetail ?? "Pipeline"}
          </h3>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">
            {activeJob
              ? t.settings.harness.gitlabCi?.jobDetail ?? "Selected job metadata, stage context, and dependency information."
              : t.settings.harness.gitlabCi?.pipelineDetail ?? "Pipeline-level overview and configuration."}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-500">
          {activeJob
            ? t.settings.harness.gitlabCi?.jobDetail ?? "Job detail"
            : t.settings.harness.gitlabCi?.pipelineDetail ?? "Pipeline detail"}
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Stage</div>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">{activeJob?.stage ?? "all"}</div>
        </div>
        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Image</div>
          <div className="mt-2 break-all font-mono text-[11px] text-slate-700">{activeJob?.image ?? pipeline.defaultImage ?? "none"}</div>
        </div>

        {/* Dependency chain section (AC2+AC3) */}
        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5 sm:col-span-2 xl:col-span-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t.settings.harness.gitlabCi?.dependencyGraph ?? "Dependencies"}
          </div>
          {activeJob && hasChain ? (
            <div className="mt-2 space-y-2">
              <DepChainSection
                title={t.settings.harness.gitlabCi?.upstream ?? "Upstream"}
                jobIds={upstream}
                jobMap={jobMap}
                onJobSelect={onJobSelect}
              />
              <DepChainSection
                title={t.settings.harness.gitlabCi?.downstream ?? "Downstream"}
                jobIds={downstream}
                jobMap={jobMap}
                onJobSelect={onJobSelect}
              />
            </div>
          ) : activeJob ? (
            <div className="mt-2 text-[10px] text-slate-400 italic">
              {t.settings.harness.gitlabCi?.depChainEmptyHint ?? "No upstream or downstream dependencies."}
            </div>
          ) : (
            <div className="mt-2 text-[10px] text-slate-400 italic">
              {t.settings.harness.gitlabCi?.depChainEmpty ?? "No upstream or downstream"}
            </div>
          )}
        </div>

        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scripts</div>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">
            {activeJob?.scriptCount ?? 0}
          </div>
        </div>
      </div>

      {!compactMode ? (
        <details className="mt-3 rounded-sm border border-slate-200 bg-white/90 p-3">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Pipeline YAML
          </summary>
          <div className="mt-3">
            <CodeViewer
              code={pipeline.yaml}
              filename=".gitlab-ci.yml"
              language="yaml"
              maxHeight="320px"
              showHeader={false}
              wordWrap
            />
          </div>
        </details>
      ) : null}
    </aside>
  );
}

// --- Main panel ---

export function HarnessGitLabCIPipelinePanel({
  workspaceId,
  codebaseID: _codebaseID,
  codebaseId,
  repoPath,
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  onRetry,
  variant = "full",
  hideHeader = false,
}: HarnessGitLabCIPipelinePanelProps) {
  const { t } = useTranslation();
  const hasExternalState = loading !== undefined || error !== undefined || data !== undefined;
  const effectiveCodebaseId = codebaseId ?? _codebaseID;
  const hasContext = Boolean(workspaceId && repoPath);
  const contextKey = hasContext ? `${workspaceId}:${effectiveCodebaseId ?? "repo-only"}:${repoPath}` : "";

  const [pipelineState, setPipelineState] = useState<PipelineState>({
    error: null,
    pipeline: null,
    loadedContextKey: "",
  });

  useEffect(() => {
    if (hasExternalState || !hasContext) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;

      const query = new URLSearchParams();
      query.set("workspaceId", workspaceId);
      if (effectiveCodebaseId) query.set("codebaseId", effectiveCodebaseId);
      if (repoPath) query.set("repoPath", repoPath);

      void desktopAwareFetch(`/api/harness/gitlab-ci?${query.toString()}`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitLab CI config");
          }
          if (cancelled) return;
          setPipelineState({
            error: null,
            pipeline: (payload?.pipeline as GitLabCIPipeline) ?? null,
            loadedContextKey: contextKey,
          });
        })
        .catch((fetchError: unknown) => {
          if (cancelled) return;
          setPipelineState({
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
            pipeline: null,
            loadedContextKey: contextKey,
          });
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [effectiveCodebaseId, contextKey, hasContext, hasExternalState, repoPath, workspaceId]);

  const resolvedState = hasExternalState
    ? { error: error ?? null, pipeline: data?.pipeline ?? null, loadedContextKey: contextKey }
    : pipelineState;

  const pipeline = resolvedState.pipeline;
  const isLoading = hasExternalState
    ? Boolean(loading)
    : (hasContext && resolvedState.loadedContextKey !== contextKey && !resolvedState.error);

  const summary = isLoading
    ? t.harness.gitlabCi.loading
    : unsupportedMessage
      ? t.harness.gitlabCi.unsupported
      : resolvedState.error
        ? t.harness.gitlabCi.fetchError
        : !hasContext
          ? t.harness.gitlabCi.noRepo
          : !pipeline
            ? t.harness.gitlabCi.noCiFile
            : `${pipeline.totalJobs} jobs / ${pipeline.totalStages} stages`;

  const stateBadge = (
    <span className="text-[10px] text-desktop-text-secondary">{summary}</span>
  );

  if (isLoading) {
    return (
      <HarnessSectionCard
        title={t.settings.harness.ciCd}
        hideHeader={hideHeader}
        description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
        actions={stateBadge}
        variant={variant}
      >
        <HarnessSectionStateFrame>{t.harness.gitlabCi.loadingWorkflows}</HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  if (unsupportedMessage) {
    return (
      <HarnessSectionCard
        title={t.settings.harness.ciCd}
        hideHeader={hideHeader}
        description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
        actions={stateBadge}
        variant={variant}
      >
        <HarnessUnsupportedState className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-4 text-[11px] text-amber-800" />
      </HarnessSectionCard>
    );
  }

  if (resolvedState.error) {
    return (
      <HarnessSectionCard
        title={t.settings.harness.ciCd}
        hideHeader={hideHeader}
        description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
        actions={stateBadge}
        variant={variant}
      >
        <HarnessSectionStateFrame tone="error">
          <div className="flex items-center justify-between gap-3">
            <span>{resolvedState.error}</span>
            {onRetry ? (
              <button
                type="button"
                className="desktop-btn desktop-btn-secondary shrink-0 text-[10px]"
                onClick={onRetry}
              >
                {t.settings.harness.gitlabCi?.retry ?? "Retry"}
              </button>
            ) : null}
          </div>
        </HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  if (!pipeline) {
    return (
      <HarnessSectionCard
        title={t.settings.harness.ciCd}
        hideHeader={hideHeader}
        description={`GitLab CI/CD pipeline visualization for ${_repoLabel}`}
        actions={stateBadge}
        variant={variant}
      >
        <HarnessSectionStateFrame>
          {t.settings.harness.gitlabCi?.noCiFile ?? 'No ".gitlab-ci.yml" file found for this repository.'}
        </HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  return (
    <GitLabCIGallery pipeline={pipeline} variant={variant} />
  );
}

// --- Gallery ---

function GitLabCIGallery({
  pipeline,
  variant,
}: {
  pipeline: GitLabCIPipeline;
  variant: "full" | "compact";
}) {
  const compactMode = variant === "compact";
  const [selectedJobId, setSelectedJobId] = useState(pipeline.jobs[0]?.id ?? "");
  const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);
  const activeJob = pipeline.jobs.find((j) => j.id === selectedJobId) ?? pipeline.jobs[0] ?? null;

  return (
    <div className="space-y-3">
      {/* Metrics */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <MetricCard label="Stages" value={pipeline.totalStages} />
        <MetricCard label="Jobs" value={pipeline.totalJobs} />
        <MetricCard label="Image" value={pipeline.defaultImage ?? "none"} />
      </div>

      {/* Main content */}
      <div className={cx("grid gap-4", compactMode ? "grid-cols-1" : "xl:grid-cols-[minmax(0,1.45fr)_340px]")}>
        <PipelineCanvas
          pipeline={pipeline}
          activeJobId={activeJob?.id ?? ""}
          onJobSelect={setSelectedJobId}
          compactMode={compactMode}
          hoveredJobId={hoveredJobId}
          onJobHover={setHoveredJobId}
        />
        <JobInspector
          pipeline={pipeline}
          activeJob={activeJob}
          compactMode={compactMode}
          onJobSelect={setSelectedJobId}
        />
      </div>

      {/* Stage summary table */}
      <details className="rounded-sm border border-slate-200/80 bg-white/95">
        <summary className="cursor-pointer flex items-center gap-2 px-3 py-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50/80">
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          Stage breakdown ({pipeline.stages.length})
        </summary>
        <div className="border-t border-slate-200/80 px-3 py-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-200/80">
                  <th className="py-2 pr-4 text-left font-semibold text-slate-500">Stage</th>
                  <th className="py-2 pr-4 text-left font-semibold text-slate-500">Jobs</th>
                  <th className="py-2 text-left font-semibold text-slate-500">Kinds</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.stages.map((stage, index) => (
                  <tr key={stage.name} className="border-t border-slate-100/80">
                    <td className="py-2 pr-4">
                      <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-medium", stageColor(index))}>
                        {stage.name}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-slate-700">{stage.jobs.length}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {stage.jobs.length > 0
                          ? [...new Set(stage.jobs.map((j) => j.kind))].map((kind) => (
                            <span key={kind} className={cx("rounded-full border px-1.5 py-0.5 text-[9px]", JOB_KIND_STYLES[kind])}>
                              {kind}
                            </span>
                          ))
                          : <span className="text-slate-400 italic">empty</span>
                        }
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
