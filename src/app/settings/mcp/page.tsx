"use client";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { McpServersTab } from "@/client/components/settings-panel-mcp-tab";

export default function McpSettingsPage() {
  return (
    <SettingsRouteShell
      title="MCP Servers"
      description="Manage Model Context Protocol servers, transports, and local integration points for your workspace."
      badgeLabel="Integration"
    >
      <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 shadow-sm">
        <McpServersTab />
      </div>
    </SettingsRouteShell>
  );
}
