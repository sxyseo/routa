"use client";

/**
 * Scheduled Triggers Settings Page - /settings/schedules
 *
 * Provides a full-page UI for configuring cron-based scheduled agent triggers.
 * Agents run automatically on a recurring schedule (dependency updates, audits, etc.)
 */

import Link from "next/link";
import { SchedulePanel } from "@/client/components/schedule-panel";

export default function SchedulesSettingsPage() {
  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-[#0f1117]">
      {/* Header */}
      <header className="shrink-0 px-5 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#13151d] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            title="Back to Home"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Scheduled Triggers
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Run agents automatically on a recurring cron schedule
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
            <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">Tick endpoint:</span>
            <code className="text-xs text-blue-600 dark:text-blue-300 font-mono">
              /api/schedules/tick
            </code>
          </div>
          <a
            href="https://github.com/phodal/routa/issues/36"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            See Issue #36 →
          </a>
        </div>
      </header>

      {/* Info banner */}
      <div className="shrink-0 px-5 py-2.5 bg-blue-50 dark:bg-blue-900/10 border-b border-blue-100 dark:border-blue-900/30">
        <p className="text-xs text-blue-700 dark:text-blue-400">
          <span className="font-semibold">How it works:</span>{" "}
          Define a cron expression and task prompt. Every minute, <code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900/30 rounded font-mono">/api/schedules/tick</code> fires
          any due schedules as background tasks. In production on Vercel, the tick is called by Vercel Cron Jobs.{" "}
          Locally, an in-process <span className="font-medium">node-cron</span> job handles the polling automatically.
        </p>
      </div>

      {/* Main Content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <SchedulePanel />
      </main>
    </div>
  );
}
