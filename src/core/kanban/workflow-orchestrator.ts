/**
 * KanbanWorkflowOrchestrator — Coordinates column automation and task progress.
 *
 * Listens for COLUMN_TRANSITION events and triggers the configured Column Agent
 * for the target column. Tracks active automations, supervises dev-lane ACP
 * sessions, and supports bounded recovery for watchdog/loop policies.
 */

import { getHttpSessionStore } from "../acp/http-session-store";
import { isExecutionLeaseActive } from "../acp/execution-backend";
import { EventBus, AgentEventType, AgentEvent } from "../events/event-bus";
import type {
  KanbanAutomationStep,
  KanbanColumnAutomation,
  KanbanColumnStage,
  KanbanDevSessionCompletionRequirement,
  KanbanDevSessionSupervision,
  KanbanDevSessionSupervisionMode,
} from "../models/kanban";
import { getKanbanAutomationSteps, resolveTaskStatusForBoardColumn, inferStageFromColumnId } from "../models/kanban";
import { type Task, type TaskLaneSession, type TaskLaneSessionRecoveryReason, type TaskStatus, createTask } from "../models/task";
import type { KanbanBoardStore } from "../store/kanban-board-store";
import type { TaskStore } from "../store/task-store";
import type { ColumnTransitionData, ColumnTransitionSource } from "./column-transition";
import { resolveTransitionAutomation } from "./column-transition";
import { getDefaultKanbanDevSessionSupervision } from "./board-session-supervision";
import { markTaskLaneSessionStatus, upsertTaskLaneSession } from "./task-lane-history";
import { checkDependencyGate, dependencyUnblockFields } from "./dependency-gate";
import { safeAtomicSave } from "./atomic-task-update";
import { checkWipLimit } from "./wip-limit-gate";
import { type KanbanBranchRules } from "./board-branch-rules";
import { PR_FAILURE_PREFIX } from "./pr-auto-create";
import { getTaskDevServerRegistry } from "./task-dev-server-registry";
import type { WorktreeStore } from "../db/pg-worktree-store";
import { onChildTaskStatusChanged } from "./parent-child-lifecycle";
import { shouldSkipTickForMemory } from "./memory-guard";
import { withHeartbeat } from "../scheduling/system-heartbeat-registry";
import {
  parseCbResetCount,
  parseSyncError,
  getErrorType,
  isCircuitBreaker,
  formatSyncError,
  buildCircuitBreakerError,
  buildRateLimitedError,
  buildDoneStuckError,
  buildDependencyBlockedError,
} from "./sync-error-writer";
import { getKanbanConfig } from "./kanban-config";
import { runPreGateChecks, loadSpecFilesConfig } from "./pre-gate-checker";
import { scanFrontendCoverage, generateTaskDescription } from "./frontend-coverage-scanner";

const cfg = getKanbanConfig();
const WATCHDOG_SCAN_INTERVAL_MS = cfg.watchdogScanIntervalMs;
const COMPLETED_AUTOMATION_CLEANUP_DELAY_MS = cfg.completedCleanupDelayMs;
const STALE_QUEUED_THRESHOLD_MS = cfg.staleQueuedThresholdMs;
const MAX_AUTOMATION_DURATION_MS = cfg.maxAutomationDurationMs;
const SESSION_RETRY_LIMIT = cfg.sessionRetryLimit;
const SESSION_RETRY_RESET_MS = cfg.sessionRetryResetMs;
/** @deprecated Use isCircuitBreaker() from sync-error-writer instead. Kept for backward compat. */
export const CIRCUIT_BREAKER_MARKER = "[circuit-breaker]";
export const RATE_LIMITED_MARKER = "[rate-limited]";

// Re-export parseCbResetCount from sync-error-writer for backward compatibility
// (kanban-lane-scanner imports it from this module).
export { parseCbResetCount } from "./sync-error-writer";

const RATE_LIMIT_KEYWORDS = ["429", "rate limit", "速率限制"];

function isRateLimitErrorMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RATE_LIMIT_KEYWORDS.some(k => lower.includes(k));
}

interface RecoveryNotificationParams {
  workspaceId: string;
  sessionId: string;
  cardId: string;
  cardTitle: string;
  boardId: string;
  columnId: string;
  reason: string;
  mode: KanbanDevSessionSupervisionMode;
  maxTurnsHit?: boolean;
  /** Structured context from the failed/recovered session */
  recoveryContext?: RecoverySessionContext;
}

/** Context about the previous session that triggered recovery. */
export interface RecoverySessionContext {
  /** Human-readable summary of what the previous session did */
  previousSessionSummary?: string;
  /** Specific error or failure detail */
  failureDetail?: string;
  /** How long the previous session ran, in ms */
  previousDurationMs?: number;
}

function translateRecoveryReason(reason: string): string {
  if (reason.includes("lease_expired")) return "Execution lease expired (session inactive)";
  if (reason.includes("watchdog_inactivity")) return "Agent was inactive for too long (watchdog timeout)";
  if (reason.includes("completion_criteria_not_met")) return "Agent stopped before completion criteria were met";
  if (reason.includes("agent_failed")) return "Agent session failed";
  return reason;
}

export type SendKanbanSessionPrompt = (params: {
  workspaceId: string;
  sessionId: string;
  prompt: string;
}) => Promise<void>;

function getDisabledSupervisionConfig(): KanbanDevSessionSupervision {
  return {
    ...getDefaultKanbanDevSessionSupervision(),
    mode: "disabled",
  };
}

function shouldSuperviseStage(stage: KanbanColumnStage): boolean {
  return stage === "dev";
}

function isRecoveryMode(mode: KanbanDevSessionSupervisionMode): mode is "watchdog_retry" | "ralph_loop" {
  return mode === "watchdog_retry" || mode === "ralph_loop";
}

const MAX_TURNS_STOP_REASONS = new Set(["tool_use", "max_turns"]);

/**
 * Merge two lane-session arrays: `overlay` entries overwrite `base` entries
 * with the same sessionId (preserving session-status updates from the handler),
 * and any session present in `overlay` but absent from `base` is appended.
 */
function mergeLaneSessions(
  base: TaskLaneSession[],
  overlay: TaskLaneSession[],
): TaskLaneSession[] {
  const result = base.map((s) => {
    const o = overlay.find((x) => x.sessionId === s.sessionId);
    return o ? { ...s, ...o } : { ...s };
  });
  const baseIds = new Set(base.map((s) => s.sessionId));
  for (const s of overlay) {
    if (!baseIds.has(s.sessionId)) result.push({ ...s });
  }
  return result;
}

function getRecoveryReason(event: AgentEvent, completionSatisfied: boolean, maxTurnsHit?: boolean): TaskLaneSessionRecoveryReason {
  if (event.type === AgentEventType.AGENT_TIMEOUT) {
    return "watchdog_inactivity";
  }
  if (event.type === AgentEventType.AGENT_FAILED) {
    const errMsg = typeof event.data?.error === "string" ? event.data.error : "";
    if (errMsg.includes("lease expired") || errMsg.includes("Execution lease")) {
      return "lease_expired";
    }
    return "agent_failed";
  }
  if (maxTurnsHit) {
    return "agent_failed";
  }
  if (event.type === AgentEventType.AGENT_COMPLETED && !completionSatisfied) {
    return "completion_criteria_not_met";
  }
  return "agent_failed";
}

function buildKanbanRecoveryPrompt(params: RecoveryNotificationParams): string {
  const lines = [
    "## Recovery Alert",
    "",
    `A previous agent session (id: ${params.sessionId}) in this lane is no longer active.`,
    `**Reason:** ${translateRecoveryReason(params.reason)}`,
    `**Card:** ${params.cardTitle} (${params.cardId})`,
    `**Board:** ${params.boardId}`,
    `**Column:** ${params.columnId}`,
    `**Recovery mode:** ${params.mode === "watchdog_retry" ? "watchdog_retry" : "ralph_loop"}`,
  ];

  if (params.maxTurnsHit) {
    lines.push(
      "",
      "## IMPORTANT: Max Turns Exceeded",
      "The previous session hit the turn limit and was terminated mid-task.",
      "Before continuing: commit ALL uncommitted changes using `git add` + `git commit` to preserve partial progress.",
    );
  }

  if (params.recoveryContext?.previousSessionSummary) {
    lines.push(
      "",
      "## Previous Session Summary",
      params.recoveryContext.previousSessionSummary,
    );
  }

  if (params.recoveryContext?.failureDetail) {
    lines.push(
      "",
      "## Failure Detail",
      params.recoveryContext.failureDetail,
    );
  }

  if (params.recoveryContext?.previousDurationMs != null) {
    const minutes = Math.round(params.recoveryContext.previousDurationMs / 60000);
    lines.push(
      "",
      `**Previous session duration:** ${minutes} minute(s)`,
    );
  }

  lines.push(
    "",
    "## Your Task",
    "Continue the objective of this card. Pick up where the previous session left off.",
    "If the previous session made partial progress, do NOT redo completed work.",
  );

  return lines.join("\\n");
}

function getAutomationStepLabel(step: KanbanAutomationStep | undefined, stepIndex: number): string {
  if (!step) {
    return `Step ${stepIndex + 1}`;
  }
  return step.specialistName ?? step.specialistId ?? step.role ?? `Step ${stepIndex + 1}`;
}

const NON_DEV_AUTOMATION_REPEAT_LIMIT = cfg.nonDevRepeatLimit;
/** Blocked lane allows more retries but is still bounded to prevent infinite loops. */
const BLOCKED_AUTOMATION_REPEAT_LIMIT = cfg.blockedRepeatLimit;
/** Only failed lane sessions within this window count toward the repeat limit. Older failures expire. */
const REPEAT_LIMIT_TIME_WINDOW_MS = cfg.repeatLimitTimeWindowMs;

export function getNonDevAutomationRunCount(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
  stage: KanbanColumnStage,
  stepId?: string,
): number {
  if (!task || stage === "dev") {
    return 0;
  }

  const laneSessions = task.laneSessions ?? [];
  const cutoffMs = Date.now() - REPEAT_LIMIT_TIME_WINDOW_MS;
  let runCount = 0;

  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId) {
      break;
    }
    if (stepId && entry.stepId && entry.stepId !== stepId) {
      continue;
    }
    // Infrastructure timeouts are not task failures — don't count them toward the loop limit
    if (entry.status === "timed_out") {
      continue;
    }
    // Time-window decay: skip failed sessions older than the cutoff window.
    // This prevents permanent blocking when the underlying issue has been resolved
    // (e.g., service restart, rate-limit window expired, provider recovered).
    const startedAtMs = entry.startedAt ? new Date(entry.startedAt).getTime() : 0;
    if (startedAtMs > 0 && startedAtMs < cutoffMs) {
      continue;
    }
    runCount += 1;
  }

  return runCount;
}

export function hasExceededNonDevAutomationRepeatLimit(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
  stage: KanbanColumnStage,
  stepId?: string,
): boolean {
  const limit = stage === "blocked"
    ? BLOCKED_AUTOMATION_REPEAT_LIMIT
    : NON_DEV_AUTOMATION_REPEAT_LIMIT;
  return getNonDevAutomationRunCount(task, columnId, stage, stepId) >= limit;
}

function buildNonDevAutomationRepeatLimitMessage(columnName: string, runCount: number, stage: KanbanColumnStage): string {
  const limit = stage === "blocked"
    ? BLOCKED_AUTOMATION_REPEAT_LIMIT
    : NON_DEV_AUTOMATION_REPEAT_LIMIT;
  return `Stopped Kanban automation for "${columnName}" after ${runCount + 1} runs. `
    + `${stage === "blocked" ? "Blocked" : "Non-dev"} lanes are limited to ${limit} automation runs to prevent loops.`;
}

/** Context persisted for a session attempt when supervision is enabled. */
export interface AutomationSessionSupervisionContext {
  attempt: number;
  mode: "watchdog_retry" | "ralph_loop";
  completionRequirement: KanbanDevSessionCompletionRequirement;
  objective: string;
  recoveredFromSessionId?: string;
  recoveryReason?: TaskLaneSessionRecoveryReason;
}

/** Represents an active column automation in progress */
export interface ActiveAutomation {
  cardId: string;
  cardTitle: string;
  boardId: string;
  workspaceId: string;
  columnId: string;
  columnName: string;
  stage: KanbanColumnStage;
  automation: KanbanColumnAutomation;
  steps: KanbanAutomationStep[];
  currentStepIndex: number;
  sessionId?: string;
  startedAt: Date;
  status: "queued" | "running" | "completed" | "failed";
  supervision: KanbanDevSessionSupervision;
  attempt: number;
  recoveryAttempts: number;
  signaledSessionIds: Set<string>;
  /** Whether to automatically try the next fallback step on failure */
  enableAutomaticFallback?: boolean;
  /** Number of times this automation has been re-triggered as stale */
  staleRetryCount?: number;
}

/** Structured result from createAutomationSession — allows callers to distinguish queued vs failed. */
export type CreateAutomationSessionResult = {
  sessionId: string | null;
  queued?: boolean;
};

/** Callback to create an agent session for a column automation */
export type CreateAutomationSession = (params: {
  workspaceId: string;
  cardId: string;
  cardTitle: string;
  columnId: string;
  columnName: string;
  automation: KanbanColumnAutomation;
  step: KanbanAutomationStep;
  stepIndex: number;
  supervision?: AutomationSessionSupervisionContext;
}) => Promise<string | CreateAutomationSessionResult | null>;

/** Callback to clean up a card's session queue entry before auto-advancing or recovering */
export type CleanupCardSession = (cardId: string) => void;

export type ResolveDevSessionSupervision = (params: {
  workspaceId: string;
  boardId: string;
  columnId: string;
  stage: KanbanColumnStage;
}) => Promise<KanbanDevSessionSupervision>;

export type ResolveBranchRules = (params: {
  workspaceId: string;
  boardId: string;
}) => Promise<KanbanBranchRules>;

/** Callback to notify Graph Refiner of Backlog changes */
export type NotifyBacklogChange = (boardId: string, workspaceId: string) => void;

/** Callback to scan persisted tasks for stale triggerSessionIds */
export type ScanStaleTaskTriggers = () => Promise<number>;

/** Callback to synchronously create a PR for a completed task (pre-automation) */
export type ExecuteAutoPrCreation = (params: {
  cardId: string;
  cardTitle: string;
  boardId: string;
  worktreeId: string;
}) => Promise<string | undefined>;

export class KanbanWorkflowOrchestrator {
  private handlerKey = "kanban-workflow-orchestrator";
  private activeAutomations = new Map<string, ActiveAutomation>();
  private pendingTimers: ReturnType<typeof setTimeout>[] = [];
  private started = false;
  private cleanupCardSession?: CleanupCardSession;
  private resolveDevSessionSupervision?: ResolveDevSessionSupervision;
  private resolveBranchRules?: ResolveBranchRules;
  private sendKanbanSessionPrompt?: SendKanbanSessionPrompt;
  private staleTriggerScanner?: ScanStaleTaskTriggers;
  private executeAutoPrCreation?: ExecuteAutoPrCreation;
  private staleTriggerScanCycle = 0;
  private watchdogTimer?: ReturnType<typeof setInterval>;
  private sessionFailureCounts = new Map<string, number>();
  private circuitBreakerLastLogAt = new Map<string, number>();
  private worktreeStore?: WorktreeStore;
  private notifyBacklogChange?: NotifyBacklogChange;

  constructor(
    private eventBus: EventBus,
    private kanbanBoardStore: KanbanBoardStore,
    private taskStore: TaskStore,
    private createSession?: CreateAutomationSession,
  ) {}

  /** Start listening for column transition events */
  start(): void {
    if (this.started) {
      return;
    }
    this.eventBus.on(this.handlerKey, (event: AgentEvent) => {
      if (event.type === AgentEventType.COLUMN_TRANSITION) {
        this.handleColumnTransition(event).catch((err) => {
          console.error("[WorkflowOrchestrator] handleColumnTransition error:", err);
        });
      }
      if (
        event.type === AgentEventType.AGENT_COMPLETED
        || event.type === AgentEventType.REPORT_SUBMITTED
        || event.type === AgentEventType.AGENT_FAILED
        || event.type === AgentEventType.AGENT_TIMEOUT
      ) {
        this.handleAgentCompletion(event).catch((err) => {
          console.error("[WorkflowOrchestrator] handleAgentCompletion error:", err);
        });
      }
    });
    this.watchdogTimer = setInterval(() => {
      void withHeartbeat("watchdog-scanner", () => this.scanForInactiveSessions());
    }, WATCHDOG_SCAN_INTERVAL_MS);
    (this.watchdogTimer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    this.started = true;
  }

  /** Stop listening */
  stop(): void {
    if (!this.started) {
      return;
    }
    this.eventBus.off(this.handlerKey);
    this.activeAutomations.clear();
    this.sessionFailureCounts.clear();
    this.circuitBreakerLastLogAt.clear();
    for (const t of this.pendingTimers) clearTimeout(t);
    this.pendingTimers = [];
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    this.started = false;
  }

  /** Set the session creation callback */
  setCreateSession(fn: CreateAutomationSession): void {
    this.createSession = fn;
  }

  /** Set the cleanup callback for session queue entries */
  setCleanupCardSession(fn: CleanupCardSession): void {
    this.cleanupCardSession = fn;
  }

  /** Set the resolver for board-level dev session supervision config */
  setResolveDevSessionSupervision(fn: ResolveDevSessionSupervision): void {
    this.resolveDevSessionSupervision = fn;
  }

  /** Set the resolver for board-level branch rules */
  setResolveBranchRules(fn: ResolveBranchRules): void {
    this.resolveBranchRules = fn;
  }

  /** Set the callback used to send a prompt message into a live ACP session */
  setSendKanbanSessionPrompt(fn: SendKanbanSessionPrompt): void {
    this.sendKanbanSessionPrompt = fn;
  }

  /** Set the callback to scan persisted tasks for stale triggerSessionIds */
  setScanStaleTaskTriggers(fn: ScanStaleTaskTriggers): void {
    this.staleTriggerScanner = fn;
  }

  /** Set the callback for synchronous auto PR creation (called before done-lane steps) */
  setExecuteAutoPrCreation(fn: ExecuteAutoPrCreation): void {
    this.executeAutoPrCreation = fn;
  }

  /** Set the worktree store for fan-in merge support in parent-child lifecycle */
  setWorktreeStore(store: WorktreeStore): void {
    this.worktreeStore = store;
  }

  /** Set the callback to notify Graph Refiner of Backlog changes */
  setNotifyBacklogChange(fn: NotifyBacklogChange): void {
    this.notifyBacklogChange = fn;
  }

  /** Callback to spawn a standalone conflict-resolver session (independent of the pipeline) */
  private triggerStandaloneConflictResolver?: (params: { cardId: string }) => Promise<{ sessionId?: string; error?: string }>;

  setTriggerStandaloneConflictResolver(
    fn: (params: { cardId: string }) => Promise<{ sessionId?: string; error?: string }>,
  ): void {
    this.triggerStandaloneConflictResolver = fn;
  }

  /** Get all active automations */
  getActiveAutomations(): ActiveAutomation[] {
    return Array.from(this.activeAutomations.values());
  }

  /** Get active automation for a specific card */
  getAutomationForCard(cardId: string): ActiveAutomation | undefined {
    return this.activeAutomations.get(cardId);
  }

  async processColumnTransition(data: ColumnTransitionData): Promise<void> {
    await this.handleColumnTransitionData(data);
  }

  private async handleColumnTransition(event: AgentEvent): Promise<void> {
    const data = event.data as unknown as ColumnTransitionData;
    console.log(
      `[WorkflowOrchestrator] COLUMN_TRANSITION: card=${data.cardId} ` +
      `${data.fromColumnId}→${data.toColumnId} (source: ${data.source?.type ?? "unknown"})`,
    );
    await this.handleColumnTransitionData(data);
  }

  private async handleColumnTransitionData(data: ColumnTransitionData): Promise<void> {
    // Anti-double-trigger: if a watchdog stale retry fires while LaneScanner
    // already re-triggered this card, skip to prevent duplicate sessions.
    const source = data.source;
    const isWatchdogRetry = source?.type === "watchdog_retry"
      || (source === undefined && (data as unknown as Record<string, unknown>)._source === "watchdog_stale_retry");
    if (isWatchdogRetry && this.activeAutomations.has(data.cardId)) {
      console.log(
        `[WorkflowOrchestrator] Skipping watchdog retry: automation already active for card=${data.cardId}`,
      );
      return;
    }

    // review-degraded: let DoneLaneRecovery handle it instead of re-queuing.
    if (source?.type === "review_degraded") {
      console.log(
        `[WorkflowOrchestrator] Skipping review_degraded for card=${data.cardId}: handled by DoneLaneRecovery`,
      );
      return;
    }

    // Advance-only: LaneScanner detected a stuck card (all steps completed but
    // auto-advance failed). Skip full automation and only retry the card move.
    const isAdvanceOnly = source?.type === "advance_only"
      || (source === undefined && !!(data as unknown as Record<string, unknown>)._advanceOnly);
    if (isAdvanceOnly) {
      const task = await this.taskStore.get(data.cardId);
      if (!task || !task.columnId) return;
      const board = await this.kanbanBoardStore.get(data.boardId);
      if (!board) return;
      const column = board.columns.find((c) => c.id === task.columnId);
      if (!column?.automation?.autoAdvanceOnSuccess) return;
      const stage = column.stage ?? inferStageFromColumnId(column.id) ?? "backlog";
      await this.autoAdvanceCard(data.cardId, {
        cardId: data.cardId,
        cardTitle: data.cardTitle,
        boardId: data.boardId,
        workspaceId: data.workspaceId,
        columnId: task.columnId,
        columnName: column.name,
        stage: stage as KanbanColumnStage,
        automation: column.automation,
        steps: [],
        currentStepIndex: 0,
        startedAt: new Date(),
        status: "completed",
        supervision: getDefaultKanbanDevSessionSupervision(),
        attempt: 0,
        recoveryAttempts: 0,
        signaledSessionIds: new Set(),
      });
      return;
    }

    const board = await this.kanbanBoardStore.get(data.boardId);
    if (!board) {
      console.warn(`[WorkflowOrchestrator] COLUMN_TRANSITION: board not found for id=${data.boardId}`);
      return;
    }
    const resolved = resolveTransitionAutomation(board, data);
    if (!resolved) {
      console.log(
        `[WorkflowOrchestrator] No automation resolved for card=${data.cardId} ` +
        `${data.fromColumnId}→${data.toColumnId}`,
      );
      return;
    }
    const task = await this.taskStore.get(data.cardId);

    // Backward transition (rework) detection: when a card moves to an
    // earlier column (e.g. review→dev after rejection), clear the
    // destination column's laneSession entries so the automation system
    // treats it as a fresh start rather than a completed step.
    const fromIdx = board.columns.findIndex((c) => c.id === data.fromColumnId);
    const toIdx = board.columns.findIndex((c) => c.id === data.toColumnId);
    if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx && task?.laneSessions) {
      // Clear BOTH source and destination column sessions on backward transition.
      // The card is getting a fresh start — stale sessions from either column
      // would cause LaneScanner to incorrectly believe steps are already completed
      // when the card later returns to the source column.
      const prevCount = task.laneSessions.length;
      const cleared = task.laneSessions.filter(
        (s: { columnId?: string }) =>
          s.columnId !== data.toColumnId && s.columnId !== data.fromColumnId,
      );
      if (cleared.length !== prevCount) {
        task.laneSessions = cleared;
        task.updatedAt = new Date();
        await this.taskStore.save(task);
        console.log(
          `[WorkflowOrchestrator] Backward transition (${data.fromColumnId}→${data.toColumnId}). ` +
          `Cleared ${prevCount - cleared.length} laneSession(s) for card ${data.cardId} ` +
          `(source=${data.fromColumnId}, dest=${data.toColumnId}).`,
        );
      }
    }

    const laneObjective = task?.objective?.trim() || data.cardTitle;
    const targetColumn = resolved.column;
    const automation = resolved.automation;
    const steps = getKanbanAutomationSteps(automation);

    // Notify Graph Refiner when a card enters Backlog (non-blocking)
    if (targetColumn.stage === "backlog") {
      this.notifyBacklogChange?.(data.boardId, data.workspaceId);
    }

    // Done-lane pre-automation: synchronous PR creation and optional Auto Merger injection.
    const targetStage = targetColumn.stage ?? inferStageFromColumnId(targetColumn.id);
    if (targetStage === "done" && this.resolveBranchRules) {
      const branchRules = await this.resolveBranchRules({ workspaceId: data.workspaceId, boardId: data.boardId });

      // Synchronous pre-automation PR creation — runs before any done-lane steps.
      if (branchRules?.lifecycle.autoCreatePullRequest) {
        if (task && !task.pullRequestUrl && task.worktreeId && this.executeAutoPrCreation) {
          console.log(
            `[WorkflowOrchestrator] Pre-automation PR creation for task ${data.cardId}.`,
          );
          try {
            await this.executeAutoPrCreation({
              cardId: data.cardId,
              cardTitle: data.cardTitle,
              boardId: data.boardId,
              worktreeId: task.worktreeId,
            });
          } catch (err) {
            console.error(
              `[WorkflowOrchestrator] Pre-automation PR creation failed for ${data.cardId}:`,
              err,
            );
            // Continue automation — PR creation failure is not fatal.
            // The done-finalizer will correctly note the missing PR link.
          }
        }
      }

      // Done-lane early exit: if the card already has a PR URL, decide whether
      // it is genuinely done or needs auto-merge processing.
      const freshTask = task ? await this.taskStore.get(data.cardId) : undefined;
      if (freshTask?.pullRequestUrl) {
        const deliveryRules = resolved.automation?.deliveryRules;
        const wantsAutoMerge = deliveryRules?.autoMergeAfterPR === true;
        const prAlreadyMerged = Boolean(freshTask.pullRequestMergedAt);
        const prIsPlaceholder = freshTask.pullRequestUrl === "manual"
          || freshTask.pullRequestUrl === "already-merged";

        const isFullyDone = prAlreadyMerged || !wantsAutoMerge || prIsPlaceholder;

        if (isFullyDone) {
          if (freshTask.status !== "COMPLETED") {
            if (freshTask.version !== undefined && this.taskStore.atomicUpdate) {
              await this.taskStore.atomicUpdate(data.cardId, freshTask.version, {
                status: "COMPLETED" as TaskStatus,
                lastSyncError: undefined,
              });
            } else {
              freshTask.status = "COMPLETED" as TaskStatus;
              freshTask.lastSyncError = undefined;
              freshTask.updatedAt = new Date();
              await this.taskStore.save(freshTask);
            }
            console.log(
              `[WorkflowOrchestrator] Done-lane terminal guard: card ${data.cardId} ` +
              `${prAlreadyMerged ? "PR merged" : `has PR (${freshTask.pullRequestUrl})`}. Marked COMPLETED.`,
            );
          }
          console.log(
            `[WorkflowOrchestrator] Done-lane early exit for card ${data.cardId}: ` +
            `PR exists (${freshTask.pullRequestUrl}). Skipping automation.`,
          );
          return;
        }

        // autoMergeAfterPR is true and PR is not yet merged — fall through
        // to allow the automation pipeline (with auto-merger) to run.
        console.log(
          `[WorkflowOrchestrator] Done-lane continuing for card ${data.cardId}: ` +
          `auto-merge requested, PR not yet merged (${freshTask.pullRequestUrl}).`,
        );
      }

      // Conditionally inject auto-merger step when deliveryRules.autoMergeAfterPR is true.
      const doneDeliveryRules = resolved.automation?.deliveryRules;
      if (doneDeliveryRules?.autoMergeAfterPR) {
        const hasAutoMerger = steps.some(
          (s) => s.specialistId === "kanban-auto-merger",
        );
        if (!hasAutoMerger) {
          steps.push({
            id: "auto-merger",
            role: "DEVELOPER",
            specialistId: "kanban-auto-merger",
            specialistName: "Auto Merger",
          });
        }
      }
    }

    // Append fallback agent chain steps if enabled
    const fallbackSteps = task?.enableAutomaticFallback && task.fallbackAgentChain?.length
      ? task.fallbackAgentChain.map((agent, index) => ({
        id: `fallback-${index + 1}`,
        providerId: agent.providerId,
        role: agent.role,
        specialistId: agent.specialistId,
        specialistName: agent.specialistName,
      }))
      : [];
    steps.push(...fallbackSteps);
    if (steps.length === 0) return;

    // Approved-card bypass: if a card in the blocked lane already has an APPROVED
    // verification verdict, allow one more automation run to route it back to done,
    // regardless of the repeat limit. This handles misrouted approved cards.
    const isApprovedInBlockedLane = targetColumn.stage === "blocked"
      && task?.verificationVerdict === "APPROVED";

    if (isApprovedInBlockedLane) {
      console.log(
        `[WorkflowOrchestrator] Allowing blocked-lane automation for APPROVED card ${data.cardId} ` +
        `despite repeat limit (recovery routing).`,
      );
    } else if (hasExceededNonDevAutomationRepeatLimit(task, targetColumn.id, targetColumn.stage)) {
      if (task && task.status !== "COMPLETED") {
        task.lastSyncError = buildNonDevAutomationRepeatLimitMessage(
          targetColumn.name,
          getNonDevAutomationRunCount(task, targetColumn.id, targetColumn.stage),
          targetColumn.stage,
        );
        task.updatedAt = new Date();
        await this.taskStore.save(task);
      }
      console.log(
        `[WorkflowOrchestrator] Stopped repeated non-dev automation for card ${data.cardId} in column ${targetColumn.id}.`,
      );
      return;
    }

    // Dependency gate: block automation if any dependency is unfinished
    if (task && task.dependencies.length > 0) {
      const depCheck = await checkDependencyGate(task, board.columns, this.taskStore);
      if (depCheck.blocked) {
        const newError = buildDependencyBlockedError(depCheck.pendingDependencies);
        // Only log when the blocked state changes (avoid repeating every 30s)
        if (task.lastSyncError !== newError) {
          console.warn(
            `[WorkflowOrchestrator] Card ${data.cardId} blocked by dependencies: ${depCheck.pendingDependencies.join(", ")}`,
          );
        }
        task.lastSyncError = newError;
        task.dependencyStatus = "blocked";
        task.updatedAt = new Date();
        await this.taskStore.save(task);
        return;
      }
    }

    // WIP gate: block automation if the target column has reached its WIP limit.
    if (task && targetColumn.automation?.wipLimit && targetColumn.automation.wipLimit > 0) {
      const wipResult = await checkWipLimit(task, targetColumn.id, board, this.taskStore);
      if (!wipResult.allowed) {
        const newError = `[wip-limited] ${wipResult.message}`;
        if (task.lastSyncError !== newError) {
          console.warn(
            `[WorkflowOrchestrator] Card ${data.cardId} blocked by WIP limit: ${wipResult.currentCount}/${wipResult.limit}`,
          );
        }
        task.lastSyncError = newError;
        task.updatedAt = new Date();
        await this.taskStore.save(task);
        return;
      }
    }

    // Frontend coverage gate: auto-create backlog tasks for empty shell pages.
    // Runs on every dev→review transition to catch pages created by skeleton tasks.
    if (task && targetColumn.stage === "review" && task.worktreeId) {
      try {
        const taskWorktree = await this.worktreeStore?.get(task.worktreeId);
        const repoRoot = taskWorktree?.worktreePath;
        if (repoRoot) {
          const coverage = scanFrontendCoverage(repoRoot);
          if (coverage.emptyPages.length > 0) {
            // Check existing tasks to avoid duplicates
            const existingTasks = await this.taskStore.listByWorkspace(task.workspaceId);
            const existingTitles = new Set(existingTasks.map((t) => t.title));
            let created = 0;
            for (const page of coverage.emptyPages) {
              const desc = generateTaskDescription(page);
              if (existingTitles.has(desc.title)) continue;

              // Find the backlog column for this board
              const board = task.boardId
                ? await this.kanbanBoardStore.get(task.boardId)
                : undefined;
              const backlogColumn = board?.columns.find((c) => c.stage === "backlog");

              const newTask = createTask({
                id: `fe-${Date.now()}-${created}`,
                title: desc.title,
                objective: desc.objective,
                workspaceId: task.workspaceId,
                boardId: task.boardId,
                columnId: backlogColumn?.id ?? "backlog",
                dependencies: [task.id],
              });
              await this.taskStore.save(newTask);
              created++;
            }
            if (created > 0) {
              console.info(
                `[WorkflowOrchestrator] Auto-created ${created} frontend task(s) for empty pages in ${repoRoot}`,
              );
            }
          }
        }
      } catch (feError) {
        // Frontend coverage check failure should not block the pipeline
        console.warn(
          `[WorkflowOrchestrator] Frontend coverage scan error: ${feError instanceof Error ? feError.message : feError}`,
        );
      }
    }

    // Pre-gate deterministic check: block if hard violations found before LLM review.
    // Only runs when the target column is the review stage.
    if (task && (targetColumn.stage === "review" || targetColumn.stage === "done")) {
      try {
        const taskWorktree = task.worktreeId
          ? await this.worktreeStore?.get(task.worktreeId)
          : undefined;
        const repoRoot = taskWorktree?.worktreePath;
        if (repoRoot) {
          const specConfig = loadSpecFilesConfig(repoRoot);
          const preGateResult = await runPreGateChecks(task, {
            repoRoot,
            forbiddenTerms: specConfig.forbiddenTerms,
            excludeDirs: specConfig.excludeDirs,
            skipTsc: false,
          });
          if (!preGateResult.passed) {
            const blockerSummary = preGateResult.blockers
              .map((b) => `[${b.rule}] ${b.file}${b.line ? `:${b.line}` : ""}: ${b.message}`)
              .join("; ");
            const newError = `[pre-gate-blocked] ${blockerSummary}`;
            if (task.lastSyncError !== newError) {
              console.warn(
                `[WorkflowOrchestrator] Card ${data.cardId} blocked by pre-gate checks: ${preGateResult.blockers.length} blocker(s)`,
              );
            }
            task.lastSyncError = newError;
            // Persistent field — survives lastSyncError cleanup on session start
            task.preGateBlockers = blockerSummary;
            task.updatedAt = new Date();
            await this.taskStore.save(task);
            return;
          }
          // Warnings are logged but don't block. Clear stale blockers from prior runs.
          if (task.preGateBlockers) {
            task.preGateBlockers = undefined;
            task.updatedAt = new Date();
            await this.taskStore.save(task);
          }
          if (preGateResult.warnings.length > 0) {
            console.info(
              `[WorkflowOrchestrator] Card ${data.cardId} pre-gate warnings: ${preGateResult.warnings.length}`,
            );
          }
        }
      } catch (preGateError) {
        // Pre-gate check failure should not block the pipeline — log and continue
        console.warn(
          `[WorkflowOrchestrator] Pre-gate check error for card ${data.cardId}: ${preGateError instanceof Error ? preGateError.message : preGateError}`,
        );
      }
    }

    const supervision = shouldSuperviseStage(targetColumn.stage)
      ? (await this.resolveDevSessionSupervision?.({
        workspaceId: data.workspaceId,
        boardId: data.boardId,
        columnId: targetColumn.id,
        stage: targetColumn.stage,
      })) ?? getDefaultKanbanDevSessionSupervision()
      : getDisabledSupervisionConfig();

    // Early circuit-breaker check: skip cards that exceeded session retry limit.
    // This runs before creating any automation entry or allocating resources.
    if (this.createSession) {
      const failureCount = this.sessionFailureCounts.get(data.cardId) ?? 0;
      // Only consider cooldown reset when circuitBreakerLastLogAt was actually set
      // (i.e., the failure count previously reached SESSION_RETRY_LIMIT).
      // Without this guard, a stale failureCount without a timestamp produces
      // resetAt = 0 + SESSION_RETRY_RESET_MS ≈ epoch → immediate false reset.
      const lastTriggeredAt = this.circuitBreakerLastLogAt.get(data.cardId);
      const resetAt = lastTriggeredAt !== undefined
        ? lastTriggeredAt + SESSION_RETRY_RESET_MS
        : Infinity;
      const isReset = Date.now() >= resetAt;

      if (failureCount >= SESSION_RETRY_LIMIT && !isReset) {
        // Throttle: log at most once every 5 minutes per card
        if (lastTriggeredAt === undefined || Date.now() - lastTriggeredAt > SESSION_RETRY_RESET_MS) {
          this.circuitBreakerLastLogAt.set(data.cardId, Date.now());
          console.warn(
            `[WorkflowOrchestrator] Circuit breaker active for card ${data.cardId}: ` +
            `${failureCount} consecutive failures. Next retry after ${new Date(resetAt).toISOString()}.`,
          );
        }
        return;
      }

      // Allow retry after cooldown period
      if (isReset && lastTriggeredAt !== undefined) {
        this.sessionFailureCounts.delete(data.cardId);
        this.circuitBreakerLastLogAt.delete(data.cardId);
        console.log(
          `[WorkflowOrchestrator] Circuit breaker reset for card ${data.cardId} after cooldown.`,
        );
      }
    }

    // ── Orphan cleanup from Overseer ──────────────────────────────────────────
    // Overseer detects orphan tasks (triggerSessionId cleared but still IN_PROGRESS)
    // and emits a COLUMN_TRANSITION with source.type="orphan_cleanup" to notify us
    // to clear any zombie activeAutomations entry before LaneScanner re-triggers.
    if (data.source?.type === "orphan_cleanup") {
      const zombie = this.activeAutomations.get(data.cardId);
      if (zombie && (zombie.status === "running" || zombie.status === "queued")) {
        console.warn(
          `[WorkflowOrchestrator] Orphan cleanup: clearing zombie activeAutomation for card ${data.cardId} ` +
          `(status=${zombie.status}, column=${zombie.columnId}).`,
        );
        zombie.status = "failed";
        this.cleanupCardSession?.(data.cardId);
        this.activeAutomations.delete(data.cardId);
      }
      // Continue to normal flow so the card gets re-triggered below.
    }

    const existingAutomation = this.activeAutomations.get(data.cardId);
    if (existingAutomation
      && existingAutomation.boardId === data.boardId
      && (existingAutomation.status === "queued" || existingAutomation.status === "running")) {

      // ── Zombie defense at entry: running automation with dead session ──
      // If the session backing this "running" automation no longer exists in
      // HttpSessionStore, it's a zombie. Clear it and fall through to re-trigger.
      if (existingAutomation.status === "running" && existingAutomation.sessionId) {
        const sessionStore = getHttpSessionStore();
        const sessionExists = sessionStore.getSession(existingAutomation.sessionId);
        if (!sessionExists) {
          const ageMs = Date.now() - existingAutomation.startedAt.getTime();
          console.warn(
            `[WorkflowOrchestrator] Zombie automation at entry: card ${data.cardId} ` +
            `session ${existingAutomation.sessionId} gone (${Math.round(ageMs / 60_000)}m old). Clearing.`,
          );
          existingAutomation.status = "failed";
          this.cleanupCardSession?.(data.cardId);
          this.activeAutomations.delete(data.cardId);
          // Fall through to re-trigger below — do NOT return.
        } else if (existingAutomation.columnId === targetColumn.id) {
          // Normal running automation in same column — skip.
          return;
        }
      } else if (existingAutomation.columnId === targetColumn.id) {
        // If the existing automation is in the same column, skip entirely.
        return;
      }

      // Debounce: if the current automation started very recently (< 2s),
      // the card is being rapidly moved (e.g. by user or upstream process).
      // Wait briefly to avoid tearing down a session that will immediately be replaced.
      const timeSinceStart = Date.now() - existingAutomation.startedAt.getTime();
      if (timeSinceStart < 2_000) {
        console.log(
          `[WorkflowOrchestrator] Debouncing rapid card move for ${data.cardId} ` +
          `(${existingAutomation.columnId} → ${targetColumn.id}, automation age ${timeSinceStart}ms)`,
        );
        await new Promise(r => setTimeout(r, 2_000 - timeSinceStart));
        // After waiting, re-check whether the card is still in the target column.
        const latestTask = await this.taskStore.get(data.cardId);
        if (latestTask?.columnId !== targetColumn.id) {
          console.log(`[WorkflowOrchestrator] Card ${data.cardId} moved again during debounce, skipping`);
          return;
        }
      }

      // If the existing automation is in a DIFFERENT column but still active,
      // the agent called move_card while the previous automation was still running.
      // Cancel the stale automation before starting the new one.
      console.warn(
        `[WorkflowOrchestrator] Cancelling stale automation for card ${data.cardId} ` +
        `in column ${existingAutomation.columnId} (status: ${existingAutomation.status}) ` +
        `because card moved to column ${targetColumn.id}.`,
      );
      existingAutomation.status = "failed";
      this.cleanupCardSession?.(data.cardId);
      // Mark the stale automation's session as "transitioned" so it doesn't
      // stay "running" in laneSessions after the card moves to a new column.
      if (existingAutomation.sessionId) {
        const staleTask = await this.taskStore.get(data.cardId);
        if (staleTask) {
          markTaskLaneSessionStatus(staleTask, existingAutomation.sessionId, "transitioned");
          await this.taskStore.save(staleTask);
        }
      }
    }

    const startStepIndex = typeof data.resumeStepIndex === "number"
      && data.resumeStepIndex >= 0
      && data.resumeStepIndex < steps.length
      ? data.resumeStepIndex
      : 0;

    const automationEntry: ActiveAutomation = {
      cardId: data.cardId,
      cardTitle: data.cardTitle,
      boardId: data.boardId,
      workspaceId: data.workspaceId,
      columnId: targetColumn.id,
      columnName: targetColumn.name,
      stage: targetColumn.stage,
      automation,
      steps,
      currentStepIndex: startStepIndex,
      startedAt: new Date(),
      status: "queued",
      supervision,
      attempt: 1,
      recoveryAttempts: 0,
      signaledSessionIds: new Set(),
      enableAutomaticFallback: task?.enableAutomaticFallback,
      staleRetryCount: typeof data.staleRetryCount === "number" ? data.staleRetryCount : 0,
    };

    this.activeAutomations.set(data.cardId, automationEntry);

    // Trigger agent session if callback is available
    if (this.createSession) {
      try {
        const effectiveStep = steps[startStepIndex];
        const rawResult = await this.createSession({
          workspaceId: data.workspaceId,
          cardId: data.cardId,
          cardTitle: data.cardTitle,
          columnId: targetColumn.id,
          columnName: targetColumn.name,
          automation,
          step: effectiveStep,
          stepIndex: startStepIndex,
          supervision: this.buildSupervisionContext(automationEntry, laneObjective),
        });
        const sessionId = typeof rawResult === "object" && rawResult !== null
          ? rawResult.sessionId
          : rawResult;
        const isQueued = typeof rawResult === "object" && rawResult !== null && rawResult.queued === true;
        if (sessionId) {
          automationEntry.status = "running";
          automationEntry.sessionId = sessionId;
          this.sessionFailureCounts.delete(data.cardId);
          // Clear stale lastSyncError on success — reload to avoid overwriting
          // fields (triggerSessionId, laneSessions) modified by startKanbanTaskSession.
          // Any persisted error (circuit_breaker, dependency_blocked, wip_limited, etc.)
          // is now stale since the session started successfully.
          if (task?.lastSyncError) {
            const freshTask = await this.taskStore.get(data.cardId);
            if (freshTask) {
              freshTask.lastSyncError = undefined;
              freshTask.updatedAt = new Date();
              await this.taskStore.save(freshTask);
            }
          }
        } else if (isQueued) {
          automationEntry.status = "queued";
          console.log(
            `[WorkflowOrchestrator] Session queued for card ${data.cardId}, not counting as failure.`,
          );
        } else {
          automationEntry.status = "failed";
          // Record a failed laneSession so that hasExceededNonDevAutomationRepeatLimit
          // counts this attempt for non-dev columns (done/review/blocked).
          // Without this, createSession-null never increments laneSessions,
          // so the repeat limit guard never triggers.
          // Reload task to avoid overwriting fields (e.g. lastSyncError) modified
          // by startKanbanTaskSession during the failed session creation attempt.
          if (targetColumn.stage !== "dev") {
            const freshTask = await this.taskStore.get(data.cardId);
            if (freshTask) {
              upsertTaskLaneSession(freshTask, {
                sessionId: `failed-${data.cardId}-${Date.now()}`,
                columnId: targetColumn.id,
                stepId: steps[startStepIndex]?.id,
                stepIndex: startStepIndex,
                status: "failed",
              });
              await this.taskStore.save(freshTask);
            }
          }
          // Rate-limit errors are transient — don't consume circuit-breaker quota.
          // Reload task before writing lastSyncError to avoid overwriting fields
          // (triggerSessionId, laneSessions) modified by startKanbanTaskSession.
          const lastErr = task?.lastSyncError ?? "";
          if (lastErr.startsWith(RATE_LIMITED_MARKER) || isRateLimitErrorMessage(lastErr)) {
            console.warn(
              `[WorkflowOrchestrator] Rate-limited for card ${data.cardId}, not counting towards circuit breaker.`,
            );
          } else {
            const newCount = (this.sessionFailureCounts.get(data.cardId) ?? 0) + 1;
            this.sessionFailureCounts.set(data.cardId, newCount);
            console.error(
              `[WorkflowOrchestrator] createSession returned null for card ${data.cardId} in column ${targetColumn.id}. ` +
              `Consecutive failures: ${newCount}/${SESSION_RETRY_LIMIT}.`,
            );
            if (newCount >= SESSION_RETRY_LIMIT) {
              this.circuitBreakerLastLogAt.set(data.cardId, Date.now());
              const cbTask = await this.taskStore.get(data.cardId);
              if (cbTask) {
                const prevResets = parseCbResetCount(cbTask.lastSyncError);
                const existingPayload = parseSyncError(cbTask.lastSyncError);
                const prError = existingPayload?.prev
                  ?? (cbTask.lastSyncError?.includes(PR_FAILURE_PREFIX) ? cbTask.lastSyncError : undefined);
                cbTask.lastSyncError = buildCircuitBreakerError(prevResets, `Session creation failed ${newCount} times. Retry after cooldown.`, prError);
                cbTask.updatedAt = new Date();
                await this.taskStore.save(cbTask);
              }
            }
          }
        }
      } catch (err) {
        automationEntry.status = "failed";
        const errMsg = err instanceof Error ? err.message : String(err);
        // System-level errors (stack overflow, type errors) are infrastructure
        // issues — they must not consume circuit-breaker quota, otherwise a
        // transient runtime bug permanently disables automation for the card.
        if (err instanceof RangeError || err instanceof TypeError) {
          console.error(
            `[WorkflowOrchestrator] System error for card ${data.cardId}: ${errMsg}. ` +
            `Not counting towards circuit breaker.`,
          );
        // Rate-limit errors are transient — don't consume circuit-breaker quota
        } else if (isRateLimitErrorMessage(errMsg)) {
          console.warn(
            `[WorkflowOrchestrator] Rate-limited for card ${data.cardId}, not counting towards circuit breaker.`,
          );
          const rlTask = await this.taskStore.get(data.cardId);
          if (rlTask) {
            rlTask.lastSyncError = buildRateLimitedError(errMsg);
            rlTask.updatedAt = new Date();
            await this.taskStore.save(rlTask);
          }
        } else {
          const newCount = (this.sessionFailureCounts.get(data.cardId) ?? 0) + 1;
          this.sessionFailureCounts.set(data.cardId, newCount);
          console.error("[WorkflowOrchestrator] Failed to create session:", err);
          if (newCount >= SESSION_RETRY_LIMIT) {
            this.circuitBreakerLastLogAt.set(data.cardId, Date.now());
            const exTask = await this.taskStore.get(data.cardId);
            if (exTask) {
              const prevResets = parseCbResetCount(exTask.lastSyncError);
              exTask.lastSyncError = buildCircuitBreakerError(prevResets, `Session creation failed ${newCount} times. Retry after cooldown.`);
              exTask.updatedAt = new Date();
              await this.taskStore.save(exTask);
            }
          }
        }
      }
    }
  }

  private async handleAgentCompletion(event: AgentEvent): Promise<void> {
    const eventSessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : undefined;
    console.log(
      `[WorkflowOrchestrator] handleAgentCompletion: type=${event.type} sessionId=${eventSessionId ?? "none"} activeAutomations=${this.activeAutomations.size}`,
    );
    for (const [cardId, automation] of this.activeAutomations.entries()) {
      if (automation.status === "completed" || automation.status === "failed") continue;

      const eventSessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : undefined;
      if (!eventSessionId) continue;

      const task = await this.taskStore.get(cardId);
      const sessionId = automation.sessionId ?? task?.triggerSessionId;
      if (!automation.sessionId && sessionId) {
        automation.sessionId = sessionId;
        automation.status = "running";
      }

      // Match only by the automation's own sessionId or the card's current triggerSessionId.
      const isRelated = Boolean(sessionId && eventSessionId === sessionId);
      if (!isRelated) continue;

      const sessionStore = getHttpSessionStore();
      const sessionActivity = sessionStore.getSessionActivity(eventSessionId);
      if (task) {
        upsertTaskLaneSession(task, {
          sessionId: eventSessionId,
          lastActivityAt: sessionActivity?.lastMeaningfulActivityAt ?? sessionActivity?.lastActivityAt,
        });
      }

      const stopReason = typeof event.data?.stopReason === "string" ? event.data.stopReason : undefined;
      const maxTurnsHit = Boolean(stopReason && MAX_TURNS_STOP_REASONS.has(stopReason));
      const successEvent =
        event.type !== AgentEventType.AGENT_FAILED
        && event.type !== AgentEventType.AGENT_TIMEOUT
        && event.data?.success !== false
        && !maxTurnsHit;
      const completionSatisfied = await this.isCompletionSatisfied(task, automation, successEvent);
      const shouldRecover = task
        ? await this.shouldRecover(task, automation, event, completionSatisfied, maxTurnsHit)
        : false;

      if (task) {
        const nextStatus = event.type === AgentEventType.AGENT_TIMEOUT
          ? "timed_out"
          : maxTurnsHit
            ? "timed_out"
            : successEvent && completionSatisfied
              ? "completed"
              : "failed";
        markTaskLaneSessionStatus(task, eventSessionId, nextStatus);
        if (!successEvent || !completionSatisfied || maxTurnsHit) {
          upsertTaskLaneSession(task, {
            sessionId: eventSessionId,
            recoveryReason: getRecoveryReason(event, completionSatisfied, maxTurnsHit),
          });
        }
      }

      const nextStepIndex = automation.currentStepIndex + 1;
      const hasNextStep = successEvent
        && completionSatisfied
        && nextStepIndex < automation.steps.length;
      // Soft-gate: when the current GATE step fails/times out but there are remaining
      // steps in the lane, attempt to advance anyway. The downstream specialist (e.g.
      // Review Guard) is responsible for the final APPROVED/REJECTED decision, so a
      // failed upstream QA check should not prevent it from running.
      const currentStepRole = automation.steps[automation.currentStepIndex]?.role?.toUpperCase();
      const canSoftGateAdvance = !successEvent
        && currentStepRole === "GATE"
        && nextStepIndex < automation.steps.length;
      let failedToAdvanceWithinLane = false;

      if (task && hasNextStep) {
        const startedNextStep = await this.startNextAutomationStep(cardId, automation, task, nextStepIndex);
        if (startedNextStep) {
          automation.signaledSessionIds.add(eventSessionId);
          return;
        }
        failedToAdvanceWithinLane = true;
      }

      // Soft-gate fallback: try next step even when current GATE step failed
      if (task && !hasNextStep && canSoftGateAdvance && !shouldRecover) {
        console.warn(
          `[WorkflowOrchestrator] Soft-gate: GATE step ${getAutomationStepLabel(automation.steps[automation.currentStepIndex], automation.currentStepIndex)} failed for card ${cardId}. Advancing to next step as soft-gate.`,
        );
        if (task.lastSyncError) {
          task.lastSyncError = formatSyncError({
            type: "gate_soft_fail",
            message: `${getAutomationStepLabel(automation.steps[automation.currentStepIndex], automation.currentStepIndex)} failed but soft-gated to next step.`,
          });
        }
        const startedNextStep = await this.startNextAutomationStep(cardId, automation, task, nextStepIndex);
        if (startedNextStep) {
          automation.signaledSessionIds.add(eventSessionId);
          return;
        }
        failedToAdvanceWithinLane = true;
      }

      // Automatic fallback: on failure, try next fallback agent step instead of retrying
      const canFallback = !successEvent
        && automation.enableAutomaticFallback
        && nextStepIndex < automation.steps.length;
      if (task && canFallback) {
        const maxAttempts = task.maxFallbackAttempts ?? automation.steps.length;
        const fallbackAttemptCount = automation.currentStepIndex;
        if (fallbackAttemptCount < maxAttempts) {
          const startedFallback = await this.startNextAutomationStep(cardId, automation, task, nextStepIndex);
          if (startedFallback) {
            automation.signaledSessionIds.add(eventSessionId);
            return;
          }
        }
      }

      if (task && shouldRecover) {
        const recoveryReason = getRecoveryReason(event, completionSatisfied, maxTurnsHit);

        // Build structured recovery context from the failed session
        const previousSession = task.laneSessions?.find(
          (s) => s.sessionId === eventSessionId,
        );
        const recoveryContext: RecoverySessionContext | undefined = previousSession
          ? {
              previousSessionSummary: [
                `Step ${typeof previousSession.stepIndex === "number" ? previousSession.stepIndex + 1 : "?"} in ${previousSession.columnName ?? previousSession.columnId ?? "unknown lane"}`,
                previousSession.provider ? `provider: ${previousSession.provider}` : undefined,
                previousSession.role ? `role: ${previousSession.role}` : undefined,
              ].filter(Boolean).join(", "),
              failureDetail: (typeof event.data?.error === "string" ? event.data.error : undefined)
                ?? task.lastSyncError,
              previousDurationMs: previousSession.completedAt && previousSession.startedAt
                ? new Date(previousSession.completedAt).getTime() - new Date(previousSession.startedAt).getTime()
                : undefined,
            }
          : undefined;

        await this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId: eventSessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason: `Recovery reason: ${recoveryReason}.`,
          mode: automation.supervision.mode,
          maxTurnsHit,
          recoveryContext,
        });
        const recovered = await this.recoverAutomation(cardId, automation, task, recoveryReason);
        if (recovered) {
          return;
        }
      }

      automation.status = !failedToAdvanceWithinLane && successEvent && completionSatisfied ? "completed" : "failed";
      automation.signaledSessionIds.add(eventSessionId);

      // Unblock dependent tasks when this task successfully completes
      if (automation.status === "completed") {
        await this.unblockDependentTasks(cardId, automation);
      }

      // Schedule worktree cleanup for completed done-lane tasks
      if (automation.status === "completed" && automation.stage === "done") {
        this.scheduleWorktreeCleanup(cardId, automation);
        // Release task-level dev server port
        getTaskDevServerRegistry().releaseForTask(cardId);
      }

      // NOTE: Auto PR creation now happens BEFORE done-lane automation steps
      // (in handleColumnTransitionData), not as a post-automation event.
      // This ensures done-finalizer sees pullRequestUrl.

      // Save lane-session updates BEFORE autoAdvanceCard, which reloads the task
      // and emits a synchronous COLUMN_TRANSITION. Saving after would overwrite the
      // column change, triggerSessionId, and session state set by autoAdvanceCard
      // and the downstream session-creation chain.
      // Use fresh read + atomicUpdate to avoid TOCTOU race with concurrent writers.
      // Merge laneSessions: freshTask is the base, task's in-memory modifications
      // (session status updates from this handler) overlay on top.
      if (task) {
        const freshTask = await this.taskStore.get(cardId);
        if (freshTask) {
          const lastSyncError = (!failedToAdvanceWithinLane && successEvent && completionSatisfied)
            ? undefined
            : (freshTask.lastSyncError ?? this.buildFailureMessage(automation, event, completionSatisfied));
          const mergedSessions = mergeLaneSessions(freshTask.laneSessions ?? [], task.laneSessions ?? []);
          if (freshTask.version !== undefined && this.taskStore.atomicUpdate) {
            await this.taskStore.atomicUpdate(cardId, freshTask.version, {
              lastSyncError,
              laneSessions: mergedSessions,
            });
          } else {
            freshTask.lastSyncError = lastSyncError;
            freshTask.laneSessions = mergedSessions;
            await this.taskStore.save(freshTask);
          }
        }
      }

      // Auto-advance if configured and successful.
      if (!failedToAdvanceWithinLane && successEvent && completionSatisfied && automation.automation.autoAdvanceOnSuccess) {
        await this.autoAdvanceCard(cardId, automation);
      } else if (
        !failedToAdvanceWithinLane
        && successEvent
        && completionSatisfied
        && !automation.automation.autoAdvanceOnSuccess
        && automation.steps[automation.currentStepIndex]?.role === "GATE"
      ) {
        // Safety net: GATE specialist completed successfully but did not call move_card.
        // Auto-advance anyway to prevent the card from getting stuck.
        const specialistId = automation.steps[automation.currentStepIndex]?.specialistId ?? "unknown";
        console.warn(
          `[WorkflowOrchestrator] GATE specialist (${specialistId}) completed without moving card ${cardId}. ` +
          `Auto-advancing as safety net. Specialist should call move_card explicitly.`
        );
        await this.autoAdvanceCard(cardId, automation);
      }

      // Terminal-lane guard: when done-lane automation completes successfully but
      // the card has nowhere to advance (done is the last column), clear the
      // triggerSessionId and ensure the task stays in a stable state. Without this,
      // a stale triggerSessionId from a completed session combined with a non-COMPLETED
      // task status would cause the Lane Scanner to re-trigger endlessly.
      if (automation.status === "completed" && task && automation.stage === "done") {
        const freshTask = await this.taskStore.get(cardId);
        if (freshTask && freshTask.columnId === automation.columnId) {
          // Card is still in the done column — check if it's the last column
          const currentBoard = await this.kanbanBoardStore.get(automation.boardId);
          if (currentBoard) {
            const sortedCols = currentBoard.columns.slice().sort((a, b) => a.position - b.position);
            const doneCol = sortedCols.find((c) => c.id === automation.columnId);
            // Use stage check instead of position — done is not the last column
            // (blocked/archived come after it in position order).
            const isTerminalStage = doneCol?.stage === "done" || doneCol?.stage === "archived";
            if (isTerminalStage && freshTask.status !== "COMPLETED") {
              // Split parent guard: skip COMPLETED marking if child tasks are still pending.
              // The parent should only reach COMPLETED after advanceParentToReview fires
              // (when all children complete).
              const splitPlan = freshTask.splitPlan;
              if (splitPlan?.childTaskIds?.length) {
                let allChildrenDone = true;
                for (const childId of splitPlan.childTaskIds) {
                  const child = await this.taskStore.get(childId);
                  if (child && child.status !== "COMPLETED" && child.status !== "ARCHIVED") {
                    allChildrenDone = false;
                    break;
                  }
                }
                if (!allChildrenDone) {
                  console.log(
                    `[WorkflowOrchestrator] Card ${cardId} has ${splitPlan.childTaskIds.length} child tasks, ` +
                    `not all completed. Skipping COMPLETED marking.`,
                  );
                  // Clear triggerSessionId to prevent re-trigger loops, keep the [Split] marker
                  if (freshTask.version !== undefined && this.taskStore.atomicUpdate) {
                    await this.taskStore.atomicUpdate(cardId, freshTask.version, {
                      triggerSessionId: undefined,
                      lastSyncError: `[Split] Waiting for ${splitPlan.childTaskIds.length} child tasks to complete.`,
                    });
                  }
                  // Skip to next automation entry — do NOT mark COMPLETED
                  continue;
                }
              }

              console.log(
                `[WorkflowOrchestrator] Card ${cardId} completed done-lane (terminal column). ` +
                `Setting status to COMPLETED to prevent re-trigger loops.`,
              );
              // Use atomic update to prevent overwriting concurrent modifications
              if (freshTask.version !== undefined && this.taskStore.atomicUpdate) {
                const ok = await this.taskStore.atomicUpdate(cardId, freshTask.version, {
                  status: "COMPLETED" as import("../models/task").TaskStatus,
                  lastSyncError: undefined,
                });
                if (!ok) {
                  // Re-read and retry once — non-fatal if it fails again (watchdog will retry).
                  const retryTask = await this.taskStore.get(cardId);
                  if (retryTask && retryTask.version !== undefined && this.taskStore.atomicUpdate) {
                    const retryOk = await this.taskStore.atomicUpdate(cardId, retryTask.version, {
                      status: "COMPLETED" as import("../models/task").TaskStatus,
                      lastSyncError: undefined,
                    });
                    if (!retryOk) {
                      console.log(
                        `[WorkflowOrchestrator] Terminal guard retry failed for ${cardId}, ` +
                        `will retry on next scan.`,
                      );
                    }
                  }
                }
              } else {
                freshTask.status = "COMPLETED" as import("../models/task").TaskStatus;
                freshTask.lastSyncError = undefined;
                freshTask.updatedAt = new Date();
                await this.taskStore.save(freshTask);
              }
            }
          }
        }
      }

      // Done-lane failure diagnostic: when automation fails in the done lane,
      // record a diagnostic error instead of overwriting the task status.
      // This prevents the zombie-recovery loop (COMPLETED → IN_PROGRESS → fail → COMPLETED)
      // while still providing observability for the recovery tick.
      if (automation.status === "failed" && task && automation.stage === "done") {
        try {
          const freshTask = await this.taskStore.get(cardId);
          if (freshTask && freshTask.columnId === automation.columnId) {
            const hasRealPR = Boolean(freshTask.pullRequestUrl)
              && freshTask.pullRequestUrl !== "manual"
              && freshTask.pullRequestUrl !== "already-merged";
            const prMerged = Boolean(freshTask.pullRequestMergedAt);
            if (hasRealPR && !prMerged && !freshTask.lastSyncError) {
              freshTask.lastSyncError = buildDoneStuckError(`Done-lane automation failed. PR awaiting merge: ${freshTask.pullRequestUrl}`);
              freshTask.updatedAt = new Date();
              await this.taskStore.save(freshTask);
              console.log(
                `[WorkflowOrchestrator] Done-lane failure diagnostic set for ${cardId}: ` +
                `PR not merged (${freshTask.pullRequestUrl}). Recovery tick will handle.`,
              );
            }
          }
        } catch (diagErr) {
          console.warn(
            `[WorkflowOrchestrator] Failed to set done-lane failure diagnostic for ${cardId}:`,
            diagErr,
          );
        }
      }

      const completedAutomation = automation;
      this.pendingTimers.push(setTimeout(() => {
        if (this.activeAutomations.get(cardId) === completedAutomation) {
          this.activeAutomations.delete(cardId);
        }
      }, COMPLETED_AUTOMATION_CLEANUP_DELAY_MS));

      // ── Parent-child lifecycle: notify parent when a child task completes/fails ──
      if (task?.parentTaskId) {
        try {
          if (!this.worktreeStore) {
            console.warn("[WorkflowOrchestrator] worktreeStore not set — fan-in merge skipped");
          }
          await onChildTaskStatusChanged(task, {
            taskStore: this.taskStore,
            kanbanBoardStore: this.kanbanBoardStore,
            worktreeStore: this.worktreeStore!,
            eventBus: this.eventBus,
          });
        } catch (lifecycleErr) {
          console.error(
            `[WorkflowOrchestrator] Parent-child lifecycle error for card ${cardId}:`,
            lifecycleErr,
          );
        }
      }

      // Done-lane auto-merger failure: only spawn standalone conflict-resolver
      // when a merge conflict is explicitly detected. Other failures (timeout,
      // tool unavailability) are handled by DoneLaneRecovery tick's webhook_missed
      // path, which re-checks PR state before deciding the next action.
      if (automation.status === "failed" && task && automation.stage === "done"
          && this.triggerStandaloneConflictResolver) {
        const currentSpecialist = automation.steps[automation.currentStepIndex]?.specialistId;
        if (currentSpecialist === "kanban-auto-merger" && task.pullRequestUrl
            && task.pullRequestUrl !== "manual" && task.pullRequestUrl !== "already-merged"
            && !task.pullRequestMergedAt) {
          const hasConflict = task.lastSyncError?.toLowerCase().includes("conflict");
          if (hasConflict) {
            try {
              console.log(
                `[WorkflowOrchestrator] Auto-merger failed with conflicts for card ${cardId}. ` +
                `Spawning standalone conflict-resolver session.`,
              );
              const result = await this.triggerStandaloneConflictResolver({ cardId });
              if (result.sessionId) {
                console.log(
                  `[WorkflowOrchestrator] Standalone conflict-resolver session ${result.sessionId} started for card ${cardId}.`,
                );
              } else {
                console.warn(
                  `[WorkflowOrchestrator] Failed to start standalone conflict-resolver for card ${cardId}: ${result.error}`,
                );
              }
            } catch (triggerErr) {
              console.warn(
                `[WorkflowOrchestrator] Error triggering standalone conflict-resolver for ${cardId}:`,
                triggerErr instanceof Error ? triggerErr.message : triggerErr,
              );
            }
          } else {
            console.log(
              `[WorkflowOrchestrator] Auto-merger failed for card ${cardId} without explicit conflict. ` +
              `Delegating to DoneLaneRecovery tick for re-evaluation.`,
            );
            task.lastSyncError = `[done-lane-stuck] Auto-merger failed but no conflict detected. Will retry via recovery tick.`;
            task.updatedAt = new Date();
            await this.taskStore.save(task);
          }
        }
      }

      return;
    }
  }

  private async scanForInactiveSessions(): Promise<void> {
    // Memory guard: skip watchdog scan if heap memory is approaching the limit
    if (shouldSkipTickForMemory("WorkflowOrchestratorWatchdog")) {
      return;
    }

    const sessionStore = getHttpSessionStore();
    const now = Date.now();

    for (const automation of this.activeAutomations.values()) {
      if (automation.status !== "running" || !automation.sessionId) continue;

      const sessionId = automation.sessionId;
      if (automation.signaledSessionIds.has(sessionId)) continue;

      // ── Zombie detection: session no longer exists in HttpSessionStore ──
      // This catches the case where a session crashed or was evicted but
      // handleAgentCompletion never fired, leaving a stale "running" entry.
      const sessionRecord = sessionStore.getSession(sessionId);
      if (!sessionRecord) {
        const ageMs = now - automation.startedAt.getTime();
        if (ageMs >= cfg.orphanAgeMs) {
          console.warn(
            `[WorkflowOrchestrator] Zombie automation: card ${automation.cardId} ` +
            `session ${sessionId} gone from HttpSessionStore (${Math.round(ageMs / 60_000)}m old). Cleaning up.`,
          );
          automation.status = "failed";
          this.cleanupCardSession?.(automation.cardId);
          this.activeAutomations.delete(automation.cardId);
        }
        continue;
      }

      // ── Universal guards (apply to ALL running automations) ──────────────

      // Max automation duration guard — terminates any automation running
      // longer than MAX_AUTOMATION_DURATION_MS regardless of activity state
      // or supervision mode. This is a safety net against runaway sessions.
      const automationDurationMs = now - automation.startedAt.getTime();
      if (automationDurationMs >= MAX_AUTOMATION_DURATION_MS) {
        automation.signaledSessionIds.add(sessionId);
        const hours = Math.floor(MAX_AUTOMATION_DURATION_MS / 3_600_000);
        const reason = `Automation exceeded maximum duration of ${hours} hours.`;
        sessionStore.markSessionTimedOut(sessionId, reason);
        void this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason,
          mode: automation.supervision.mode,
        });
        this.eventBus.emit({
          type: AgentEventType.AGENT_FAILED,
          agentId: sessionId,
          workspaceId: automation.workspaceId,
          data: {
            sessionId,
            success: false,
            error: reason,
            watchdog: true,
          },
          timestamp: new Date(),
        });
        continue;
      }

      // ── Recovery-mode guards (dev-lane supervision only) ─────────────────

      if (!isRecoveryMode(automation.supervision.mode)) continue;

      const recoverySessionRecord = sessionStore.getSession(sessionId);
      if (recoverySessionRecord?.acpStatus === "error") {
        automation.signaledSessionIds.add(sessionId);
        void this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason: recoverySessionRecord.acpError ?? "ACP session entered error state.",
          mode: automation.supervision.mode,
        });
        this.eventBus.emit({
          type: AgentEventType.AGENT_FAILED,
          agentId: sessionId,
          workspaceId: automation.workspaceId,
          data: {
            sessionId,
            success: false,
            error: recoverySessionRecord.acpError ?? "ACP session entered error state.",
            watchdog: true,
          },
          timestamp: new Date(),
        });
        continue;
      }

      // Check execution lease expiration — terminates sessions whose lease has
      // lapsed even if they are still actively making tool calls.
      if (sessionRecord?.leaseExpiresAt && !isExecutionLeaseActive(sessionRecord.leaseExpiresAt)) {
        automation.signaledSessionIds.add(sessionId);
        const reason = `Execution lease expired at ${sessionRecord.leaseExpiresAt}.`;
        sessionStore.markSessionTimedOut(sessionId, reason);
        void this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason,
          mode: automation.supervision.mode,
        });
        this.eventBus.emit({
          type: AgentEventType.AGENT_FAILED,
          agentId: sessionId,
          workspaceId: automation.workspaceId,
          data: {
            sessionId,
            success: false,
            error: reason,
            watchdog: true,
          },
          timestamp: new Date(),
        });
        continue;
      }

      const activity = sessionStore.getSessionActivity(sessionId);
      const lastActivityAt = activity?.lastMeaningfulActivityAt
        ?? activity?.lastActivityAt
        ?? sessionRecord?.createdAt
        ?? automation.startedAt.toISOString();
      const lastActivityMs = Date.parse(lastActivityAt);
      if (!Number.isFinite(lastActivityMs)) continue;

      const idleMs = now - lastActivityMs;
      const thresholdMs = automation.supervision.inactivityTimeoutMinutes * 60_000;
      if (idleMs < thresholdMs) continue;

      sessionStore.markSessionTimedOut(
        sessionId,
        `No ACP activity for ${automation.supervision.inactivityTimeoutMinutes} minutes.`,
      );
      automation.signaledSessionIds.add(sessionId);
      void this.notifyKanbanAgent({
        workspaceId: automation.workspaceId,
        sessionId,
        cardId: automation.cardId,
        cardTitle: automation.cardTitle,
        boardId: automation.boardId,
        columnId: automation.columnId,
        reason: `No ACP activity for ${automation.supervision.inactivityTimeoutMinutes} minutes.`,
        mode: automation.supervision.mode,
      });
      this.eventBus.emit({
        type: AgentEventType.AGENT_TIMEOUT,
        agentId: sessionId,
        workspaceId: automation.workspaceId,
        data: {
          sessionId,
          success: false,
          error: `No ACP activity for ${automation.supervision.inactivityTimeoutMinutes} minutes.`,
          inactivityMs: idleMs,
          lastActivityAt,
          watchdog: true,
        },
        timestamp: new Date(),
      });
    }

    // ── Region: Stale Queued Automation Retry ─────────────────────────────────
    await this.scanStaleQueuedAutomations(now);

    // ── Region: Periodic Maintenance ──────────────────────────────────────────
    this.runPeriodicMaintenance();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Region: Watchdog — Stale Queued Automation Retry
  // ═══════════════════════════════════════════════════════════════════════════

  /** Detect stale "queued" automations that never got a session and retry with exponential backoff. */
  private async scanStaleQueuedAutomations(now: number): Promise<void> {
    // This can happen when createSession returned null or an async handler
    // failed silently (e.g. HMR restart during column transition processing).
    const STALE_MAX_RETRIES = cfg.staleMaxRetries;
    for (const [cardId, automation] of this.activeAutomations.entries()) {
      if (automation.status !== "queued") continue;
      const retryCount = automation.staleRetryCount ?? 0;
      // Exponential backoff: 60s → 120s → 240s → give up
      const staleThreshold = STALE_QUEUED_THRESHOLD_MS * Math.pow(2, retryCount);
      const queuedMs = now - automation.startedAt.getTime();
      if (queuedMs < staleThreshold) continue;

      // Circuit breaker: stop re-triggering cards that keep failing
      const failureCount = this.sessionFailureCounts.get(cardId) ?? 0;
      if (failureCount >= SESSION_RETRY_LIMIT) {
        console.warn(
          `[WorkflowOrchestrator] Stale queued automation for card ${cardId} ` +
          `in column ${automation.columnId} skipped: circuit breaker (${failureCount}/${SESSION_RETRY_LIMIT}).`,
        );
        automation.status = "failed";
        this.cleanupCardSession?.(cardId);
        this.activeAutomations.delete(cardId);
        continue;
      }

      console.warn(
        `[WorkflowOrchestrator] Stale queued automation for card ${cardId} ` +
        `in column ${automation.columnId} (${queuedMs}ms old, stale retry ${retryCount + 1}/${STALE_MAX_RETRIES}). Retrying.`,
      );

      // Check stale retry limit (separate from session circuit breaker)
      if (retryCount >= STALE_MAX_RETRIES) {
        console.warn(
          `[WorkflowOrchestrator] Stale retry limit reached for card ${cardId} ` +
          `in column ${automation.columnId}. Marking as review-degraded.`,
        );
        automation.status = "failed";
        this.cleanupCardSession?.(cardId);
        this.activeAutomations.delete(cardId);

        // Degradation: mark task so DoneLaneRecovery can advance it
        const degradedTask = await this.taskStore.get(cardId);
        if (degradedTask) {
          degradedTask.lastSyncError =
            `[review-degraded] Stale retry limit (${STALE_MAX_RETRIES}) reached in column "${automation.columnName || automation.columnId}". ` +
            `Auto-passed at ${new Date().toISOString()}.`;
          degradedTask.updatedAt = new Date();
          await this.taskStore.save(degradedTask);

          // Emit transition to trigger advancement via DoneLaneRecovery
          this.eventBus.emit({
            type: AgentEventType.COLUMN_TRANSITION,
            agentId: "kanban-workflow-orchestrator-degradation",
            workspaceId: automation.workspaceId,
            data: {
              cardId,
              cardTitle: automation.cardTitle,
              boardId: automation.boardId,
              workspaceId: automation.workspaceId,
              fromColumnId: automation.columnId,
              toColumnId: automation.columnId,
              fromColumnName: automation.columnName ?? "",
              toColumnName: automation.columnName ?? "",
              source: { type: "review_degraded" },
            } as unknown as Record<string, unknown>,
            timestamp: new Date(),
          });
        }
        continue;
      }
      automation.status = "failed";
      this.cleanupCardSession?.(cardId);
      this.activeAutomations.delete(cardId);

      // Re-trigger via processColumnTransition to let restart-recovery logic
      // pick it up on the next scan.
      const task = await this.taskStore.get(cardId);
      if (task?.columnId && task.boardId) {
        this.eventBus.emit({
          type: AgentEventType.COLUMN_TRANSITION,
          agentId: "kanban-workflow-orchestrator-watchdog",
          workspaceId: automation.workspaceId,
          data: {
            cardId,
            cardTitle: automation.cardTitle,
            boardId: automation.boardId,
            workspaceId: automation.workspaceId,
            fromColumnId: "__watchdog_retry__",
            toColumnId: task.columnId,
            fromColumnName: "Watchdog",
            toColumnName: automation.columnName,
            staleRetryCount: retryCount + 1,
            source: { type: "watchdog_retry", staleRetryCount: retryCount + 1 },
          } as unknown as Record<string, unknown>,
          timestamp: new Date(),
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Region: Periodic Maintenance (stale trigger scan + dev server health)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Run periodic maintenance tasks: stale-trigger scan and dev server health checks. */
  private runPeriodicMaintenance(): void {
    // Stale-trigger scan: run every 10th cycle (~5 minutes) to catch
    // triggerSessionIds pointing to evicted sessions (e.g. after restart).
    this.staleTriggerScanCycle++;
    if (this.staleTriggerScanner && this.staleTriggerScanCycle >= 10) {
      this.staleTriggerScanCycle = 0;
      void this.staleTriggerScanner()
        .then((cleaned) => {
          if (cleaned > 0) {
            console.log(`[WorkflowOrchestrator] Stale-trigger scan cleaned ${cleaned} tasks`);
          }
        })
        .catch((err) => {
          console.error("[WorkflowOrchestrator] Stale-trigger scan failed:", err instanceof Error ? err.message : err);
        });
    }

    // Task dev server health check: release ports that fail 3 consecutive
    // health checks or exceed the 4-hour max age.
    const registry = getTaskDevServerRegistry();
    for (const taskId of registry.getActiveTaskIds()) {
      void registry.isHealthy(taskId).then(() => {
        if (registry.shouldRelease(taskId)) {
          const record = registry.getForTask(taskId);
          console.log(
            `[WorkflowOrchestrator] Releasing task dev server for ${taskId}: ` +
            `port ${record?.port}, failures=${record?.healthCheckFailures ?? 0}`,
          );
          registry.releaseForTask(taskId);
        }
      });
    }
  }

  /**
   * When a task completes, scan for dependent tasks that may now be unblocked
   * and re-trigger their automation.
   */
  private async unblockDependentTasks(
    completedCardId: string,
    automation: ActiveAutomation,
  ): Promise<void> {
    const board = await this.kanbanBoardStore.get(automation.boardId);
    if (!board) return;

    const allTasks = await this.taskStore.listByWorkspace(automation.workspaceId);
    const newlyUnblocked: string[] = [];

    for (const t of allTasks) {
      if (!t.dependencies.includes(completedCardId)) continue;

      const depCheck = await checkDependencyGate(t, board.columns, this.taskStore);
      if (!depCheck.blocked && getErrorType(t.lastSyncError) === "dependency_blocked") {
        const fields = dependencyUnblockFields();
        await safeAtomicSave(t, this.taskStore, fields, "WorkflowOrchestrator dependency-unblock");
        newlyUnblocked.push(t.id);

        this.eventBus.emit({
          type: AgentEventType.COLUMN_TRANSITION,
          agentId: "kanban-workflow-orchestrator",
          workspaceId: automation.workspaceId,
          data: {
            cardId: t.id,
            cardTitle: t.title,
            boardId: automation.boardId,
            workspaceId: automation.workspaceId,
            fromColumnId: t.columnId ?? "",
            toColumnId: t.columnId ?? "",
            fromColumnName: "",
            toColumnName: "",
            source: { type: "dependency_unblock" },
          },
          timestamp: new Date(),
        });
      } else if (!depCheck.blocked && !getErrorType(t.lastSyncError)) {
        // Dependencies satisfied but task never entered automation (no error marker).
        // Emit COLUMN_TRANSITION to trigger automation for idle Backlog tasks.
        newlyUnblocked.push(t.id);

        this.eventBus.emit({
          type: AgentEventType.COLUMN_TRANSITION,
          agentId: "kanban-workflow-orchestrator",
          workspaceId: automation.workspaceId,
          data: {
            cardId: t.id,
            cardTitle: t.title,
            boardId: automation.boardId,
            workspaceId: automation.workspaceId,
            fromColumnId: t.columnId ?? "",
            toColumnId: t.columnId ?? "",
            fromColumnName: "",
            toColumnName: "",
            source: { type: "dependency_unblock" },
          },
          timestamp: new Date(),
        });
      }
    }

    if (newlyUnblocked.length > 0) {
      console.log(
        `[WorkflowOrchestrator] Unblocked ${newlyUnblocked.length} dependent task(s) after ${completedCardId} completed.`,
      );
    }
  }

  private async isCompletionSatisfied(
    task: Task | undefined,
    automation: ActiveAutomation,
    successEvent: boolean,
  ): Promise<boolean> {
    if (!successEvent) {
      return false;
    }
    if (automation.supervision.mode !== "ralph_loop") {
      return true;
    }

    switch (automation.supervision.completionRequirement) {
      case "completion_summary":
        return Boolean(task?.completionSummary?.trim());
      case "verification_report":
        return Boolean(task?.verificationReport?.trim());
      case "turn_complete":
      default:
        return true;
    }
  }

  private async shouldRecover(
    task: Task,
    automation: ActiveAutomation,
    event: AgentEvent,
    completionSatisfied: boolean,
    maxTurnsHit = false,
  ): Promise<boolean> {
    if (!isRecoveryMode(automation.supervision.mode)) {
      return false;
    }
    if (task.columnId !== automation.columnId) {
      return false;
    }
    if (automation.recoveryAttempts >= automation.supervision.maxRecoveryAttempts) {
      return false;
    }

    if (event.type === AgentEventType.AGENT_TIMEOUT || event.type === AgentEventType.AGENT_FAILED) {
      return true;
    }
    if (maxTurnsHit) {
      return true;
    }
    if (automation.supervision.mode === "ralph_loop" && event.type === AgentEventType.AGENT_COMPLETED) {
      return !completionSatisfied;
    }
    return false;
  }

  private async startNextAutomationStep(
    cardId: string,
    automation: ActiveAutomation,
    task: Task,
    nextStepIndex: number,
  ): Promise<boolean> {
    if (!this.createSession) {
      return false;
    }

    const nextStep = automation.steps[nextStepIndex];
    if (!nextStep) {
      return false;
    }

    const previousSessionId = automation.sessionId;
    if (previousSessionId) {
      if (!task.sessionIds.includes(previousSessionId)) {
        task.sessionIds.push(previousSessionId);
      }
      if (task.triggerSessionId === previousSessionId) {
        task.triggerSessionId = undefined;
      }
    }

    task.lastSyncError = undefined;
    task.updatedAt = new Date();
    await this.taskStore.save(task);

    this.cleanupCardSession?.(cardId);

    automation.currentStepIndex = nextStepIndex;
    automation.attempt = 1;
    automation.recoveryAttempts = 0;
    automation.status = "queued";
    automation.startedAt = new Date();
    automation.sessionId = undefined;
    automation.signaledSessionIds.clear();

    try {
      const rawResult = await this.createSession({
        workspaceId: automation.workspaceId,
        cardId,
        cardTitle: automation.cardTitle,
        columnId: automation.columnId,
        columnName: automation.columnName,
        automation: automation.automation,
        step: nextStep,
        stepIndex: nextStepIndex,
        supervision: this.buildSupervisionContext(automation, task.objective || automation.cardTitle),
      });
      const sessionId = typeof rawResult === "object" && rawResult !== null
        ? rawResult.sessionId
        : rawResult;

      if (!sessionId) {
        automation.status = "failed";
        return false;
      }

      automation.status = "running";
      automation.sessionId = sessionId;
      return true;
    } catch (error) {
      automation.status = "failed";
      task.lastSyncError = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date();
      await this.taskStore.save(task);
      return false;
    }
  }

  private async recoverAutomation(
    cardId: string,
    automation: ActiveAutomation,
    task: Task,
    reason: TaskLaneSessionRecoveryReason,
  ): Promise<boolean> {
    if (!this.createSession || !isRecoveryMode(automation.supervision.mode)) {
      return false;
    }

    const previousSessionId = automation.sessionId;
    automation.recoveryAttempts += 1;
    automation.attempt += 1;
    automation.status = "queued";
    automation.startedAt = new Date();
    automation.sessionId = undefined;

    if (previousSessionId) {
      automation.signaledSessionIds.delete(previousSessionId);
      if (!task.sessionIds.includes(previousSessionId)) {
        task.sessionIds.push(previousSessionId);
      }
      if (task.triggerSessionId === previousSessionId) {
        task.triggerSessionId = undefined;
      }
    }

    task.lastSyncError = this.buildRecoveryMessage(automation, reason);
    task.updatedAt = new Date();
    await this.taskStore.save(task);

    this.cleanupCardSession?.(cardId);

    try {
      const currentStep = automation.steps[automation.currentStepIndex];
      const rawResult = await this.createSession({
        workspaceId: automation.workspaceId,
        cardId,
        cardTitle: automation.cardTitle,
        columnId: automation.columnId,
        columnName: automation.columnName,
        automation: automation.automation,
        step: currentStep,
        stepIndex: automation.currentStepIndex,
        supervision: this.buildSupervisionContext(automation, task.objective || automation.cardTitle, {
          recoveredFromSessionId: previousSessionId,
          recoveryReason: reason,
        }),
      });
      const sessionId = typeof rawResult === "object" && rawResult !== null
        ? rawResult.sessionId
        : rawResult;

      if (!sessionId) {
        automation.status = "failed";
        return false;
      }

      automation.status = "running";
      automation.sessionId = sessionId;
      return true;
    } catch (error) {
      automation.status = "failed";
      task.lastSyncError = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date();
      await this.taskStore.save(task);
      return false;
    }
  }

  private buildSupervisionContext(
    automation: ActiveAutomation,
    objective: string,
    recovery?: {
      recoveredFromSessionId?: string;
      recoveryReason?: TaskLaneSessionRecoveryReason;
    },
  ): AutomationSessionSupervisionContext | undefined {
    if (!isRecoveryMode(automation.supervision.mode)) {
      return undefined;
    }
    return {
      attempt: automation.attempt,
      mode: automation.supervision.mode,
      completionRequirement: automation.supervision.completionRequirement,
      objective,
      recoveredFromSessionId: recovery?.recoveredFromSessionId,
      recoveryReason: recovery?.recoveryReason,
    };
  }

  private buildRecoveryMessage(
    automation: ActiveAutomation,
    reason: TaskLaneSessionRecoveryReason,
  ): string {
    const stepLabel = getAutomationStepLabel(automation.steps[automation.currentStepIndex], automation.currentStepIndex);
    const reasonLabel = reason === "watchdog_inactivity"
      ? "inactive too long"
      : reason === "completion_criteria_not_met"
        ? "stopped before completion criteria were met"
        : "failed";
    return `${stepLabel} recovered after session ${reasonLabel}. Attempt ${automation.attempt}/${automation.supervision.maxRecoveryAttempts + 1}.`;
  }

  private buildFailureMessage(
    automation: ActiveAutomation,
    event: AgentEvent,
    completionSatisfied: boolean,
  ): string {
    const stepLabel = getAutomationStepLabel(automation.steps[automation.currentStepIndex], automation.currentStepIndex);
    if (event.type === AgentEventType.AGENT_TIMEOUT) {
      return `${stepLabel} timed out after ${automation.supervision.inactivityTimeoutMinutes} minutes without activity.`;
    }
    if (event.type === AgentEventType.AGENT_FAILED) {
      const error = typeof event.data?.error === "string" ? event.data.error : "ACP session failed.";
      return error;
    }
    if (event.type === AgentEventType.AGENT_COMPLETED && !completionSatisfied) {
      return `${stepLabel} completed but did not satisfy ${automation.supervision.completionRequirement}.`;
    }
    return "ACP session did not complete successfully.";
  }

  private async notifyKanbanAgent(params: RecoveryNotificationParams): Promise<void> {
    if (!this.sendKanbanSessionPrompt) {
      return;
    }
    const sessionStore = getHttpSessionStore();
    const sessionRecord = sessionStore.getSession(params.sessionId);
    if (!sessionRecord) {
      console.warn(
        `[WorkflowOrchestrator] ACP session ${params.sessionId} not found in local session store; skipping recovery prompt.`,
      );
      return;
    }
    if (sessionRecord.acpStatus === "error") {
      console.warn(
        `[WorkflowOrchestrator] ACP session ${params.sessionId} is already in error state; skipping recovery prompt.`,
      );
      return;
    }

    try {
      await this.sendKanbanSessionPrompt({
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        prompt: buildKanbanRecoveryPrompt(params),
      });
    } catch (error) {
      console.error(
        `[WorkflowOrchestrator] Failed to notify agent session ${params.sessionId}:`,
        error,
      );
    }
  }

  private static readonly WORKTREE_CLEANUP_DELAY_MS = cfg.worktreeCleanupDelayMs;

  /**
   * Schedule delayed worktree cleanup for a completed task.
   * Only cleans up if the PR has been merged (pullRequestMergedAt is set) and the
   * task is still in the done column.
   */
  private scheduleWorktreeCleanup(
    cardId: string,
    automation: ActiveAutomation,
  ): void {
    this.pendingTimers.push(setTimeout(async () => {
      try {
        const task = await this.taskStore.get(cardId);
        if (!task?.worktreeId) return;

        if (!task.pullRequestMergedAt) {
          console.log(
            `[WorkflowOrchestrator] Skipping worktree cleanup for ${cardId}: PR not yet merged.`,
          );
          return;
        }

        const board = await this.kanbanBoardStore.get(automation.boardId);
        if (!board) return;
        const doneColumnIds = new Set(
          board.columns
            .filter((col) => col.stage === "done")
            .map((col) => col.id),
        );
        if (!doneColumnIds.has(task.columnId ?? "")) return;

        this.eventBus.emit({
          type: AgentEventType.WORKTREE_CLEANUP,
          agentId: "kanban-workflow-orchestrator",
          workspaceId: automation.workspaceId,
          data: {
            worktreeId: task.worktreeId,
            taskId: cardId,
            boardId: automation.boardId,
            deleteBranch: true,
          },
          timestamp: new Date(),
        });

        console.log(
          `[WorkflowOrchestrator] Scheduled worktree cleanup for task ${cardId}, worktree ${task.worktreeId}.`,
        );
      } catch (err) {
        console.error(
          `[WorkflowOrchestrator] Worktree cleanup scheduling failed for ${cardId}:`,
          err,
        );
      }
    }, KanbanWorkflowOrchestrator.WORKTREE_CLEANUP_DELAY_MS));
  }

  private async autoAdvanceCard(
    cardId: string,
    automation: ActiveAutomation,
  ): Promise<void> {
    try {
      const board = await this.kanbanBoardStore.get(automation.boardId);
      if (!board) return;

      // Check if the card was already moved by the specialist (via move_card tool).
      const task = await this.taskStore.get(cardId);
      if (!task) return;

      if (task.columnId !== automation.columnId) {
        return;
      }

      const currentColumn = board.columns.find((column) => column.id === automation.columnId);
      if (!currentColumn) return;

      const sortedColumns = board.columns
        .slice()
        .sort((left, right) => left.position - right.position);
      const currentIndex = sortedColumns.findIndex((column) => column.id === currentColumn.id);
      const nextColumn = sortedColumns[currentIndex + 1];
      if (!nextColumn) return;

      // Terminal stage guard: done/archived are end-of-flow columns.
      // Cards should never auto-advance from done into blocked/archived.
      const effectiveStage = currentColumn.stage ?? inferStageFromColumnId(currentColumn.id);
      if (effectiveStage === "done" || effectiveStage === "archived") {
        console.log(
          `[WorkflowOrchestrator] Skipping auto-advance for card ${cardId}: ` +
          `${effectiveStage} is a terminal stage.`,
        );
        return;
      }

      const nextStatus = resolveTaskStatusForBoardColumn(board.columns, nextColumn.id);

      // Use atomic update to prevent TOCTOU race — concurrent move_card or
      // autoAdvanceCard calls will conflict on version instead of overwriting.
      if (task.version !== undefined && this.taskStore.atomicUpdate) {
        const ok = await this.taskStore.atomicUpdate(cardId, task.version, {
          columnId: nextColumn.id,
          status: nextStatus,
          triggerSessionId: undefined,
        });
        if (!ok) {
          // Re-read and retry once — the card may still be in the source column
          // due to a concurrent write (e.g. laneSessions merge from handleAgentCompletion).
          // Brief delay to reduce contention with concurrent clearStaleTriggerSession.
          await new Promise((r) => setTimeout(r, 150));
          const fresh = await this.taskStore.get(cardId);
          if (fresh && fresh.columnId === automation.columnId && fresh.version !== undefined) {
            const retryOk = await this.taskStore.atomicUpdate(cardId, fresh.version, {
              columnId: nextColumn.id,
              status: nextStatus,
              triggerSessionId: undefined,
            });
            if (retryOk) {
              console.log(
                `[WorkflowOrchestrator] autoAdvanceCard retry succeeded for ${cardId}.`,
              );
              // Fall through to emit COLUMN_TRANSITION below.
            } else {
              console.warn(
                `[WorkflowOrchestrator] autoAdvanceCard retry failed for ${cardId}, ` +
                `will retry on next watchdog/lane-scanner tick.`,
              );
              return;
            }
          } else {
            console.warn(
              `[WorkflowOrchestrator] autoAdvanceCard version conflict for ${cardId}: ` +
              `card already moved (now in ${fresh?.columnId}). Skipping.`,
            );
            return;
          }
        }
      } else {
        // Fallback for stores without atomicUpdate
        task.columnId = nextColumn.id;
        task.status = nextStatus;
        if (task.triggerSessionId) {
          if (!task.sessionIds) task.sessionIds = [];
          if (!task.sessionIds.includes(task.triggerSessionId)) {
            task.sessionIds.push(task.triggerSessionId);
          }
        }
        task.triggerSessionId = undefined;
        task.updatedAt = new Date();
        await this.taskStore.save(task);
      }

      this.cleanupCardSession?.(cardId);

      this.eventBus.emit({
        type: AgentEventType.COLUMN_TRANSITION,
        agentId: "kanban-workflow-orchestrator",
        workspaceId: automation.workspaceId,
        data: {
          cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          workspaceId: automation.workspaceId,
          fromColumnId: automation.columnId,
          toColumnId: nextColumn.id,
          fromColumnName: currentColumn.name,
          toColumnName: nextColumn.name,
          source: { type: "auto_advance", fromColumnId: automation.columnId },
        },
        timestamp: new Date(),
      });
    } catch (err) {
      console.error("[WorkflowOrchestrator] Auto-advance failed:", err);
    }
  }

}
