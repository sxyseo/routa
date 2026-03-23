"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";

interface DesktopShellHeaderProps {
  workspaceId?: string | null;
  workspaceTitle?: string;
  titleBarRight?: React.ReactNode;
  workspaceSwitcher?: React.ReactNode;
}

export function DesktopShellHeader({
  workspaceId,
  workspaceTitle,
  titleBarRight,
  workspaceSwitcher,
}: DesktopShellHeaderProps) {
  const normalizedWorkspaceId = workspaceId?.trim() || null;
  const workspaceHref = normalizedWorkspaceId ? `/workspace/${normalizedWorkspaceId}` : null;
  const workspaceLabel = workspaceTitle ?? normalizedWorkspaceId ?? "Workspace";

  return (
    <header
      className="h-9 shrink-0 flex items-center border-b border-desktop-border bg-desktop-bg-tertiary select-none"
      data-testid="desktop-shell-header"
    >
      <div className="w-20 h-full app-drag-region" />

      <div className="flex items-center gap-2 px-2">
        <Image src="/logo.svg" alt="Routa" width={16} height={16} className="rounded" />
        <span className="text-[11px] font-medium text-desktop-text-primary">Routa</span>
      </div>

      <div className="ml-3">
        {workspaceSwitcher ?? (
          workspaceHref ? (
          <Link
            href={workspaceHref}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-desktop-text-primary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
          >
            <svg className="w-3 h-3 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            <span className="max-w-[120px] truncate">{workspaceLabel}</span>
          </Link>
          ) : (
            <div className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-desktop-text-secondary">
              <svg className="w-3 h-3 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <span className="max-w-[120px] truncate">{workspaceLabel}</span>
            </div>
          )
        )}
      </div>

      <div className="flex-1 app-drag-region h-full" />

      {titleBarRight && (
        <div className="flex items-center gap-1 px-2">
          {titleBarRight}
        </div>
      )}
    </header>
  );
}
