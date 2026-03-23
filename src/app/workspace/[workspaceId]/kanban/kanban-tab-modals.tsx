import type { Dispatch, SetStateAction } from "react";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import type { TaskInfo, WorktreeInfo } from "../types";

export interface KanbanCodebaseModalProps {
  selectedCodebase: CodebaseData | null;
  editingCodebase: boolean;
  codebases: CodebaseData[];
  editRepoSelection: RepoSelection | null;
  onRepoSelectionChange: (selection: RepoSelection | null) => void | Promise<void>;
  editError: string | null;
  recloneError: string | null;
  editSaving: boolean;
  replacingAll: boolean;
  setShowReplaceAllConfirm: Dispatch<SetStateAction<boolean>>;
  handleCancelEditCodebase: () => void;
  codebaseWorktrees: WorktreeInfo[];
  worktreeActionError: string | null;
  localTasks: TaskInfo[];
  handleDeleteCodebaseWorktree: (worktree: WorktreeInfo) => void | Promise<void>;
  deletingWorktreeId: string | null;
  liveBranchInfo: { current: string; branches: string[] } | null;
  handleReclone: () => void | Promise<void>;
  recloning: boolean;
  recloneSuccess: string | null;
  onStartEditCodebase: () => void;
  onRequestRemoveCodebase: () => void;
  onClose: () => void;
}

export function KanbanCodebaseModal({
  selectedCodebase,
  editingCodebase,
  codebases,
  editRepoSelection,
  onRepoSelectionChange,
  editError,
  recloneError,
  editSaving,
  replacingAll,
  setShowReplaceAllConfirm,
  handleCancelEditCodebase,
  codebaseWorktrees,
  worktreeActionError,
  localTasks,
  handleDeleteCodebaseWorktree,
  deletingWorktreeId,
  liveBranchInfo,
  handleReclone,
  recloning,
  recloneSuccess,
  onStartEditCodebase,
  onRequestRemoveCodebase,
  onClose,
}: KanbanCodebaseModalProps) {
  if (!selectedCodebase) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]" data-testid="codebase-detail-modal">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {selectedCodebase.label ?? selectedCodebase.repoPath.split("/").pop()}
          </h3>
          <div className="flex items-center gap-2">
            {!editingCodebase && (
              <>
                <button
                  onClick={onRequestRemoveCodebase}
                  className="text-sm text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300"
                >
                  Remove
                </button>
                <button
                  onClick={onStartEditCodebase}
                  className="text-sm text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
                >
                  Edit
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              Close
            </button>
          </div>
        </div>

        {editingCodebase ? (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-medium text-gray-500 dark:text-gray-400">
                Select or clone a repository
              </label>
              <RepoPicker
                value={editRepoSelection}
                onChange={onRepoSelectionChange}
                additionalRepos={codebases.map((codebase) => ({
                  name: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
                  path: codebase.repoPath,
                  branch: codebase.branch,
                }))}
              />
            </div>
            {editError && (
              <div className="text-xs text-rose-600 dark:text-rose-400">{editError}</div>
            )}
            {recloneError && (
              <div className="text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
            )}
            {editSaving && (
              <div className="text-xs text-amber-600 dark:text-amber-400">Updating repository...</div>
            )}

            {codebases.length > 1 && editRepoSelection && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
                <div className="flex items-start gap-2">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      You have {codebases.length} repositories in this workspace. Would you like to replace all of them with this repository?
                    </p>
                    <button
                      onClick={() => setShowReplaceAllConfirm(true)}
                      disabled={editSaving || replacingAll}
                      className="mt-2 text-xs font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                    >
                      Replace All Repositories →
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelEditCodebase}
                disabled={editSaving || replacingAll}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="min-h-0 space-y-4 overflow-y-auto pr-1 text-sm">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Path</div>
                <div className="truncate font-mono text-xs text-gray-700 dark:text-gray-300">{selectedCodebase.repoPath}</div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Branch</div>
                <div className="text-gray-700 dark:text-gray-300">
                  {liveBranchInfo?.current ?? selectedCodebase.branch ?? "—"}
                  {liveBranchInfo && liveBranchInfo.current !== selectedCodebase.branch && selectedCodebase.branch && (
                    <span className="ml-1 text-[10px] text-amber-500">(stored: {selectedCodebase.branch})</span>
                  )}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Source Type</div>
                <div className="text-gray-700 dark:text-gray-300">{selectedCodebase.sourceType ?? "local"}</div>
              </div>
              {selectedCodebase.sourceUrl && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Source URL</div>
                  <a href={selectedCodebase.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-amber-600 hover:underline dark:text-amber-400">
                    {selectedCodebase.sourceUrl}
                  </a>
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Worktrees ({codebaseWorktrees.length})
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">Manage branches and clean stale worktrees here.</div>
              </div>
              {worktreeActionError && (
                <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
                  {worktreeActionError}
                </div>
              )}
              {codebaseWorktrees.length === 0 ? (
                <div className="text-xs text-gray-400 dark:text-gray-500">No worktrees created yet</div>
              ) : (
                <div className="space-y-2">
                  {codebaseWorktrees.map((worktree) => {
                    const linkedTasks = localTasks.filter((task) => task.worktreeId === worktree.id);
                    return (
                      <div key={worktree.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                worktree.status === "active"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                                  : worktree.status === "creating"
                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                                    : "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
                              }`}>{worktree.status}</span>
                              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{worktree.branch}</span>
                              <span className="text-[11px] text-gray-400 dark:text-gray-500">base {worktree.baseBranch}</span>
                              {linkedTasks.length > 0 && (
                                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">
                                  {linkedTasks.length} linked task{linkedTasks.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <div className="break-all font-mono text-xs text-gray-400 dark:text-gray-500">{worktree.worktreePath}</div>
                            {linkedTasks.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {linkedTasks.slice(0, 4).map((task) => (
                                  <span key={task.id} className="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                    {task.title}
                                  </span>
                                ))}
                                {linkedTasks.length > 4 && (
                                  <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                    +{linkedTasks.length - 4} more
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2 self-end lg:self-start">
                            <button
                              type="button"
                              onClick={() => void handleDeleteCodebaseWorktree(worktree)}
                              disabled={deletingWorktreeId === worktree.id}
                              className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/10"
                            >
                              {deletingWorktreeId === worktree.id ? "Removing..." : "Remove"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedCodebase.sourceType === "github" && selectedCodebase.sourceUrl && (
              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Re-clone Repository</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">Pull latest or re-clone if the local copy is corrupted</div>
                  </div>
                  <button
                    onClick={() => void handleReclone()}
                    disabled={recloning}
                    className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    {recloning ? "Cloning..." : "Re-clone"}
                  </button>
                </div>
                {recloneError && (
                  <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
                )}
                {recloneSuccess && (
                  <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{recloneSuccess}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanDeleteCodebaseModal({
  selectedCodebase,
  editError,
  deletingCodebase,
  onCancel,
  onConfirm,
}: {
  selectedCodebase: CodebaseData | null;
  editError: string | null;
  deletingCodebase: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!selectedCodebase) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Remove Repository</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Are you sure you want to remove <span className="font-medium text-gray-900 dark:text-gray-100">&quot;{selectedCodebase.label ?? selectedCodebase.repoPath.split("/").pop()}&quot;</span> from this workspace?
              </p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                This will only unlink the repository from this workspace. The repository files will not be deleted from your computer.
              </p>
            </div>
          </div>
          {editError && (
            <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{editError}</div>
          )}
          <div className="mt-6 flex gap-3">
            <button
              onClick={onCancel}
              disabled={deletingCodebase}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-[#191c28]"
            >
              Cancel
            </button>
            <button
              onClick={() => void onConfirm()}
              disabled={deletingCodebase}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
            >
              {deletingCodebase ? "Removing..." : "Remove"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function KanbanReplaceAllReposModal({
  editRepoSelection,
  codebasesCount,
  recloneError,
  replacingAll,
  onCancel,
  onConfirm,
}: {
  editRepoSelection: RepoSelection | null;
  codebasesCount: number;
  recloneError: string | null;
  replacingAll: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!editRepoSelection) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20">
              <svg className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Replace All Repositories</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                This will update all <span className="font-medium text-gray-900 dark:text-gray-100">{codebasesCount} repositories</span> in this workspace to use:
              </p>
              <div className="mt-2 rounded-lg bg-gray-50 p-2 dark:bg-[#0d1018]">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{editRepoSelection.name}</div>
                <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">{editRepoSelection.path}</div>
              </div>
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                This is useful when the codebase path has changed or you need to fix repository references.
              </p>
            </div>
          </div>
          {recloneError && (
            <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
          )}
          <div className="mt-6 flex gap-3">
            <button
              onClick={onCancel}
              disabled={replacingAll}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-[#191c28]"
            >
              Cancel
            </button>
            <button
              onClick={() => void onConfirm()}
              disabled={replacingAll}
              className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {replacingAll ? "Replacing..." : "Replace All"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function KanbanDeleteTaskModal({
  deleteConfirmTask,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  deleteConfirmTask: TaskInfo | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!deleteConfirmTask) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delete Task</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Are you sure you want to delete <span className="font-medium text-gray-900 dark:text-gray-100">&quot;{deleteConfirmTask.title}&quot;</span>? This action cannot be undone.
              </p>
              {deleteConfirmTask.githubNumber && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Note: This will only delete the local task. The GitHub issue #{deleteConfirmTask.githubNumber} will remain unchanged.
                </p>
              )}
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              onClick={onCancel}
              disabled={isDeleting}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-[#191c28]"
            >
              Cancel
            </button>
            <button
              onClick={() => void onConfirm()}
              disabled={isDeleting}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
