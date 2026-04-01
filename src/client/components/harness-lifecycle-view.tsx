"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import Image from "next/image";

type LifecycleNodeData = {
  nodeId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  active?: boolean;
  connected?: boolean;
  partiallyConnected?: boolean;
};

type HarnessLifecycleViewProps = {
  selectedNodeId?: string | null;
  onSelectedNodeChange?: (nodeId: string) => void;
  contextPanel?: ReactNode;
  designDecisionNodeEnabled?: boolean;
  dimensionCount?: number;
  metricCount?: number;
  hardGateCount?: number;
  hookCount?: number;
  workflowCount?: number;
};

// Define node areas based on the SVG layout (approximate coordinates)
const LIFECYCLE_NODES: LifecycleNodeData[] = [
  { nodeId: "thinking", title: "需求定义", x: 28, y: 172, width: 170, height: 216, connected: true },
  { nodeId: "coding", title: "设计决策", x: 212, y: 172, width: 170, height: 216, connected: true },
  { nodeId: "build", title: "编码实现", x: 396, y: 172, width: 170, height: 216, connected: true },
  { nodeId: "test", title: "本地验证", x: 580, y: 172, width: 170, height: 216, connected: true },
  { nodeId: "commit", title: "主干集成", x: 764, y: 172, width: 170, height: 216, partiallyConnected: true },
  { nodeId: "review", title: "代码评审", x: 948, y: 172, width: 170, height: 216, connected: true },
  { nodeId: "precommit", title: "变更门禁", x: 1132, y: 172, width: 170, height: 216, connected: true },
  { nodeId: "release", title: "制品发布", x: 1316, y: 172, width: 170, height: 216, connected: true },
  { nodeId: "staging", title: "预生产验证", x: 1500, y: 172, width: 170, height: 216, partiallyConnected: true },
  { nodeId: "production", title: "生产运行", x: 1684, y: 172, width: 170, height: 216, partiallyConnected: true },
  { nodeId: "observability", title: "监控演进", x: 1868, y: 172, width: 170, height: 216, connected: false },
];

const SELECTABLE_NODE_IDS = new Set([
  "thinking",
  "coding",
  "build",
  "test",
  "precommit",
  "review",
  "release",
]);

export function HarnessLifecycleView({
  selectedNodeId,
  onSelectedNodeChange,
  contextPanel,
  designDecisionNodeEnabled = true,
}: HarnessLifecycleViewProps) {
  const activeSelectedNodeId = selectedNodeId ?? null;

  const handleNodeClick = (nodeId: string) => {
    if (!SELECTABLE_NODE_IDS.has(nodeId)) {
      return;
    }
    onSelectedNodeChange?.(nodeId);
  };

  const selectableNodes = useMemo(() => {
    return LIFECYCLE_NODES.filter((node) => {
      if (node.nodeId === "coding" && !designDecisionNodeEnabled) {
        return false;
      }
      return SELECTABLE_NODE_IDS.has(node.nodeId);
    });
  }, [designDecisionNodeEnabled]);

  return (
    <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-desktop-text-primary">Lifecycle View</h3>
          <p className="mt-1 text-[12px] leading-6 text-desktop-text-secondary">
            从需求到交付的完整生命周期治理视图
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 rounded-xl border border-desktop-border bg-white p-4">
          <div className="relative overflow-x-auto">
            {/* Base SVG */}
            <div className="relative" style={{ minWidth: "1024px" }}>
              <Image
                src="/harness-lifecycle-view.svg"
                alt="Harness Lifecycle View"
                width={2048}
                height={667}
                className="w-full h-auto"
                priority
              />

              {/* Overlay interactive hotspots */}
              <svg
                viewBox="0 0 2048 667"
                className="absolute inset-0 w-full h-full pointer-events-none"
              >
                {selectableNodes.map((node) => (
                  <rect
                    key={node.nodeId}
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    fill="transparent"
                    stroke={activeSelectedNodeId === node.nodeId ? "#3b82f6" : "transparent"}
                    strokeWidth={activeSelectedNodeId === node.nodeId ? 3 : 0}
                    className="cursor-pointer transition-all hover:fill-blue-500/5 pointer-events-auto"
                    onClick={() => handleNodeClick(node.nodeId)}
                    role="button"
                    aria-label={node.title}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleNodeClick(node.nodeId);
                      }
                    }}
                  />
                ))}
              </svg>
            </div>
          </div>
        </div>

        {contextPanel ? (
          <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">{contextPanel}</div>
        ) : null}
      </div>
    </div>
  );
}

