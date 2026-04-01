"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "./button";
import type { WorkspaceData } from "../hooks/use-workspaces";
import { useTranslation } from "@/i18n";
import { ChevronDown, Folder, Plus, Check } from "lucide-react";


interface WorkspaceSwitcherProps {
  workspaces: WorkspaceData[];
  activeWorkspaceId: string | null;
  activeWorkspaceTitle?: string;
  onSelect: (workspaceId: string) => void;
  onCreate: (title: string) => Promise<void>;
  loading?: boolean;
  compact?: boolean;
  /** Use desktop/VS Code style theme */
  desktop?: boolean;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  activeWorkspaceTitle,
  onSelect,
  onCreate,
  loading,
  compact,
  desktop,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const visibleTitle = active?.title ?? activeWorkspaceTitle;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await onCreate(title);
    setNewTitle("");
    setCreating(false);
    setOpen(false);
  };

  // Desktop theme styles
  if (desktop || compact) {
    return (
      <div className="relative" ref={dropdownRef} data-testid="desktop-workspace-switcher">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-desktop-text-primary transition-colors hover:bg-desktop-bg-active/70"
          title={visibleTitle ?? t.workspace.selectWorkspace}
        >
          <Folder className="w-3 h-3 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          <span className="max-w-[120px] truncate">
            {loading ? "..." : (visibleTitle ?? t.workspace.select)}
          </span>
          <ChevronDown className={`w-2.5 h-2.5 text-desktop-text-secondary transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        </Button>

        {open && (
          <div className="absolute top-full left-0 z-50 mt-1 w-52 border border-desktop-border bg-desktop-bg-secondary shadow-xl">
            <div className="py-1 max-h-52 overflow-y-auto">
              {workspaces.length === 0 && (
                <div className="px-3 py-2 text-center text-[11px] text-desktop-text-secondary">{t.workspace.noWorkspacesYet}</div>
              )}
              {workspaces.map((ws) => (
                <Button
                  key={ws.id}
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => { onSelect(ws.id); setOpen(false); }}
                  className={`w-full justify-start rounded-none px-3 py-1.5 text-left flex items-center gap-2 text-[11px] transition-colors ${
                    ws.id === activeWorkspaceId
                      ? "bg-desktop-bg-active text-desktop-accent"
                      : "text-desktop-text-primary hover:bg-desktop-bg-active/60"
                  }`}
                >
                  <Folder className="w-3 h-3 shrink-0 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                  <span className="truncate flex-1">{ws.title}</span>
                  {ws.id === activeWorkspaceId && (
                    <Check className="w-3 h-3 shrink-0 text-desktop-accent" fill="currentColor" viewBox="0 0 20 20"/>
                  )}
                </Button>
              ))}
            </div>

            <div className="border-t border-desktop-border p-1.5">
              {creating ? (
                <div className="flex gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                    placeholder={t.workspace.workspaceName}
                    className="flex-1 border border-desktop-border bg-desktop-bg-primary px-2 py-1 text-[11px] text-desktop-text-primary outline-none placeholder:text-desktop-text-secondary focus:border-desktop-accent"
                  />
                <Button
                  type="button"
                  variant="desktop-accent"
                  size="xs"
                  onClick={handleCreate}
                  className="bg-desktop-accent px-2 py-1 text-[11px] font-medium text-desktop-accent-text transition-colors hover:bg-desktop-accent-strong"
                >
                  {t.common.create}
                </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="desktop-secondary"
                  size="xs"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] text-desktop-accent transition-colors hover:bg-desktop-bg-active/70"
                >
                  <Plus className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                  {t.workspace.newWorkspace}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Original light/dark theme styles
  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130] hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors max-w-[180px]"
        title={visibleTitle ?? t.workspace.selectWorkspace}
      >
        <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate flex-1 text-left">
          {loading ? "..." : (visibleTitle ?? t.workspace.selectWorkspace)}
        </span>
        <ChevronDown className={`w-3 h-3 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </Button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130] shadow-xl z-50">
          <div className="py-1 max-h-52 overflow-y-auto">
            {workspaces.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-400 text-center">{t.workspace.noWorkspacesYet}</div>
            )}
            {workspaces.map((ws) => (
              <Button
                key={ws.id}
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => { onSelect(ws.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors ${
                  ws.id === activeWorkspaceId
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                }`}
              >
                <Folder className="w-3.5 h-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                <span className="truncate flex-1">{ws.title}</span>
                {ws.id === activeWorkspaceId && (
                  <Check className="w-3 h-3 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"/>
                )}
              </Button>
            ))}
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 p-2">
            {creating ? (
              <div className="flex gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                  placeholder={t.workspace.workspaceName}
                  className="flex-1 px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="xs"
                  onClick={handleCreate}
                  className="px-2 py-1 text-xs font-medium"
                >
                  {t.common.create}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              >
                <Plus className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                {t.workspace.newWorkspace}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
