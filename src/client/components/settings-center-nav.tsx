"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n";

import type { SettingsTab } from "./settings-panel-shared";

interface SettingsCenterNavProps {
  activeItem?: SettingsNavItem;
  workspaceId?: string | null;
}

export type SettingsNavItem =
  | SettingsTab
  | "specialists"
  | "mcp"
  | "workflows"
  | "schedules"
  | "system-jobs";

function appendWorkspaceId(href: string, workspaceId: string | null | undefined): string {
  if (!workspaceId) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}workspaceId=${encodeURIComponent(workspaceId)}`;
}

export function SettingsCenterNav({ activeItem, workspaceId }: SettingsCenterNavProps) {
  const { t } = useTranslation();
  const configItems: Array<{ key: SettingsNavItem; label: string; href: string }> = [
    { key: "providers", label: t.settings.providers, href: appendWorkspaceId("/settings?tab=providers", workspaceId) },
    { key: "registry", label: t.settings.registry, href: appendWorkspaceId("/settings?tab=registry", workspaceId) },
    { key: "roles", label: t.settings.roleDefaults, href: appendWorkspaceId("/settings?tab=roles", workspaceId) },
    { key: "models", label: t.settings.models, href: appendWorkspaceId("/settings?tab=models", workspaceId) },
    { key: "webhooks", label: t.settings.webhooks, href: appendWorkspaceId("/settings?tab=webhooks", workspaceId) },
  ];
  const workspaceToolItems: Array<{ key: SettingsNavItem; label: string; href: string }> = [
    { key: "specialists", label: t.nav.specialists, href: appendWorkspaceId("/settings/specialists", workspaceId) },
    { key: "mcp", label: t.nav.mcpServers, href: appendWorkspaceId("/settings/mcp", workspaceId) },
    { key: "workflows", label: t.nav.workflows, href: appendWorkspaceId("/settings/workflows", workspaceId) },
    { key: "schedules", label: t.nav.schedules, href: appendWorkspaceId("/settings/schedules", workspaceId) },
    { key: "system-jobs", label: t.systemJobs.navLabel, href: appendWorkspaceId("/settings/system-jobs", workspaceId) },
  ];

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary px-4 py-5">
      <div className="mt-4 space-y-6">
        <NavGroup
          label={t.settings.config}
          items={configItems.map((item) => ({
            ...item,
            active: activeItem === item.key,
          }))}
        />
        <NavGroup
          label={t.settings.workspaceTools}
          items={workspaceToolItems.map((item) => ({
            ...item,
            active: activeItem === item.key,
          }))}
        />
      </div>
    </aside>
  );
}

function NavGroup({
  label,
  items,
}: {
  label: string;
  items: Array<{ key: string; label: string; href: string; active: boolean }>;
}) {
  return (
    <div>
      <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-tertiary">
        {label}
      </p>
      <div className="mt-2 space-y-1">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`flex items-center rounded-xl px-3 py-2 text-sm transition-colors ${
              item.active
                ? "bg-desktop-bg-active text-desktop-accent"
                : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
