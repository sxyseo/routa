import type { Dispatch, SetStateAction, RefObject } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel } from "@/client/components/chat-panel";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import { KanbanCard } from "./kanban-card";
import { KanbanCardActivityBar, KanbanCardDetail } from "./kanban-card-detail";
import type { KanbanTaskAgentCopy } from "./i18n/kanban-task-agent";
import { KanbanCreateModal, type DraftIssue } from "../kanban-create-modal";
import { KanbanEmptySessionPane } from "./kanban-card-activity";
import { KanbanRepoSyncStatus, type RepoSyncState } from "./kanban-repo-sync-status";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";
import { formatLaneAutomationSummary } from "./kanban-tab-helpers";
import type { ColumnAutomationConfig } from "./kanban-settings-modal";
import type { KanbanBoardInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

export function KanbanBoardSurface({
  moveError,
  onDismissMoveError,
  codebases,
  workspaceId,
  defaultCodebase,
  repoSync,
  setSelectedCodebase,
  fetchCodebaseWorktrees,
  onRefresh,
  onAgentPrompt,
  availableProviders,
  acp,
  kanbanTaskAgentCopy,
  agentInput,
  setAgentInput,
  agentLoading,
  handleAgentSubmit,
  setShowCreateModal,
  agentSessionId,
  openAgentPanel,
  agentPanelOpen,
  board,
  visibleColumns,
  boardTasks,
  columnAutomation,
  providers,
  specialists,
  specialistLanguage,
  sessionMap,
  liveSessionTails,
  allCodebaseIds,
  worktreeCache,
  queuedPositions,
  dragTaskId,
  setDragTaskId,
  moveTask,
  confirmDeleteTask,
  patchTask,
  retryTaskTrigger,
  openTaskDetail,
  agentSession,
  onCloseAgentPanel,
  ensureKanbanAgentSession,
  kanbanRepoSelection,
}: {
  moveError: string | null;
  onDismissMoveError: () => void;
  codebases: CodebaseData[];
  workspaceId: string;
  defaultCodebase: CodebaseData | null;
  repoSync?: RepoSyncState;
  setSelectedCodebase: Dispatch<SetStateAction<CodebaseData | null>>;
  fetchCodebaseWorktrees: (codebase: CodebaseData) => Promise<void>;
  onRefresh: () => void;
  onAgentPrompt?: unknown;
  availableProviders: AcpProviderInfo[];
  acp?: UseAcpState & UseAcpActions;
  kanbanTaskAgentCopy: KanbanTaskAgentCopy;
  agentInput: string;
  setAgentInput: Dispatch<SetStateAction<string>>;
  agentLoading: boolean;
  handleAgentSubmit: () => Promise<void>;
  setShowCreateModal: Dispatch<SetStateAction<boolean>>;
  agentSessionId: string | null;
  openAgentPanel: (sessionId: string) => void;
  agentPanelOpen: boolean;
  board: KanbanBoardInfo;
  visibleColumns: string[];
  boardTasks: TaskInfo[];
  columnAutomation: Record<string, ColumnAutomationConfig>;
  providers: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  sessionMap: Map<string, SessionInfo>;
  liveSessionTails: Record<string, string>;
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  queuedPositions: Record<string, number | undefined>;
  dragTaskId: string | null;
  setDragTaskId: Dispatch<SetStateAction<string | null>>;
  moveTask: (taskId: string, targetColumnId: string) => Promise<void>;
  confirmDeleteTask: (task: TaskInfo) => void;
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  retryTaskTrigger: (taskId: string) => Promise<void>;
  openTaskDetail: (task: TaskInfo) => Promise<void>;
  agentSession?: SessionInfo;
  onCloseAgentPanel: () => void;
  ensureKanbanAgentSession: (
    cwd?: string,
    provider?: string,
    modeId?: string,
    model?: string,
  ) => Promise<string | null>;
  kanbanRepoSelection: RepoSelection | null;
}) {
  return (
    <>
      {moveError && (
        <div className="shrink-0 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
          <div className="flex items-start justify-between gap-3">
            <div className="leading-6">{moveError}</div>
            <button
              type="button"
              onClick={onDismissMoveError}
              className="shrink-0 rounded-lg border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-900/20"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="shrink-0 rounded-2xl border border-gray-200/70 bg-white px-4 py-2 dark:border-[#1c1f2e] dark:bg-[#12141c]">
        <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 xl:max-w-[56rem]">
              <span className="inline-flex h-8 items-center text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Repos</span>
              {codebases.length === 0 ? (
                <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-[#0d1018]">
                  <span className="text-sm text-gray-400 dark:text-gray-500">No repositories linked.</span>
                  <div className="flex items-center gap-2">
                    <RepoPicker
                      value={null}
                      onChange={async (selection) => {
                        if (!selection) return;
                        try {
                          const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/codebases`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              repoPath: selection.path,
                              branch: selection.branch,
                              label: selection.name,
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error ?? "Failed to add repository");
                          onRefresh?.();
                        } catch (err) {
                          console.error("Failed to add repository:", err);
                          alert(err instanceof Error ? err.message : "Failed to add repository");
                        }
                      }}
                      additionalRepos={[]}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  {defaultCodebase && (
                    <button
                      onClick={() => {
                        setSelectedCodebase(defaultCodebase);
                        void fetchCodebaseWorktrees(defaultCodebase);
                      }}
                      className="inline-flex h-8 max-w-[200px] items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[11px] text-gray-700 transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-amber-900/10"
                      data-testid="codebase-badge"
                      title={`${defaultCodebase.label ?? defaultCodebase.repoPath} - ${defaultCodebase.branch ? `@${defaultCodebase.branch}` : ""}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${defaultCodebase.sourceType === "github" ? "bg-blue-500" : "bg-emerald-500"}`} />
                      <span className="truncate font-medium">{defaultCodebase.label ?? defaultCodebase.repoPath.split("/").pop() ?? defaultCodebase.repoPath}</span>
                      {defaultCodebase.branch && <span className="shrink-0 text-gray-400 dark:text-gray-500">@{defaultCodebase.branch}</span>}
                    </button>
                  )}
                  {codebases.length > 1 && (
                    <button
                      onClick={() => {
                        const otherRepo = codebases.find((codebase) => codebase.id !== defaultCodebase?.id);
                        if (otherRepo) {
                          setSelectedCodebase(otherRepo);
                          void fetchCodebaseWorktrees(otherRepo);
                        }
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 text-[11px] text-gray-600 transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400 dark:hover:bg-amber-900/10"
                      title={`+${codebases.length - 1} more ${codebases.length - 1 === 1 ? "repository" : "repositories"} - click to view all`}
                    >
                      <span className="font-medium">+{codebases.length - 1}</span>
                    </button>
                  )}
                </div>
              )}
              <KanbanRepoSyncStatus repoSync={repoSync} />
            </div>
          </div>

          {onAgentPrompt ? (
            <div className="flex min-w-0 flex-1 items-center justify-center">
              <div className="group relative flex w-full max-w-3xl items-center rounded-2xl border border-gray-200 bg-white shadow-sm transition-colors focus-within:border-amber-400/80 focus-within:ring-2 focus-within:ring-amber-400/15 dark:border-gray-700 dark:bg-[#12141c]">
                <div className="shrink-0 border-r border-gray-200 dark:border-gray-700">
                  <AcpProviderDropdown
                    providers={availableProviders}
                    selectedProvider={acp?.selectedProvider ?? ""}
                    onProviderChange={(providerId) => acp?.setProvider(providerId)}
                    disabled={!acp?.connected || availableProviders.length === 0}
                    ariaLabel={kanbanTaskAgentCopy.providerAriaLabel}
                    dataTestId="kanban-agent-provider"
                    buttonClassName="flex h-8 items-center gap-1.5 rounded-l-2xl rounded-r-none bg-transparent px-2.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800/40"
                    labelClassName="max-w-[120px] truncate"
                  />
                </div>
                <input
                  type="text"
                  value={agentInput}
                  onChange={(event) => setAgentInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleAgentSubmit();
                    }
                  }}
                  placeholder={acp?.connected ? kanbanTaskAgentCopy.placeholder : kanbanTaskAgentCopy.connectingPlaceholder}
                  disabled={agentLoading || !acp?.connected}
                  className="h-8 w-full bg-transparent px-3 pr-2 text-sm text-gray-800 placeholder-gray-400 outline-none disabled:opacity-50 dark:text-gray-200 dark:placeholder-gray-500"
                />
                <button
                  onClick={() => void handleAgentSubmit()}
                  disabled={!agentInput.trim() || agentLoading || !acp?.connected}
                  className="mr-1.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-gray-900 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:bg-amber-500 dark:hover:bg-amber-400 dark:disabled:bg-[#1a1d29] dark:disabled:text-gray-500"
                >
                  {agentLoading ? "..." : (
                    <>
                      <span>{kanbanTaskAgentCopy.send}</span>
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
                      </svg>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex h-8 shrink-0 items-center rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-0 text-[12px] font-semibold text-white shadow-sm transition-all hover:from-amber-600 hover:to-orange-500"
                >
                  {kanbanTaskAgentCopy.manual}
                </button>
              </div>
              {agentSessionId && (
                <button
                  onClick={() => openAgentPanel(agentSessionId)}
                  className="shrink-0 text-xs text-amber-600 hover:underline dark:text-amber-400"
                  title={kanbanTaskAgentCopy.openPanelTitle}
                >
                  {kanbanTaskAgentCopy.view}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex h-8 items-center rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 text-[12px] font-medium text-white shadow-sm transition-all hover:from-amber-600 hover:to-orange-500"
            >
              {kanbanTaskAgentCopy.manual}
            </button>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-4">
        <div className={`${agentPanelOpen && agentSessionId ? "min-w-0 flex-1" : "w-full"} flex min-h-0 flex-col`}>
          <div className="flex-1 min-h-0 overflow-auto pb-2" data-testid="kanban-board-content">
            <div className="flex min-h-full min-w-max items-start gap-3 pr-4">
              {board.columns
                .slice()
                .sort((left, right) => left.position - right.position)
                .filter((column) => visibleColumns.includes(column.id))
                .map((column) => {
                  const columnTasks = boardTasks.filter((task) => (task.columnId ?? "backlog") === column.id);
                  const laneAutomation = columnAutomation[column.id] ?? column.automation;
                  const widthClass = column.width === "compact" ? "w-[14rem]" : column.width === "wide" ? "w-[24rem]" : "w-[18rem]";

                  return (
                    <div
                      key={column.id}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={async () => {
                        if (!dragTaskId) return;
                        await moveTask(dragTaskId, column.id);
                        setDragTaskId(null);
                      }}
                      className={`flex h-full min-h-26.25 shrink-0 flex-col rounded-2xl border border-gray-200/70 bg-white p-3 dark:border-[#1c1f2e] dark:bg-[#12141c] ${widthClass}`}
                      data-testid="kanban-column"
                    >
                      <div className="mb-3 space-y-2">
                        <div>
                          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{column.name}</div>
                          <div className="text-[11px] text-gray-400 dark:text-gray-500">{columnTasks.length} cards</div>
                        </div>
                        <div
                          className="truncate text-[10px] leading-4 text-gray-500 dark:text-gray-400"
                          data-testid={`kanban-column-automation-${column.id}`}
                          title={laneAutomation?.enabled ? formatLaneAutomationSummary(laneAutomation, providers, specialists) : column.stage === "blocked" ? "Manual lane only" : "Manual lane"}
                        >
                          {laneAutomation?.enabled
                            ? formatLaneAutomationSummary(laneAutomation, providers, specialists)
                            : column.stage === "blocked"
                              ? "Manual lane only"
                              : "Manual lane"}
                        </div>
                      </div>

                      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                        {columnTasks.map((task) => (
                          <KanbanCard
                            key={task.id}
                            task={task}
                            boardColumns={board.columns}
                            linkedSession={task.triggerSessionId ? sessionMap.get(task.triggerSessionId) : undefined}
                            liveMessageTail={task.triggerSessionId ? liveSessionTails[task.triggerSessionId] : undefined}
                            availableProviders={availableProviders}
                            specialists={specialists}
                            specialistLanguage={specialistLanguage}
                            codebases={codebases}
                            allCodebaseIds={allCodebaseIds}
                            worktreeCache={worktreeCache}
                            queuePosition={queuedPositions[task.id]}
                            onDragStart={() => setDragTaskId(task.id)}
                            onOpenDetail={() => openTaskDetail(task)}
                            onDelete={() => confirmDeleteTask(task)}
                            onPatchTask={patchTask}
                            onRetryTrigger={retryTaskTrigger}
                            onRefresh={onRefresh}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {agentPanelOpen && agentSessionId && acp && (
          <aside
            className="flex h-full w-lg min-w-md flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white dark:border-[#1c1f2e] dark:bg-[#12141c]"
            data-testid="kanban-agent-panel"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-[#191c28]">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{kanbanTaskAgentCopy.panelTitle}</div>
                <div className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                  {agentSession?.provider ?? acp.selectedProvider} · {agentSessionId.slice(0, 12)}...
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/workspace/${workspaceId}/sessions/${agentSessionId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  {kanbanTaskAgentCopy.open}
                </a>
                <button
                  onClick={onCloseAgentPanel}
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
                >
                  {kanbanTaskAgentCopy.close}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel
                acp={acp}
                activeSessionId={agentSessionId}
                onEnsureSession={ensureKanbanAgentSession}
                onSelectSession={async (sessionId) => {
                  openAgentPanel(sessionId);
                }}
                repoSelection={kanbanRepoSelection}
                onRepoChange={() => {}}
                codebases={codebases}
                activeWorkspaceId={workspaceId}
                agentRole="DEVELOPER"
              />
            </div>
          </aside>
        )}
      </div>
    </>
  );
}

export function KanbanCreateTaskModal({
  showCreateModal,
  draft,
  setDraft,
  onClose,
  onCreate,
  githubAvailable,
  codebases,
  allCodebaseIds,
}: {
  showCreateModal: boolean;
  draft: DraftIssue;
  setDraft: Dispatch<SetStateAction<DraftIssue>>;
  onClose: () => void;
  onCreate: () => void;
  githubAvailable: boolean;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
}) {
  if (!showCreateModal) return null;

  return (
    <KanbanCreateModal
      draft={draft}
      setDraft={setDraft}
      onClose={onClose}
      onCreate={onCreate}
      githubAvailable={githubAvailable}
      codebases={codebases}
      allCodebaseIds={allCodebaseIds}
    />
  );
}

export function KanbanTaskDetailOverlay({
  activeSessionId,
  activeTaskId,
  activeTask,
  board,
  resolveSpecialist,
  acp,
  detailSplitContainerRef,
  detailSplitRatio,
  setIsDraggingDetailSplit,
  refreshSignal,
  availableProviders,
  specialists,
  specialistLanguage,
  codebases,
  allCodebaseIds,
  worktreeCache,
  combinedSessions,
  patchTask,
  retryTaskTrigger,
  confirmDeleteTask,
  onRefresh,
  setActiveSessionId,
  closeTaskDetail,
  sessionMap,
  workspaceId,
}: {
  activeSessionId: string | null;
  activeTaskId: string | null;
  activeTask: TaskInfo | null;
  board: KanbanBoardInfo | null;
  resolveSpecialist: ReturnType<typeof import("./kanban-card-session-utils").createKanbanSpecialistResolver>;
  acp?: UseAcpState & UseAcpActions;
  detailSplitContainerRef: RefObject<HTMLDivElement | null>;
  detailSplitRatio: number;
  setIsDraggingDetailSplit: Dispatch<SetStateAction<boolean>>;
  refreshSignal?: number;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  combinedSessions: SessionInfo[];
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  retryTaskTrigger: (taskId: string) => Promise<void>;
  confirmDeleteTask: (task: TaskInfo) => void;
  onRefresh: () => void;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  closeTaskDetail: () => void;
  sessionMap: Map<string, SessionInfo>;
  workspaceId: string;
}) {
  if (!activeSessionId && !activeTaskId) return null;

  const showEmptySessionPane = Boolean(
    activeTask &&
    !activeSessionId &&
    resolveEffectiveTaskAutomation(activeTask, board?.columns ?? [], resolveSpecialist).canRun &&
    activeTask.columnId !== "done",
  );
  const hasSessionPane = Boolean((activeSessionId && acp) || showEmptySessionPane);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 animate-in fade-in duration-150">
      <div className="relative h-[88vh] w-full max-w-7xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
        <div ref={detailSplitContainerRef} className="flex h-full">
          {activeTaskId && (() => {
            const task = activeTask;
            if (!task) return null;
            const sessionInfo = task.triggerSessionId ? sessionMap.get(task.triggerSessionId) ?? null : null;
            return (
              <div
                className={`${hasSessionPane ? "shrink-0" : "flex-1"} h-full min-w-0 border-r border-gray-200/80 dark:border-[#202433]`}
                style={hasSessionPane ? { width: `${detailSplitRatio * 100}%` } : undefined}
              >
                <KanbanCardDetail
                  key={task.id}
                  task={task}
                  refreshSignal={refreshSignal}
                  boardColumns={board?.columns ?? []}
                  availableProviders={availableProviders}
                  specialists={specialists}
                  specialistLanguage={specialistLanguage}
                  codebases={codebases}
                  allCodebaseIds={allCodebaseIds}
                  worktreeCache={worktreeCache}
                  sessionInfo={sessionInfo}
                  sessions={combinedSessions}
                  fullWidth={!hasSessionPane}
                  onPatchTask={patchTask}
                  onRetryTrigger={retryTaskTrigger}
                  onDelete={() => confirmDeleteTask(task)}
                  onRefresh={onRefresh}
                  onProviderChange={(providerId) => {
                    if (acp && providerId) {
                      acp.setProvider(providerId);
                    }
                  }}
                  onRepositoryChange={(codebaseIds) => {
                    void codebaseIds;
                  }}
                  onSelectSession={(sessionId) => {
                    setActiveSessionId(sessionId);
                    acp?.selectSession(sessionId);
                  }}
                />
              </div>
            );
          })()}
          {activeTaskId && hasSessionPane && (
            <div
              className="hidden h-full w-3 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-amber-50/80 dark:hover:bg-amber-900/10 md:flex"
              onMouseDown={() => setIsDraggingDetailSplit(true)}
              data-testid="kanban-detail-split-handle"
            >
              <div className="h-12 w-1 rounded-full bg-gray-300 transition-colors hover:bg-amber-400 dark:bg-gray-700 dark:hover:bg-amber-500" />
            </div>
          )}
          {hasSessionPane ? (() => {
            const taskCodebaseIds = activeTask?.codebaseIds && activeTask.codebaseIds.length > 0
              ? activeTask.codebaseIds
              : allCodebaseIds;
            const primaryCodebase = taskCodebaseIds.length > 0
              ? codebases.find((codebase) => codebase.id === taskCodebaseIds[0])
              : null;
            const activeSessionInfo = activeSessionId
              ? sessionMap.get(activeSessionId) ?? null
              : null;
            const activeWorktree = activeTask?.worktreeId
              ? worktreeCache[activeTask.worktreeId] ?? null
              : null;
            const repoSelection = primaryCodebase
              ? {
                  path: activeSessionInfo?.cwd ?? activeWorktree?.worktreePath ?? primaryCodebase.repoPath,
                  branch: activeSessionInfo?.branch ?? activeWorktree?.branch ?? primaryCodebase.branch ?? "",
                  name: primaryCodebase.label ?? primaryCodebase.repoPath.split("/").pop() ?? "",
                }
              : null;
            const taskAgentRole = activeTask?.assignedRole ?? undefined;

            if (showEmptySessionPane && activeTask) {
              return (
                <div
                  className="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
                  style={activeTaskId ? { width: `${(1 - detailSplitRatio) * 100}%` } : undefined}
                >
                  <KanbanEmptySessionPane
                    task={activeTask}
                    boardColumns={board?.columns ?? []}
                    availableProviders={availableProviders}
                    specialists={specialists}
                    specialistLanguage={specialistLanguage}
                    onCloseSession={closeTaskDetail}
                  />
                </div>
              );
            }

            return (
              <div
                className="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
                style={activeTaskId ? { width: `${(1 - detailSplitRatio) * 100}%` } : undefined}
              >
                {activeTask && (
                  <div className="shrink-0 border-b border-gray-200/80 bg-gray-50/80 p-2 dark:border-[#202433] dark:bg-[#10131a]">
                    <KanbanCardActivityBar
                      task={activeTask}
                      sessions={combinedSessions}
                      specialistLanguage={specialistLanguage}
                      currentSessionId={activeSessionId ?? undefined}
                      onSelectSession={(sessionId) => {
                        setActiveSessionId(sessionId);
                        acp?.selectSession(sessionId);
                      }}
                      onCloseSession={closeTaskDetail}
                    />
                  </div>
                )}
                {acp && (
                  <div className="min-h-0 flex-1">
                    <ChatPanel
                      acp={acp}
                      activeSessionId={activeSessionId}
                      onEnsureSession={async () => activeSessionId}
                      onSelectSession={async (sessionId) => {
                        setActiveSessionId(sessionId);
                        acp.selectSession(sessionId);
                      }}
                      repoSelection={repoSelection}
                      onRepoChange={() => {}}
                      codebases={codebases}
                      activeWorkspaceId={workspaceId}
                      agentRole={taskAgentRole}
                    />
                  </div>
                )}
              </div>
            );
          })() : null}
        </div>
      </div>
    </div>
  );
}
