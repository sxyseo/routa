"use client";

import { SettingsCenterNav } from "@/client/components/settings-center-nav";
import { SystemJobsPanel } from "@/client/components/system-jobs-panel";
import { useTranslation } from "@/i18n";

export function SystemJobsPageClient() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-screen">
      <SettingsCenterNav activeItem="system-jobs" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-lg font-semibold text-desktop-text-primary">
            {t.systemJobs.title}
          </h1>
          <p className="mt-1 text-sm text-desktop-text-tertiary">
            {t.systemJobs.subtitle}
          </p>
          <div className="mt-6">
            <SystemJobsPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
