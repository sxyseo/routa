"use client";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { FitnessAnalysisPanel } from "@/client/components/fitness-analysis-panel";

export default function FitnessSettingsPage() {
  return (
    <SettingsRouteShell
      title="Fitness"
      description="Run and compare Rust Fitness profiles to inspect AI engineering maturity and generate improvement guidance."
      badgeLabel="AI Health"
      icon={(
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75v10.5m5.25-5.25H6.75m10.35-3.3L12 3.75m-5.25 10.95L3 12m18 0l-3.75-2.1M7.5 17.25L3 12m18 0-4.5 2.25M8.25 7.5a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0z" />
        </svg>
      )}
      summary={[
        { label: "Profiles", value: "Generic + Agent Orchestrator" },
        { label: "Scope", value: "repo-level harness quality checks" },
      ]}
    >
      <div className="space-y-6">
        <SettingsPageHeader
          title="Fitness"
          description="Run one profile, or compare Generic 与 Agent Orchestrator 两套评分模型，快速发现 AI 工程短板与建议。"
          metadata={[
            { label: "Input", value: "仓库快照" },
            { label: "Output", value: "维度分数、阻塞项与建议" },
          ]}
        />

        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 p-4 shadow-sm">
          <FitnessAnalysisPanel />
        </div>
      </div>
    </SettingsRouteShell>
  );
}
