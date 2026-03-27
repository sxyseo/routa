"use client";

import { useState } from "react";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SpecialistsTab } from "@/client/components/settings-panel-specialists-tab";
import { loadModelDefinitions } from "@/client/components/settings-panel-shared";

export default function SpecialistsSettingsPage() {
  const [modelDefs] = useState(() => loadModelDefinitions());

  return (
    <SettingsRouteShell
      title="Specialists"
      description="Create and manage custom specialists, prompts, and model bindings for focused execution roles."
      badgeLabel="Execution roles"
    >
      <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 shadow-sm">
        <SpecialistsTab modelDefs={modelDefs} />
      </div>
    </SettingsRouteShell>
  );
}
