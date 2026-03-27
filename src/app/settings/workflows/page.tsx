"use client";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { WorkflowPanel } from "@/client/components/workflow-panel";

export default function WorkflowSettingsPage() {
  return (
    <SettingsRouteShell
      title="Workflows"
      description="Compose and run recurring workflows that coordinate multiple actions, triggers, and agents."
      badgeLabel="Automation"
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 px-5 py-4 shadow-sm">
          <p className="text-sm font-medium text-desktop-text-primary">Workflow library</p>
          <p className="mt-1 text-sm text-desktop-text-secondary">
            Create reusable multi-step flows, inspect their execution graph, and launch them against the current workspace.
          </p>
        </div>

        <WorkflowPanel />
      </div>
    </SettingsRouteShell>
  );
}
