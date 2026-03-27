"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { DesktopAppShell } from "./desktop-app-shell";

interface SettingsRouteShellProps {
  title: string;
  description: string;
  children: ReactNode;
  badgeLabel?: string;
}

export function SettingsRouteShell({ title, description, children, badgeLabel = "Standalone tool" }: SettingsRouteShellProps) {
  const router = useRouter();

  return (
    <DesktopAppShell
      workspaceSwitcher={(
        <div className="flex items-center gap-1.5 rounded-xl border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-primary">
          <svg className="h-3 w-3 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          </svg>
          <span>Settings</span>
        </div>
      )}
    >
      <div className="flex h-full min-h-0 bg-desktop-bg-primary text-desktop-text-primary">
        <aside className="flex w-64 shrink-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary px-4 py-5">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
            <span>Back to app</span>
          </button>

          <div className="mt-8 space-y-6">
            <div>
              <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-tertiary">
                Workspace Tools
              </p>
              <div className="mt-2 space-y-1">
                <div className="rounded-xl bg-desktop-bg-active px-3 py-2 text-sm text-desktop-accent">
                  {title}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/70 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-tertiary">{badgeLabel}</p>
              <p className="mt-2 text-sm leading-6 text-desktop-text-secondary">
                Use this page for focused configuration without mixing it back into the main Config screen.
              </p>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-desktop-border px-8 py-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-tertiary">Workspace Tools</p>
            <h1 className="mt-2 text-3xl font-semibold text-desktop-text-primary">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-desktop-text-secondary">{description}</p>
          </header>
          <main className="flex-1 min-h-0 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-8 py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </DesktopAppShell>
  );
}
