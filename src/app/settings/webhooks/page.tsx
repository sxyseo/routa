/**
 * Settings / Webhooks - /settings/webhooks
 * Settings page for configuring GitHub webhook ingestion and inspecting the webhook endpoint used by Routa.
 */
"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";

import { GitHubWebhookPanel } from "@/client/components/github-webhook-panel";
import { GitLabWebhookPanel } from "@/client/components/gitlab-webhook-panel";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { useTranslation } from "@/i18n";

type Platform = "github" | "gitlab";

export default function WebhookSettingsPage() {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<Platform>("github");
  const wt = t.webhook;

  const webhookUrl = platform === "github" ? "/api/webhooks/github" : "/api/webhooks/gitlab";

  return (
    <SettingsRouteShell
      title={t.settings.webhooksPageTitle}
      description={t.settings.webhooksPageDescription}
      badgeLabel={platform === "github" ? "GitHub" : "GitLab"}
      icon={(
        <Link2 className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      contentClassName="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <SettingsPageHeader
          title={t.settings.webhooksPageTitle}
          metadata={[
            { label: wt.platformSwitcherLabel, value: platform === "github" ? wt.platformGithub : wt.platformGitlab },
            { label: t.settings.webhookUrl, value: webhookUrl },
          ]}
        />
        {/* Platform switcher */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-3">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{wt.platformSwitcherLabel}:</span>
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setPlatform("github")}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                platform === "github"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {wt.platformGithub}
            </button>
            <button
              onClick={() => setPlatform("gitlab")}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                platform === "gitlab"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {wt.platformGitlab}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div className="h-full border border-desktop-border bg-desktop-bg-primary">
            {platform === "github" ? <GitHubWebhookPanel /> : <GitLabWebhookPanel />}
          </div>
        </div>
      </div>
    </SettingsRouteShell>
  );
}
