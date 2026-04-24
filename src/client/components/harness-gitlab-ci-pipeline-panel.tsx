"use client";

import { useEffect, useState } from "react";
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
  const borderClass = color.split(" ")[0];
  const bgClass = color.split(" ")[1];

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
}: {
  pipeline: GitLabCIPipeline;
  activeJobId: string;
  onJobSelect: (jobId: string) => void;
  compactMode: boolean;
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

function JobInspector({
  pipeline,
  activeJob,
  compactMode,
}: {
  pipeline: GitLabCIPipeline;
  activeJob: GitLabCIJob | null;
  compactMode: boolean;
}) {
  return (
    <aside className="rounded-sm border border-slate-200/80 bg-white/95 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inspector</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
            {activeJob?.name ?? "Pipeline"}
          </h3>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">
            {activeJob
              ? "Selected job metadata, stage context, and dependency information."
              : "Pipeline-level overview and configuration."}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-500">
          {activeJob ? "Job detail" : "Pipeline detail"}
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
        <div className="rounded-sm border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Dependencies</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeJob?.needs.length ? activeJob.needs.map((need) => (
              <span key={`${activeJob.id}:${need}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                {need}
              </span>
            )) : (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                root
              </span>
            )}
          </div>
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
  const hasContext = Boolean(workspaceId && repoPath);
  const contextKey = hasContext ? `${workspaceId}:${codebaseId ?? "repo-only"}:${repoPath}` : "";

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
      if (codebaseId) query.set("codebaseId", codebaseId);
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
  }, [codebaseId, contextKey, hasContext, hasExternalState, repoPath, workspaceId]);

  const resolvedState = hasExternalState
    ? { error: error ?? null, pipeline: data?.pipeline ?? null, loadedContextKey: contextKey }
    : pipelineState;

  const pipeline = resolvedState.pipeline;
  const isLoading = hasExternalState
    ? Boolean(loading)
    : (hasContext && resolvedState.loadedContextKey !== contextKey && !resolvedState.error);

  const summary = isLoading
    ? t.harness.githubActions.loading
    : unsupportedMessage
      ? t.harness.githubActions.unsupported
      : resolvedState.error
        ? t.harness.githubActions.fetchError
        : !hasContext
          ? t.harness.githubActions.noRepo
          : !pipeline
            ? "No .gitlab-ci.yml"
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
        <HarnessSectionStateFrame>{t.harness.githubActions.loadingWorkflows}</HarnessSectionStateFrame>
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
          No .gitlab-ci.yml found in repository root.
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
        />
        <JobInspector pipeline={pipeline} activeJob={activeJob} compactMode={compactMode} />
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
