"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useTranslation } from "@/i18n";
import type { KanbanRepoChanges, KanbanFileChangeItem, KanbanTaskChanges } from "../kanban-file-changes-types";
import { KanbanUnstagedSection } from "./kanban-unstaged-section";
import { KanbanStagedSection } from "./kanban-staged-section";
import { KanbanCommitModal } from "./kanban-commit-modal";
import { KanbanInlineDiffViewer } from "./kanban-inline-diff-viewer";
import { loadKanbanFileDiff } from "./kanban-file-diff-loader";
import { useGitOperations } from "../hooks/use-git-operations";
import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";

interface KanbanEnhancedFileChangesPanelProps {
  taskId?: string;
  workspaceId: string;
  repos?: KanbanRepoChanges[];
  changes?: KanbanTaskChanges | null;
  loading?: boolean;
  open?: boolean;
  onClose?: () => void;
  onRefresh?: () => void;
  embedded?: boolean; // true when used in card detail, false when used as sidebar
}

export function KanbanEnhancedFileChangesPanel({
  taskId,
  workspaceId,
  repos = [],
  changes,
  loading = false,
  open = true,
  onClose,
  onRefresh,
  embedded = false,
}: KanbanEnhancedFileChangesPanelProps) {
  const { t } = useTranslation();
  const [autoCommit, setAutoCommit] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [activeDiffFile, setActiveDiffFile] = useState<KanbanFileChangeItem | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Support both sidebar mode (repos) and embedded mode (changes)
  const activeRepo = repos && repos.length > 0 ? repos[0] : null;
  const codebaseId = changes?.codebaseId || activeRepo?.codebaseId || "";

  const { stageFiles, unstageFiles, createCommit, discardChanges, loading: gitLoading } = useGitOperations({
    workspaceId,
    codebaseId,
    onSuccess: () => {
      onRefresh?.();
    },
    onError: (error) => {
      console.error("Git operation failed:", error);
    },
  });

  // Separate files into unstaged and staged
  const { unstagedFiles, stagedFiles } = useMemo(() => {
    // Embedded mode (card detail): use changes
    if (embedded && changes) {
      return {
        unstagedFiles: changes.files || [],
        stagedFiles: [],
      };
    }

    // Sidebar mode: use repos
    if (!activeRepo) {
      return { unstagedFiles: [], stagedFiles: [] };
    }

    // If repo already has unstagedFiles/stagedFiles, use them
    if (activeRepo.unstagedFiles || activeRepo.stagedFiles) {
      return {
        unstagedFiles: activeRepo.unstagedFiles || [],
        stagedFiles: activeRepo.stagedFiles || [],
      };
    }

    // Otherwise, treat all files as unstaged (backward compatibility)
    return {
      unstagedFiles: activeRepo.files || [],
      stagedFiles: [],
    };
  }, [embedded, changes, activeRepo]);

  // State for file selection
  const [fileSelections, setFileSelections] = useState<Record<string, boolean>>({});

  const handleFileSelect = useCallback((file: KanbanFileChangeItem, selected: boolean) => {
    setFileSelections((prev) => ({
      ...prev,
      [file.path]: selected,
    }));
  }, []);

  const handleSelectAll = useCallback((files: KanbanFileChangeItem[], selected: boolean) => {
    setFileSelections((prev) => {
      const next = { ...prev };
      files.forEach((file) => {
        next[file.path] = selected;
      });
      return next;
    });
  }, []);

  // Add selection state to files
  const unstagedWithSelection = useMemo(
    () => unstagedFiles.map((f) => ({ ...f, selected: fileSelections[f.path] || false })),
    [unstagedFiles, fileSelections]
  );

  const stagedWithSelection = useMemo(
    () => stagedFiles.map((f) => ({ ...f, selected: fileSelections[f.path] || false })),
    [stagedFiles, fileSelections]
  );

  // Handlers
  const handleStageSelected = useCallback(async () => {
    const selectedFiles = unstagedWithSelection.filter((f) => f.selected).map((f) => f.path);
    if (selectedFiles.length === 0) return;

    await stageFiles(selectedFiles);
    setFileSelections({});
  }, [unstagedWithSelection, stageFiles]);

  const handleUnstageSelected = useCallback(async () => {
    const selectedFiles = stagedWithSelection.filter((f) => f.selected).map((f) => f.path);
    if (selectedFiles.length === 0) return;

    await unstageFiles(selectedFiles);
    setFileSelections({});
  }, [stagedWithSelection, unstageFiles]);

  const handleDiscardSelected = useCallback(async () => {
    const selectedFiles = unstagedWithSelection.filter((f) => f.selected).map((f) => f.path);
    if (selectedFiles.length === 0) return;

    // TODO: Add confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to discard changes to ${selectedFiles.length} file(s)? This cannot be undone.`
    );
    if (!confirmed) return;

    await discardChanges(selectedFiles);
    setFileSelections({});
  }, [unstagedWithSelection, discardChanges]);

  const handleCommit = useCallback(async (message: string) => {
    await createCommit(message);
    setCommitModalOpen(false);
  }, [createCommit]);

  const handleFileClick = useCallback(async (file: KanbanFileChangeItem, staged = false) => {
    setActiveDiffFile(file);
    setDiffError(null);

    setDiffLoading(true);

    try {
      const diff = await loadKanbanFileDiff({
        file,
        taskId: embedded ? taskId : undefined,
        workspaceId,
        codebaseId,
        staged,
      });
      setDiffContent(diff);
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : "Failed to load diff");
    } finally {
      setDiffLoading(false);
    }
  }, [embedded, taskId, workspaceId, codebaseId]);

  const handleCloseDiff = useCallback(() => {
    setActiveDiffFile(null);
    setDiffContent(null);
    setDiffError(null);
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    enabled: open,
    callbacks: {
      onTogglePanel: onClose,
      onEscape: activeDiffFile ? handleCloseDiff : onClose,
      onStageSelected: () => {
        const selected = unstagedWithSelection.filter((f) => f.selected);
        if (selected.length > 0) {
          handleStageSelected();
        }
      },
      onUnstageSelected: () => {
        const selected = stagedWithSelection.filter((f) => f.selected);
        if (selected.length > 0) {
          handleUnstageSelected();
        }
      },
      onOpenCommit: () => {
        if (stagedFiles.length > 0) {
          setCommitModalOpen(true);
        }
      },
      onSelectAll: () => {
        // Select all unstaged files (could be improved to be context-aware)
        handleSelectAll(unstagedWithSelection, true);
      },
      onShowDiff: () => {
        // Show diff for first selected file
        const selected = [...unstagedWithSelection, ...stagedWithSelection].find(
          (f) => f.selected
        );
        if (selected) {
          const isStaged = stagedWithSelection.includes(selected);
          handleFileClick(selected, isStaged);
        }
      },
    },
  });

  const summary = {
    changedRepos: repos ? repos.filter((r) => !r.error && !r.status.clean).length : 0,
    changedFiles: repos ? repos.reduce((count, repo) => count + (repo.files?.length || 0), 0) : (changes?.files?.length || 0),
  };

  // Embedded mode: always show
  if (!embedded && !open) return null;

  // Embedded mode (card detail): render without backdrop/panel wrapper
  if (embedded) {
    return (
      <>
        <div className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
          {loading ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.loadingChanges}
            </div>
          ) : !changes && !activeRepo ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.noRepoChanges}
            </div>
          ) : (
            <>
              {/* Unstaged Section */}
              <KanbanUnstagedSection
                files={unstagedWithSelection}
                autoCommit={autoCommit}
                onAutoCommitToggle={setAutoCommit}
                embedded={true}
                onFileClick={(file) => handleFileClick(file, false)}
                onFileSelect={handleFileSelect}
                onSelectAll={(selected) => handleSelectAll(unstagedWithSelection, selected)}
                onStageSelected={handleStageSelected}
                onDiscardSelected={handleDiscardSelected}
                loading={gitLoading}
              />

              {/* Inline Diff Viewer */}
              {activeDiffFile && (
                <KanbanInlineDiffViewer
                  file={activeDiffFile}
                  diff={diffContent || undefined}
                  loading={diffLoading}
                  error={diffError || undefined}
                  embedded={true}
                  onClose={handleCloseDiff}
                />
              )}

              {/* Staged Section */}
              <KanbanStagedSection
                files={stagedWithSelection}
                onFileClick={(file) => handleFileClick(file, true)}
                onFileSelect={handleFileSelect}
                onSelectAll={(selected) => handleSelectAll(stagedWithSelection, selected)}
                onUnstageSelected={handleUnstageSelected}
                onCommit={() => setCommitModalOpen(true)}
                onExport={() => {
                  console.log("Export changes");
                }}
                loading={gitLoading}
              />
            </>
          )}
        </div>

        {/* Commit Modal */}
        <KanbanCommitModal
          open={commitModalOpen}
          onClose={() => setCommitModalOpen(false)}
          onCommit={handleCommit}
          fileCount={stagedFiles.length}
        />
      </>
    );
  }

  // Sidebar mode: render with backdrop and panel wrapper
  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-20 bg-slate-900/10 backdrop-blur-[1px] dark:bg-black/20"
        onClick={onClose}
        data-testid="kanban-file-changes-backdrop"
      />

      {/* Panel */}
      <aside
        className="absolute inset-y-0 right-0 z-30 flex h-full w-[22rem] flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]"
        data-testid="kanban-file-changes-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-[#191c28]">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.kanban.fileChanges}
            </div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              {activeRepo?.label || "No repository"} @ {activeRepo?.branch || "—"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {summary.changedRepos > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {summary.changedRepos} dirty
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
            >
              {t.kanban.hide}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-slate-400 dark:text-slate-500">
              Loading repository changes...
            </div>
          ) : !activeRepo ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-500">
              No repositories linked to this workspace
            </div>
          ) : (
            <div className="space-y-3">
              {/* Unstaged Section */}
              <KanbanUnstagedSection
                files={unstagedWithSelection}
                autoCommit={autoCommit}
                onAutoCommitToggle={setAutoCommit}
                onFileClick={(file) => handleFileClick(file, false)}
                onFileSelect={handleFileSelect}
                onSelectAll={(selected) => handleSelectAll(unstagedWithSelection, selected)}
                onStageSelected={handleStageSelected}
                onDiscardSelected={handleDiscardSelected}
                loading={gitLoading}
              />

              {/* Inline Diff Viewer */}
              {activeDiffFile && (
                <KanbanInlineDiffViewer
                  file={activeDiffFile}
                  diff={diffContent || undefined}
                  loading={diffLoading}
                  error={diffError || undefined}
                  onClose={handleCloseDiff}
                />
              )}

              {/* Staged Section */}
              <KanbanStagedSection
                files={stagedWithSelection}
                onFileClick={(file) => handleFileClick(file, true)}
                onFileSelect={handleFileSelect}
                onSelectAll={(selected) => handleSelectAll(stagedWithSelection, selected)}
                onUnstageSelected={handleUnstageSelected}
                onCommit={() => setCommitModalOpen(true)}
                onExport={() => {
                  console.log("Export changes");
                }}
                loading={gitLoading}
              />
            </div>
          )}
        </div>
      </aside>

      {/* Commit Modal */}
      <KanbanCommitModal
        open={commitModalOpen}
        onClose={() => setCommitModalOpen(false)}
        onCommit={handleCommit}
        fileCount={stagedFiles.length}
      />
    </>
  );
}
