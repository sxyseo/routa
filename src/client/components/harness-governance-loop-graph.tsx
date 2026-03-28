"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { HarnessAgentInstructionsPanel } from "@/client/components/harness-agent-instructions-panel";
import type { TierValue } from "@/client/components/harness-execution-plan-flow";

type HookPhase = "submodule" | "fitness" | "fitness-fast" | "review";

type HookRuntimeProfileSummary = {
  name: string;
  phases: HookPhase[];
  metrics: Array<{ name: string }>;
  hooks: string[];
};

type HooksResponse = {
  hookFiles: Array<{ name: string }>;
  profiles: HookRuntimeProfileSummary[];
};

type GitHubActionsFlow = {
  id: string;
  name: string;
  event: string;
  jobs: Array<{ id: string }>;
};

type GitHubActionsFlowsResponse = {
  flows: GitHubActionsFlow[];
};

type HookSummary = {
  hookCount: number;
  profileCount: number;
  mappedMetricCount: number;
  phaseCount: number;
  phaseLabels: string[];
};

type WorkflowSummary = {
  flowCount: number;
  jobCount: number;
  remoteSignals: string[];
};

type InstructionSummary = {
  fileName: string;
  fallbackUsed: boolean;
};

type SummaryState<T> = {
  data: T | null;
  error: string | null;
  loadedContextKey: string;
};

type HarnessGovernanceLoopGraphProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  selectedTier: TierValue;
  specsLoading: boolean;
  specsError: string | null;
  fitnessFileCount: number;
  dimensionCount: number;
  planLoading: boolean;
  planError: string | null;
  metricCount: number;
  hardGateCount: number;
};

type LoopNodeKind = "core" | "local" | "spec" | "plan" | "remote" | "feedback";
type LoopTone = "neutral" | "sky" | "emerald" | "amber" | "violet";

type LoopNodeData = {
  kind: LoopNodeKind;
  title: string;
  subtitle: string;
  meta: string[];
  tone: LoopTone;
};

const PHASE_LABELS: Record<HookPhase, string> = {
  submodule: "submodule",
  fitness: "fitness",
  "fitness-fast": "fitness-fast",
  review: "review",
};

function getNodeToneClasses(tone: LoopTone) {
  switch (tone) {
    case "sky":
      return {
        border: "border-sky-200",
        badge: "border-sky-200 bg-sky-50 text-sky-700",
        shadow: "shadow-sky-100/80",
      };
    case "emerald":
      return {
        border: "border-emerald-200",
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        shadow: "shadow-emerald-100/80",
      };
    case "amber":
      return {
        border: "border-amber-200",
        badge: "border-amber-200 bg-amber-50 text-amber-700",
        shadow: "shadow-amber-100/80",
      };
    case "violet":
      return {
        border: "border-violet-200",
        badge: "border-violet-200 bg-violet-50 text-violet-700",
        shadow: "shadow-violet-100/80",
      };
    default:
      return {
        border: "border-desktop-border",
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        shadow: "shadow-black/5",
      };
  }
}

function LoopNodeView({ data }: NodeProps<Node<LoopNodeData>>) {
  const tone = getNodeToneClasses(data.tone);
  const isCore = data.kind === "core";

  return (
    <div className="relative">
      <Handle id="target-top" type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="target-right" type="target" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="target-bottom" type="target" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="target-left" type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="source-top" type="source" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="source-right" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="source-bottom" type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="source-left" type="source" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <div className={isCore
        ? `flex h-[208px] w-[208px] flex-col items-center justify-center rounded-full border bg-desktop-bg-primary/96 px-5 py-5 text-center shadow-sm ${tone.border} ${tone.shadow}`
        : `w-[188px] rounded-[24px] border bg-desktop-bg-primary/96 px-4 py-3 shadow-sm ${tone.border} ${tone.shadow}`}>
        <div className={isCore ? "flex flex-col items-center" : "flex items-start justify-between gap-3"}>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{data.kind}</div>
            <div className="mt-1 text-[13px] font-semibold text-desktop-text-primary">{data.title}</div>
            <div className={`mt-1 text-[11px] leading-5 text-desktop-text-secondary ${isCore ? "max-w-[160px]" : ""}`}>{data.subtitle}</div>
          </div>
          {!isCore ? (
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}>
              {data.kind}
            </span>
          ) : null}
        </div>
        <div className={`mt-3 flex flex-wrap gap-1.5 ${isCore ? "justify-center" : ""}`}>
          {data.meta.map((item) => (
            <span key={item} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  governance: LoopNodeView,
};

function buildNode(
  id: string,
  x: number,
  y: number,
  data: LoopNodeData,
): Node<LoopNodeData> {
  return {
    id,
    type: "governance",
    position: { x, y },
    data,
    draggable: false,
    selectable: false,
  };
}

function buildEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  label: string,
  color: string,
  dash?: string,
): Edge {
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep",
    animated: !dash,
    label,
    style: {
      stroke: color,
      strokeWidth: 1.8,
      ...(dash ? { strokeDasharray: dash } : {}),
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
    },
    labelStyle: {
      fontSize: 10,
      fill: "#475569",
      fontWeight: 500,
    },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 8,
    labelBgStyle: {
      fill: "rgba(248, 250, 252, 0.92)",
      fillOpacity: 1,
      stroke: "rgba(203, 213, 225, 0.9)",
    },
  };
}

function summarizeSignals(flows: GitHubActionsFlow[]) {
  const preferredSignals = ["workflow_dispatch", "push", "pull_request", "schedule"];
  const signalSet = new Set(
    flows
      .map((flow) => flow.event)
      .filter((event) => event.trim().length > 0),
  );

  const orderedSignals = preferredSignals.filter((signal) => signalSet.has(signal));
  const extraSignals = [...signalSet].filter((signal) => !preferredSignals.includes(signal));
  return [...orderedSignals, ...extraSignals].slice(0, 3);
}

function buildGraph(args: {
  repoLabel: string;
  selectedTier: TierValue;
  hookSummary: HookSummary | null;
  workflowSummary: WorkflowSummary | null;
  fitnessFileCount: number;
  dimensionCount: number;
  metricCount: number;
  hardGateCount: number;
}) {
  const {
    repoLabel,
    selectedTier,
    hookSummary,
    workflowSummary,
    fitnessFileCount,
    dimensionCount,
    metricCount,
    hardGateCount,
  } = args;

  const nodes: Node<LoopNodeData>[] = [
    buildNode("instructions", -115, 175, {
      kind: "spec",
      title: "Instruction File",
      subtitle: "CLAUDE.md first, AGENTS.md fallback.",
      meta: ["CLAUDE.md", "AGENTS.md"],
      tone: "neutral",
    }),
    buildNode("core", 505, 150, {
      kind: "core",
      title: "Governance Loop",
      subtitle: "Local gates, executable fitness, and CI feedback in one loop.",
      meta: [repoLabel, `tier ${selectedTier}`],
      tone: "neutral",
    }),
    buildNode("hook", 105, 175, {
      kind: "local",
      title: "Hook Runtime",
      subtitle: "First local gate.",
      meta: hookSummary
        ? [`${hookSummary.profileCount} profiles`, `${hookSummary.hookCount} hooks`]
        : ["loading hooks", "git bindings"],
      tone: "sky",
    }),
    buildNode("fitness", 510, 10, {
      kind: "spec",
      title: "Fitness Files",
      subtitle: "Narrative + executable specs.",
      meta: [`${fitnessFileCount} files`, `${dimensionCount} dimensions`],
      tone: "emerald",
    }),
    buildNode("plan", 900, 175, {
      kind: "plan",
      title: "Execution Plan",
      subtitle: "Filter, dispatch, score.",
      meta: [`${metricCount} metrics`, `${hardGateCount} hard gates`],
      tone: "amber",
    }),
    buildNode("actions", 760, 335, {
      kind: "remote",
      title: "GitHub Actions",
      subtitle: "Remote enforcement.",
      meta: workflowSummary
        ? [`${workflowSummary.flowCount} workflows`, `${workflowSummary.jobCount} jobs`]
        : ["loading workflows", "remote checks"],
      tone: "violet",
    }),
    buildNode("feedback", 255, 335, {
      kind: "feedback",
      title: "Evidence",
      subtitle: "Scores feed back.",
      meta: [
        `${hookSummary?.mappedMetricCount ?? metricCount} metrics`,
        `${hardGateCount} gates`,
      ],
      tone: "emerald",
    }),
  ];

  const edges: Edge[] = [
    buildEdge("instructions-hook", "instructions", "hook", "source-right", "target-left", "repo rulebook", "#64748b", "6 4"),
    buildEdge("core-hook", "core", "hook", "source-left", "target-right", "local gate", "#0ea5e9"),
    buildEdge("hook-fitness", "hook", "fitness", "source-top", "target-left", "profile -> dimension", "#38bdf8"),
    buildEdge("fitness-plan", "fitness", "plan", "source-right", "target-top", "frontmatter -> metrics", "#10b981"),
    buildEdge("plan-actions", "plan", "actions", "source-bottom", "target-top", "dispatch remote runners", "#f59e0b"),
    buildEdge("actions-feedback", "actions", "feedback", "source-left", "target-right", "checks + artifacts", "#8b5cf6"),
    buildEdge("feedback-hook", "feedback", "hook", "source-top", "target-bottom", "tighten local loop", "#059669"),
    buildEdge("fitness-feedback", "fitness", "feedback", "source-bottom", "target-top", "score evidence", "#22c55e", "6 4"),
    buildEdge("actions-core", "actions", "core", "source-top", "target-bottom", "remote signal", "#a855f7", "6 4"),
  ];

  return { nodes, edges, minHeight: 560 };
}

export function HarnessGovernanceLoopGraph({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
  selectedTier,
  specsLoading,
  specsError,
  fitnessFileCount,
  dimensionCount,
  planLoading,
  planError,
  metricCount,
  hardGateCount,
}: HarnessGovernanceLoopGraphProps) {
  const hasContext = Boolean(workspaceId && codebaseId && repoPath);
  const contextKey = hasContext ? `${workspaceId}:${codebaseId}:${repoPath}` : "";
  const [hookState, setHookState] = useState<SummaryState<HookSummary>>({
    data: null,
    error: null,
    loadedContextKey: "",
  });
  const [workflowState, setWorkflowState] = useState<SummaryState<WorkflowSummary>>({
    data: null,
    error: null,
    loadedContextKey: "",
  });
  const [instructionsState, setInstructionsState] = useState<SummaryState<InstructionSummary>>({
    data: null,
    error: null,
    loadedContextKey: "",
  });

  useEffect(() => {
    if (!hasContext) {
      return;
    }

    let cancelled = false;
    const query = new URLSearchParams();
    query.set("workspaceId", workspaceId);
    if (codebaseId) {
      query.set("codebaseId", codebaseId);
    }
    if (repoPath) {
      query.set("repoPath", repoPath);
    }

    const queryString = query.toString();

    void fetch(`/api/harness/hooks?${queryString}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook runtime");
        }
        if (cancelled) {
          return;
        }
        const data = payload as HooksResponse;
        const uniquePhases = new Set(
          (data.profiles ?? []).flatMap((profile) => profile.phases ?? []),
        );
        const summary: HookSummary = {
          hookCount: data.hookFiles?.length ?? 0,
          profileCount: data.profiles?.length ?? 0,
          mappedMetricCount: (data.profiles ?? []).reduce((sum, profile) => sum + (profile.metrics?.length ?? 0), 0),
          phaseCount: uniquePhases.size,
          phaseLabels: [...uniquePhases].map((phase) => PHASE_LABELS[phase]).filter(Boolean),
        };
        setHookState({
          data: summary,
          error: null,
          loadedContextKey: contextKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setHookState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          loadedContextKey: contextKey,
        });
      });

    void fetch(`/api/harness/github-actions?${queryString}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitHub Actions workflows");
        }
        if (cancelled) {
          return;
        }
        const data = payload as GitHubActionsFlowsResponse;
        const flows = Array.isArray(data.flows) ? data.flows : [];
        const summary: WorkflowSummary = {
          flowCount: flows.length,
          jobCount: flows.reduce((sum, flow) => sum + (flow.jobs?.length ?? 0), 0),
          remoteSignals: summarizeSignals(flows),
        };
        setWorkflowState({
          data: summary,
          error: null,
          loadedContextKey: contextKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setWorkflowState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          loadedContextKey: contextKey,
        });
      });

    void fetch(`/api/harness/instructions?${queryString}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load guidance document");
        }
        if (cancelled) {
          return;
        }
        setInstructionsState({
          data: {
            fileName: typeof payload?.fileName === "string" ? payload.fileName : "AGENTS.md",
            fallbackUsed: Boolean(payload?.fallbackUsed),
          },
          error: null,
          loadedContextKey: contextKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setInstructionsState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          loadedContextKey: contextKey,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [codebaseId, contextKey, hasContext, repoPath, workspaceId]);

  const hookSummary = hookState.loadedContextKey === contextKey ? hookState.data : null;
  const workflowSummary = workflowState.loadedContextKey === contextKey ? workflowState.data : null;
  const instructionSummary = instructionsState.loadedContextKey === contextKey ? instructionsState.data : null;

  const graph = useMemo(
    () => buildGraph({
      repoLabel,
      selectedTier,
      hookSummary,
      workflowSummary,
      fitnessFileCount,
      dimensionCount,
      metricCount,
      hardGateCount,
    }),
    [dimensionCount, fitnessFileCount, hardGateCount, hookSummary, metricCount, repoLabel, selectedTier, workflowSummary],
  );

  if (instructionSummary) {
    const instructionNode = graph.nodes.find((node) => node.id === "instructions");
    if (instructionNode) {
      instructionNode.data = {
        ...instructionNode.data,
        title: instructionSummary.fileName,
        subtitle: instructionSummary.fallbackUsed ? "Fallback repository rulebook." : "Preferred repository rulebook.",
        meta: instructionSummary.fallbackUsed ? ["fallback", "hook preflight"] : ["preferred", "hook preflight"],
      };
    }
  }

  const graphIssues = [specsError, planError, hookState.error, workflowState.error, instructionsState.error].filter(Boolean);

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Governance loop</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Hook, Fitness, and CI/CD in one loop</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {repoLabel}
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            tier {selectedTier}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
            layered feedback
          </span>
        </div>
      </div>

      {!hasContext ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Select a repository to render the governance loop.
        </div>
      ) : null}

      {hasContext && graphIssues.length > 0 ? (
        <div className="mt-4 space-y-2">
          {graphIssues.map((issue) => (
            <div key={issue} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
              {issue}
            </div>
          ))}
        </div>
      ) : null}

      {hasContext ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2 text-[10px] text-desktop-text-secondary">
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
              {hookSummary ? `${hookSummary.hookCount} hooks` : "loading hooks"}
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
              {specsLoading || planLoading ? "loading fitness" : `${dimensionCount} dimensions`}
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
              {planLoading ? "loading plan" : `${metricCount} metrics`}
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
              {workflowSummary ? `${workflowSummary.flowCount} workflows` : "loading workflows"}
            </span>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-desktop-border bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.08),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(139,92,246,0.08),transparent_30%),radial-gradient(circle_at_left,rgba(14,165,233,0.08),transparent_32%)]">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[220px] w-[220px] rounded-full border border-sky-200/70 bg-sky-50/10" />
              <div className="absolute h-[560px] w-[820px] rounded-[999px] border border-violet-200/60" />
            </div>
            <div style={{ height: graph.minHeight }}>
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                zoomOnScroll
                panOnDrag
                minZoom={0.62}
                maxZoom={1.2}
                fitView
                fitViewOptions={{ padding: 0.04, minZoom: 0.66, maxZoom: 1 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#d7dee7" gap={20} size={1} />
                <Controls showInteractive={false} position="bottom-right" />
              </ReactFlow>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-[10px] text-desktop-text-secondary">
            {(hookSummary?.phaseLabels.length ? hookSummary.phaseLabels : ["submodule", "fitness", "review"]).map((phase) => (
              <span key={phase} className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
                {phase}
              </span>
            ))}
            {(workflowSummary?.remoteSignals.length ? workflowSummary.remoteSignals : ["workflow_dispatch", "push"]).map((signal) => (
              <span key={signal} className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
                {signal}
              </span>
            ))}
          </div>

          <HarnessAgentInstructionsPanel
            workspaceId={workspaceId}
            codebaseId={codebaseId}
            repoPath={repoPath}
            repoLabel={repoLabel}
          />
        </div>
      ) : null}
    </section>
  );
}
