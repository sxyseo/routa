"use client";

import { useMemo, useState } from "react";
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

export type RunnerKind = "shell" | "graph" | "sarif";
export type TierValue = "fast" | "normal" | "deep";
export type ScopeValue = "local" | "ci" | "staging" | "prod_observation";

export type PlannedMetric = {
  name: string;
  command: string;
  description: string;
  tier: TierValue;
  gate: string;
  hardGate: boolean;
  runner: RunnerKind;
  executionScope: ScopeValue;
};

export type PlannedDimension = {
  name: string;
  weight: number;
  thresholdPass: number;
  thresholdWarn: number;
  sourceFile: string;
  metrics: PlannedMetric[];
};

export type PlanResponse = {
  generatedAt: string;
  tier: TierValue;
  scope: ScopeValue;
  repoRoot: string;
  dimensionCount: number;
  metricCount: number;
  hardGateCount: number;
  runnerCounts: Record<RunnerKind, number>;
  dimensions: PlannedDimension[];
};

type PlanNodeKind = "root" | "stage" | "dimension" | "metric";
type EdgeStatus = "hard" | "warn" | "pass" | "blocked" | "flow";

type PlanNodeData = {
  kind: PlanNodeKind;
  title: string;
  subtitle?: string;
  meta?: string[];
  status?: EdgeStatus;
  expanded?: boolean;
  onToggle?: () => void;
};

type HarnessExecutionPlanFlowProps = {
  loading: boolean;
  error: string | null;
  plan: PlanResponse | null;
  repoLabel: string;
  selectedTier: TierValue;
  onTierChange: (tier: TierValue) => void;
};

function getStatusTone(status: EdgeStatus | undefined) {
  switch (status) {
    case "hard":
      return {
        badge: "border-red-200 bg-red-50 text-red-700",
        border: "border-red-200",
        glow: "shadow-red-100/80",
      };
    case "warn":
      return {
        badge: "border-amber-200 bg-amber-50 text-amber-700",
        border: "border-amber-200",
        glow: "shadow-amber-100/80",
      };
    case "pass":
      return {
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        border: "border-emerald-200",
        glow: "shadow-emerald-100/80",
      };
    case "blocked":
      return {
        badge: "border-slate-300 bg-slate-100 text-slate-700",
        border: "border-slate-300",
        glow: "shadow-slate-200/80",
      };
    default:
      return {
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        border: "border-desktop-border",
        glow: "shadow-black/5",
      };
  }
}

function PlanNodeView({ data }: NodeProps<Node<PlanNodeData>>) {
  const tone = getStatusTone(data.status);
  const interactive = typeof data.onToggle === "function";
  const widthClass = data.kind === "metric"
    ? "w-[232px]"
    : data.kind === "dimension"
      ? "w-[252px]"
      : "w-[292px]";
  const visibleMeta = data.kind === "dimension" || data.kind === "metric"
    ? data.meta ?? []
    : [];

  return (
    <div className="relative">
      <Handle id="top" type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="left" type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="right" type="target" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="left" type="source" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="right" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <button
        type="button"
        onClick={() => {
          data.onToggle?.();
        }}
        className={`${widthClass} rounded-2xl border bg-desktop-bg-primary/96 px-4 py-3 text-left shadow-sm transition ${tone.border} ${tone.glow} ${interactive ? "cursor-pointer hover:bg-desktop-bg-secondary/90" : "cursor-default"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{data.kind}</div>
            <div className="mt-1 text-[13px] font-semibold text-desktop-text-primary">{data.title}</div>
            {data.subtitle ? (
              <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                {data.subtitle}
              </div>
            ) : null}
          </div>
          {data.status ? (
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}>
              {data.status}
            </span>
          ) : null}
        </div>
        {visibleMeta.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {visibleMeta.map((item) => (
              <span key={item} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                {item}
              </span>
            ))}
          </div>
        ) : null}
        {interactive ? (
          <div className="mt-3 text-[10px] text-desktop-text-secondary">
            {data.expanded ? "Click to collapse metrics" : "Click to expand metrics"}
          </div>
        ) : null}
      </button>
    </div>
  );
}

const nodeTypes = {
  plan: PlanNodeView,
};

function buildEdgeStyle(status: EdgeStatus) {
  switch (status) {
    case "hard":
      return { stroke: "#dc2626", strokeWidth: 1.8 };
    case "warn":
      return { stroke: "#d97706", strokeWidth: 1.8 };
    case "pass":
      return { stroke: "#059669", strokeWidth: 1.8 };
    case "blocked":
      return { stroke: "#64748b", strokeWidth: 1.8, strokeDasharray: "6 4" };
    default:
      return { stroke: "#94a3b8", strokeWidth: 1.3 };
  }
}

function buildNode(id: string, x: number, y: number, data: PlanNodeData): Node<PlanNodeData> {
  return {
    id,
    type: "plan",
    position: { x, y },
    data,
    draggable: true,
    selectable: true,
    sourcePosition: data.kind === "metric" ? Position.Right : Position.Bottom,
    targetPosition: data.kind === "metric" ? Position.Left : Position.Top,
  };
}

function buildPlanGraph(
  plan: PlanResponse,
  expandedDimensions: Set<string>,
  toggleDimension: (name: string) => void,
): { nodes: Node<PlanNodeData>[]; edges: Edge[]; minHeight: number } {
  const nodes: Node<PlanNodeData>[] = [];
  const edges: Edge[] = [];

  const stageX = 420;
  const dimensionsTopY = 470;
  const dimensionsStartX = 72;
  const dimensionColumnWidth = 284;
  const dimensionColumns = Math.max(plan.dimensions.length, 1);
  const dimensionRowHeight = 180;
  const metricRowOffsetY = 92;
  const metricSpacingX = 264;
  const metricRowHeight = 176;
  const metricColumns = 4;
  const rowContentHeight = 124;
  const dimensionPositions = new Map<string, { x: number; y: number }>();

  nodes.push(
    buildNode("root", stageX, 24, {
      kind: "root",
      title: "Execution Plan",
      subtitle: `${plan.dimensionCount} dimensions · ${plan.metricCount} metrics`,
      meta: [`tier ${plan.tier}`, `scope ${plan.scope}`, `${plan.hardGateCount} hard gates`],
    }),
    buildNode("filter", stageX, 168, {
      kind: "stage",
      title: "Filter",
      subtitle: "Tier and scope decide which checks survive planning.",
      meta: [`tier <= ${plan.tier}`, `scope = ${plan.scope}`, `${plan.dimensionCount} dimensions`],
      status: "pass",
    }),
    buildNode("dispatch", stageX, 312, {
      kind: "stage",
      title: "Dispatch",
      subtitle: "Metrics route to shell, graph, or sarif runners.",
      meta: [`shell ${plan.runnerCounts.shell}`, `graph ${plan.runnerCounts.graph}`, `sarif ${plan.runnerCounts.sarif}`],
      status: "pass",
    }),
  );

  edges.push(
    {
      id: "root-filter",
      source: "root",
      target: "filter",
      type: "smoothstep",
      style: buildEdgeStyle("flow"),
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
    },
    {
      id: "filter-dispatch",
      source: "filter",
      target: "dispatch",
      type: "smoothstep",
      style: buildEdgeStyle("pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: "#059669" },
    },
  );

  let maxMetricRight = 0;
  let dimensionGridBottom = dimensionsTopY;

  const activeDimensionName = plan.dimensions.find((dimension) => expandedDimensions.has(dimension.name))?.name ?? null;

  plan.dimensions.forEach((dimension, dimensionIndex) => {
    const dimensionColumn = dimensionIndex % dimensionColumns;
    const dimensionRow = Math.floor(dimensionIndex / dimensionColumns);
    const dimensionX = dimensionsStartX + dimensionColumn * dimensionColumnWidth;
    const dimensionY = dimensionsTopY + dimensionRow * dimensionRowHeight;
    const dimensionId = `dimension:${dimension.name}`;
    const expanded = expandedDimensions.has(dimension.name);
    const hasHardMetric = dimension.metrics.some((metric) => metric.hardGate);
    dimensionPositions.set(dimension.name, { x: dimensionX, y: dimensionY });

    nodes.push(buildNode(dimensionId, dimensionX, dimensionY, {
      kind: "dimension",
      title: dimension.name,
      subtitle: `${dimension.sourceFile} · pass ${dimension.thresholdPass} / warn ${dimension.thresholdWarn}`,
      meta: [`weight ${dimension.weight}`, `${dimension.metrics.length} metrics`],
      status: hasHardMetric ? "hard" : "pass",
      expanded,
      onToggle: () => {
        toggleDimension(dimension.name);
      },
    }));

    const dispatchEdgeStatus: EdgeStatus = dimension.name === activeDimensionName
      ? (hasHardMetric ? "hard" : "pass")
      : "flow";

    edges.push({
      id: `dispatch-${dimensionId}`,
      source: "dispatch",
      target: dimensionId,
      type: "smoothstep",
      sourceHandle: "bottom",
      targetHandle: "top",
      style: buildEdgeStyle(dispatchEdgeStatus),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: dispatchEdgeStatus === "hard" ? "#dc2626" : dispatchEdgeStatus === "pass" ? "#059669" : "#94a3b8",
      },
    });

    dimensionGridBottom = Math.max(dimensionGridBottom, dimensionY + rowContentHeight);
  });

  const activeDimension = plan.dimensions.find((dimension) => expandedDimensions.has(dimension.name)) ?? null;
  let currentMetricsY = dimensionGridBottom + metricRowOffsetY;

  if (activeDimension) {
    const dimensionId = `dimension:${activeDimension.name}`;
    const detailColumns = Math.min(metricColumns, Math.max(activeDimension.metrics.length, 1));
    const centeredMetricStartX = Math.max(72, stageX - ((detailColumns - 1) * metricSpacingX) / 2);
    let metricGridBottom = currentMetricsY;

    activeDimension.metrics.forEach((metric, metricIndex) => {
      const metricId = `${dimensionId}:metric:${metric.name}`;
      const metricColumn = metricIndex % metricColumns;
      const metricRow = Math.floor(metricIndex / metricColumns);
      const metricX = centeredMetricStartX + metricColumn * metricSpacingX;
      const metricY = currentMetricsY + metricRow * metricRowHeight;
      const metricStatus: EdgeStatus = metric.hardGate ? "hard" : metric.gate === "warn" ? "warn" : "pass";

      nodes.push(buildNode(metricId, metricX, metricY, {
        kind: "metric",
        title: metric.name,
        subtitle: metric.description || undefined,
        meta: [metric.runner, metric.tier, metric.executionScope, metric.hardGate ? "hard gate" : metric.gate || "pass"],
        status: metricStatus,
      }));

      edges.push({
        id: `${dimensionId}-${metricId}`,
        source: dimensionId,
        target: metricId,
        type: "smoothstep",
        sourceHandle: "bottom",
        targetHandle: "top",
        style: buildEdgeStyle(metricStatus),
        markerEnd: { type: MarkerType.ArrowClosed, color: metricStatus === "hard" ? "#dc2626" : metricStatus === "warn" ? "#d97706" : "#059669" },
      });

      maxMetricRight = Math.max(maxMetricRight, metricX + 208);
      metricGridBottom = Math.max(metricGridBottom, metricY + rowContentHeight);
    });

    currentMetricsY = metricGridBottom;
  }

  const detailLaneY = currentMetricsY;
  const gatesX = stageX;
  const gatesY = detailLaneY + 24;
  const reportX = stageX;
  const reportY = gatesY + 148;

  nodes.push(
    buildNode("gates", gatesX, gatesY, {
      kind: "stage",
      title: "Gates",
      subtitle: "Hard-gated dimensions can stop the report path.",
      meta: [`${plan.hardGateCount} hard`, "blocked on failure"],
      status: plan.hardGateCount > 0 ? "blocked" : "pass",
    }),
    buildNode("report", reportX, reportY, {
      kind: "stage",
      title: "Report",
      subtitle: "Weighted dimension score and final state.",
      meta: ["weighted score", "thresholds", "final status"],
      status: "pass",
    }),
  );

  edges.push({
    id: "gates-report",
    source: "gates",
    target: "report",
    type: "smoothstep",
    sourceHandle: "bottom",
    targetHandle: "top",
    style: buildEdgeStyle(plan.hardGateCount > 0 ? "blocked" : "pass"),
    markerEnd: { type: MarkerType.ArrowClosed, color: plan.hardGateCount > 0 ? "#64748b" : "#059669" },
  });

  if (activeDimension) {
    const dimensionId = `dimension:${activeDimension.name}`;
    const hasHardMetric = activeDimension.metrics.some((metric) => metric.hardGate);

    edges.push({
      id: `${dimensionId}-report`,
      source: dimensionId,
      target: "report",
      type: "smoothstep",
      sourceHandle: "bottom",
      targetHandle: "top",
      style: buildEdgeStyle(hasHardMetric ? "warn" : "pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: hasHardMetric ? "#d97706" : "#059669" },
    });

    if (hasHardMetric) {
      edges.push({
        id: `${dimensionId}-gates`,
        source: dimensionId,
        target: "gates",
        type: "smoothstep",
        sourceHandle: "bottom",
        targetHandle: "top",
        style: buildEdgeStyle("hard"),
        markerEnd: { type: MarkerType.ArrowClosed, color: "#dc2626" },
      });
    }
  }

  return {
    nodes,
    edges,
    minHeight: Math.max(920, reportY + 180),
  };
}

export function HarnessExecutionPlanFlow({
  loading,
  error,
  plan,
  repoLabel,
  selectedTier,
  onTierChange,
}: HarnessExecutionPlanFlowProps) {
  const [expandedState, setExpandedState] = useState<{
    planKey: string | null;
    names: Set<string>;
  }>({
    planKey: null,
    names: new Set(),
  });

  const planKey = useMemo(() => {
    if (!plan) {
      return null;
    }
    return `${plan.repoRoot}:${plan.tier}:${plan.scope}:${plan.generatedAt}`;
  }, [plan]);

  const expandedDimensions = useMemo(() => {
    if (!plan) {
      return new Set<string>();
    }
    if (expandedState.planKey === planKey) {
      return expandedState.names;
    }
    return new Set(plan.dimensions.slice(0, 1).map((dimension) => dimension.name));
  }, [expandedState.names, expandedState.planKey, plan, planKey]);

  const graph = useMemo(() => {
    if (!plan) {
      return { nodes: [] as Node<PlanNodeData>[], edges: [] as Edge[], minHeight: 920 };
    }

    return buildPlanGraph(plan, expandedDimensions, (name) => {
      setExpandedState({
        planKey,
        names: expandedDimensions.has(name) ? new Set<string>() : new Set([name]),
      });
    });
  }, [expandedDimensions, plan, planKey]);

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Execution plan</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Top-down flow for dimensions and metrics</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-desktop-border bg-desktop-bg-primary p-0.5">
            {(["fast", "normal", "deep"] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => {
                  onTierChange(tier);
                }}
                className={`rounded-full px-2.5 py-1 text-[10px] transition-colors ${
                  selectedTier === tier
                    ? "bg-desktop-accent text-desktop-accent-text"
                    : "text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                }`}
              >
                {tier}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!plan) {
                return;
              }
              setExpandedState((current) => {
                const base = current.planKey === planKey ? current.names : expandedDimensions;
                return {
                  planKey,
                  names: base.size > 0 ? new Set<string>() : new Set(plan.dimensions.slice(0, 1).map((dimension) => dimension.name)),
                };
              });
            }}
            className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary"
          >
            {expandedDimensions.size > 0 ? "Hide metrics" : "Show metrics"}
          </button>
          <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
            {repoLabel}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Building execution topology...
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {error}
        </div>
      ) : null}

      {plan ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-[10px] text-desktop-text-secondary">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">pass = scoring path</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">warn = degraded dimension</span>
            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">hard = blocking gate</span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-slate-700">blocked = report can stop</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-desktop-border bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_28%)]">
            <div style={{ height: graph.minHeight }}>
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
                zoomOnScroll
                panOnDrag
                minZoom={0.42}
                maxZoom={1.2}
                fitView
                fitViewOptions={{ padding: 0.07, minZoom: 0.46, maxZoom: 0.95 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#d7dee7" gap={20} size={1} />
                <Controls showInteractive={false} position="bottom-right" />
              </ReactFlow>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
