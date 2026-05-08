/**
 * Workflow Orchestrator Singleton
 *
 * Provides a global instance of the KanbanWorkflowOrchestrator.
 * Initialized when the RoutaSystem is created.
 */

import {
  KanbanWorkflowOrchestrator,
  type AutomationSessionSupervisionContext,
  parseCbResetCount,
} from "./workflow-orchestrator";
import { buildCircuitBreakerError, buildRateLimitedError, isCircuitBreaker } from "./sync-error-writer";
import { getKanbanConfig } from "./kanban-config";
import type { RoutaSystem } from "../routa-system";
import type {
  KanbanAutomationStep,
  KanbanColumnAutomation,
  KanbanColumnStage,
} from "../models/kanban";

import {
  resolveKanbanAutomationStep,
  resolveEffectiveTaskAutomation,
  type AutomationSpecialistSummary,
} from "./effective-task-automation";
import { ensureTaskWorktree } from "./ensure-task-worktree";
import { fetchRemote } from "../git/git-utils";
import { getInternalApiOrigin, triggerAssignedTaskAgent } from "./agent-trigger";
import { KanbanSessionQueue } from "./kanban-session-queue";
import { getKanbanSessionConcurrencyLimit as getBoardSessionConcurrencyLimit } from "./board-session-limits";
import { getKanbanDevSessionSupervision } from "./board-session-supervision";
import { getKanbanAutoProvider } from "./board-auto-provider";
import { getKanbanBranchRules } from "./board-branch-rules";
import { upsertTaskLaneSession } from "./task-lane-history";
import { completeRunningSessionsOutsideColumn } from "./task-session-transition";
import { analyzeFlowForTasks } from "./flow-ledger";
import { resolveTaskWorktreeTruth } from "./task-worktree-truth";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getSpecialistById } from "../orchestration/specialist-prompts";
import { dispatchSessionPrompt } from "@/core/acp/session-prompt";
import type { ColumnTransitionData } from "./column-transition";
import { isTriggerSessionStale, clearStaleTriggerSession } from "./task-trigger-session";
import { startWorktreeCleanupListener } from "./worktree-cleanup";
import { startPrMergeListener } from "./pr-merge-listener";
import { notifyBacklogChange, startGraphRefinerTrigger, stopGraphRefinerTrigger } from "./graph-refiner-trigger";
import { startPrAutoCreateListener, executeAutoPrCreation } from "./pr-auto-create";
import { checkDependencyGate } from "./dependency-gate";
import { getTaskDevServerRegistry } from "./task-dev-server-registry";
import {
  buildTaskEvidenceSummary,
  buildTaskInvestValidation,
  buildTaskStoryReadiness,
} from "./task-derived-summary";

// Use globalThis to survive HMR in Next.js dev mode
const GLOBAL_KEY = "__routa_workflow_orchestrator__";
const VERSION_KEY = "__routa_workflow_orchestrator_version__";
const STARTED_KEY = "__routa_workflow_orchestrator_started__";
const QUEUE_KEY = "__routa_kanban_session_queue__";

// Increment when class methods change to force singleton recreation on HMR
const ORCHESTRATOR_VERSION = 2;

const FAILURES_KEY = "__routa_session_failure_counts__";
const singletonCfg = getKanbanConfig();
const SESSION_RETRY_LIMIT = singletonCfg.sessionRetryLimit;
const SESSION_RETRY_RESET_MS = singletonCfg.sessionRetryResetMs;

interface FailureRecord {
  count: number;
  lastFailureAt: number;
}

function getSessionFailures(): Map<string, FailureRecord> {
  const g = globalThis as Record<string, unknown>;
  if (!g[FAILURES_KEY]) g[FAILURES_KEY] = new Map<string, FailureRecord>();
  return g[FAILURES_KEY] as Map<string, FailureRecord>;
}

// Errors caused by transient API rate limits — should NOT consume circuit-breaker quota.
const RATE_LIMIT_INDICATORS = ["429", "rate limit", "速率限制"];

function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RATE_LIMIT_INDICATORS.some(ind => lower.includes(ind));
}

// Failures that are structural/data issues — not session creation failures.
const SKIP_CIRCUIT_BREAKER_PATTERNS = [
  "missing board",
  "task moved",
  "no longer in column",
  "blocked by",
  "already active",
  "task no longer exists",
];

function shouldSkipCircuitBreaker(error: string | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return SKIP_CIRCUIT_BREAKER_PATTERNS.some(p => lower.includes(p));
}

function resolveKanbanSpecialist(
  specialistId: string,
  locale?: string,
): AutomationSpecialistSummary | undefined {
  const specialist = (locale ? getSpecialistById(specialistId, locale) : undefined)
    ?? getSpecialistById(specialistId);
  if (!specialist) return undefined;
  return {
    name: specialist.name,
    role: specialist.role,
    defaultProvider: specialist.defaultProvider,
  };
}

async function createAutomationSession(
  system: RoutaSystem,
  params: {
    workspaceId: string;
    cardTitle: string;
    columnName: string;
    cardId: string;
    columnId: string;
    automation: KanbanColumnAutomation;
    step: KanbanAutomationStep;
    stepIndex: number;
    supervision?: AutomationSessionSupervisionContext;
  },
): Promise<string | import("./workflow-orchestrator").CreateAutomationSessionResult | null> {
  // Circuit breaker with TTL: skip cards that exceeded consecutive session
  // creation failures, but auto-reset after SESSION_RETRY_RESET_MS cooldown.
  const failures = getSessionFailures();
  const record = failures.get(params.cardId);
  const now = Date.now();

  if (record) {
    const isCooldownExpired = (now - record.lastFailureAt) >= SESSION_RETRY_RESET_MS;
    if (isCooldownExpired) {
      failures.delete(params.cardId);
    } else if (record.count >= SESSION_RETRY_LIMIT) {
      console.warn(
        `[createAutomationSession] Circuit breaker: skipping card ${params.cardId} ` +
        `(${record.count}/${SESSION_RETRY_LIMIT} consecutive failures). ` +
        `Resets at ${new Date(record.lastFailureAt + SESSION_RETRY_RESET_MS).toISOString()}.`,
      );
      return null;
    }
  }

  const task = await system.taskStore.get(params.cardId);
  if (!task?.boardId) {
    console.warn(
      `[createAutomationSession] No task or missing boardId for card ${params.cardId}. ` +
      `task=${task ? "exists" : "null"}, boardId=${task?.boardId ?? "undefined"}`,
    );
    return null;
  }
  const result = await enqueueKanbanTaskSession(system, {
    task,
    expectedColumnId: params.columnId,
    step: params.step,
    stepIndex: params.stepIndex,
    supervision: params.supervision,
  });

  if (result.sessionId) {
    failures.delete(params.cardId);
    // Clear circuit breaker marker on success
    if (task.lastSyncError && isCircuitBreaker(task.lastSyncError)) {
      task.lastSyncError = undefined;
      task.updatedAt = new Date();
      await system.taskStore.save(task);
    }
  } else {
    // Rate-limit errors are transient — don't consume circuit-breaker quota.
    if (isRateLimitError(result.error ?? "")) {
      console.warn(
        `[createAutomationSession] Rate-limited for card ${params.cardId}, not counting towards circuit breaker.`,
      );
      if (task) {
        task.lastSyncError = buildRateLimitedError(result.error ?? "Rate limited");
        task.updatedAt = new Date();
        await system.taskStore.save(task);
      }
      return null;
    }

    // Structural/data issues should not count either.
    if (shouldSkipCircuitBreaker(result.error)) {
      console.warn(
        `[createAutomationSession] Structural skip for card ${params.cardId}: ${result.error}`,
      );
      return null;
    }

    // Queued jobs are pending, not failed — don't consume circuit-breaker quota.
    if (result.queued) {
      console.log(
        `[createAutomationSession] Session queued for card ${params.cardId}. Not counting as failure.`,
      );
      return { sessionId: null, queued: true };
    }

    const prevCount = failures.get(params.cardId)?.count ?? 0;
    console.warn(
      `[createAutomationSession] Session creation failed for card ${params.cardId} ` +
      `(column: ${params.columnName ?? params.columnId}): ${result.error ?? "unknown error"}`,
    );
    const newCount = prevCount + 1;
    failures.set(params.cardId, { count: newCount, lastFailureAt: now });
    // Write circuit breaker marker to task when limit exceeded
    if (newCount >= SESSION_RETRY_LIMIT && task) {
      const prevResets = parseCbResetCount(task.lastSyncError);
      task.lastSyncError = buildCircuitBreakerError(prevResets, `Session creation failed ${newCount} times. Retry after cooldown.`);
      task.updatedAt = new Date();
      await system.taskStore.save(task);
    }
  }
  return result.sessionId ?? null;
}

export async function enqueueKanbanTaskSession(
  system: RoutaSystem,
  params: {
    task: Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>;
    expectedColumnId?: string;
    ignoreExistingTrigger?: boolean;
    bypassQueue?: boolean;
    bypassDependencyGate?: boolean;
    mutateTask?: (task: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>) => void;
    providerOverride?: string;
    step?: KanbanAutomationStep;
    stepIndex?: number;
    supervision?: AutomationSessionSupervisionContext;
  },
): Promise<{ sessionId?: string; queued: boolean; error?: string }> {
  const task = params.task;
  if (!task?.boardId) {
    return { queued: false, error: "Task is missing board context." };
  }

  if (task.triggerSessionId && !params.ignoreExistingTrigger) {
    const staleId = isTriggerSessionStale(task.triggerSessionId, getHttpSessionStore());
    if (!staleId) {
      return { sessionId: task.triggerSessionId, queued: false };
    }
    task.triggerSessionId = undefined;
  }

  // Dependency gate: block enqueue if dependencies are unsatisfied
  if (!params.bypassDependencyGate && task.dependencies.length > 0 && task.boardId) {
    const board = await system.kanbanBoardStore.get(task.boardId);
    if (board) {
      const depCheck = await checkDependencyGate(task, board.columns, system.taskStore);
      if (depCheck.blocked) {
        return {
          queued: false,
          error: `Blocked by unfinished dependencies: ${depCheck.pendingDependencies.join(", ")}`,
        };
      }
    }
  }

  if (params.bypassQueue) {
    const result = await startKanbanTaskSession(system, task.id, params);
    return {
      sessionId: result.sessionId ?? undefined,
      queued: false,
      error: result.error,
    };
  }

  const queue = getKanbanSessionQueue(system);
  return queue.enqueue({
    cardId: task.id,
    cardTitle: task.title,
    boardId: task.boardId,
    workspaceId: task.workspaceId,
    columnId: params.expectedColumnId ?? task.columnId,
    start: async () => startKanbanTaskSession(system, task.id, params),
  });
}

async function startKanbanTaskSession(
  system: RoutaSystem,
  taskId: string,
  params: {
    expectedColumnId?: string;
    ignoreExistingTrigger?: boolean;
    mutateTask?: (task: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>) => void;
    providerOverride?: string;
    step?: KanbanAutomationStep;
    stepIndex?: number;
    supervision?: AutomationSessionSupervisionContext;
  },
): Promise<{ sessionId?: string | null; error?: string }> {
  const task = await system.taskStore.get(taskId);
  if (!task) return { error: "Task no longer exists." };

  // Sync source repos when task starts actual execution (not just queue enqueue).
  // This ensures agents analyze code based on the latest remote state.
  if (task.codebaseIds?.length) {
    let codebases: Awaited<ReturnType<typeof system.codebaseStore.listByWorkspace>>;
    try {
      codebases = await system.codebaseStore.listByWorkspace(task.workspaceId);
    } catch {
      // Store failure should not block automation
      codebases = [];
    }
    for (const cb of codebases) {
      if (cb.repoPath) fetchRemote(cb.repoPath);
    }
  }
  if (params.expectedColumnId && task.columnId !== params.expectedColumnId) {
    return { error: `Task is no longer in column ${params.expectedColumnId} (now in ${task.columnId}).` };
  }
  if (task.triggerSessionId && !params.ignoreExistingTrigger) {
    const cleaned = await clearStaleTriggerSession(task, getHttpSessionStore(), system.taskStore);
    if (!cleaned) {
      return { sessionId: task.triggerSessionId };
    }
  }

  const nextTask = {
    ...task,
    updatedAt: new Date(),
  };
  params.mutateTask?.(nextTask);
  const board = await system.kanbanBoardStore.get(nextTask.boardId!);
  const workspace = await system.workspaceStore.get(nextTask.workspaceId);
  const autoProviderId = getKanbanAutoProvider(workspace?.metadata, nextTask.boardId!);
  const branchRules = getKanbanBranchRules(workspace?.metadata, nextTask.boardId!);

  const initialWorktreeTruth = await resolveTaskWorktreeTruth(nextTask, system);
  if (nextTask.worktreeId && initialWorktreeTruth?.source !== "task.worktreeId") {
    nextTask.worktreeId = undefined;
  }
  const preferredCodebase = initialWorktreeTruth?.codebase;
  let worktreeCwd = initialWorktreeTruth?.cwd ?? process.cwd();
  let worktreeBranch = initialWorktreeTruth?.branch;
  let baseBranch = initialWorktreeTruth?.baseBranch ?? preferredCodebase?.branch;
  // Verify the base branch actually exists on remote; fall back through
  // codebase.branch → GIT_DEFAULT_BRANCH if the recorded base is stale.
  if (initialWorktreeTruth && preferredCodebase?.repoPath) {
    try {
      const { resolveVerifiedBaseBranch } = await import("./task-worktree-truth");
      baseBranch = await resolveVerifiedBaseBranch(initialWorktreeTruth);
    } catch {
      // Verification failed — keep the original baseBranch
    }
  }
  if (branchRules.triggers.worktreeCreationColumns.includes(params.expectedColumnId ?? nextTask.columnId ?? "") && preferredCodebase && !nextTask.worktreeId) {
    const result = await ensureTaskWorktree(nextTask, preferredCodebase, {
      worktreeStore: system.worktreeStore,
      codebaseStore: system.codebaseStore,
      taskStore: system.taskStore,
      workspace,
      workspaceId: nextTask.workspaceId,
      rules: branchRules,
    });
    if (!result.ok) {
      await system.taskStore.save(nextTask);
      return { error: result.errorMessage };
    }
    // Worktree was just created — read its truth directly from the store
    // instead of doing another full resolveTaskWorktreeTruth call.
    if (nextTask.worktreeId) {
      const newWorktree = await system.worktreeStore.get(nextTask.worktreeId);
      if (newWorktree?.worktreePath) {
        worktreeCwd = newWorktree.worktreePath;
        worktreeBranch = newWorktree.branch;
        baseBranch = newWorktree.baseBranch ?? baseBranch;
      }
    }
  }

  const effectiveAutomation = resolveEffectiveTaskAutomation(
    nextTask,
    board?.columns ?? [],
    resolveKanbanSpecialist,
    { autoProviderId },
  );
  const providerOverride = params.providerOverride?.trim() || undefined;
  const sessionStep = resolveKanbanAutomationStep(params.step, resolveKanbanSpecialist, {
    autoProviderId,
  })
    ?? effectiveAutomation.step;
  const sessionStepIndex = params.stepIndex ?? effectiveAutomation.stepIndex;
  const sessionProviderId = providerOverride
    ?? sessionStep?.providerId
    ?? effectiveAutomation.providerId;
  const taskForSession = {
    ...nextTask,
    assignedProvider: sessionProviderId,
    assignedRole: sessionStep?.role ?? effectiveAutomation.role,
    assignedSpecialistId: sessionStep?.specialistId ?? effectiveAutomation.specialistId,
    assignedSpecialistName: sessionStep?.specialistName ?? effectiveAutomation.specialistName,
  };
  const summaryContext = {
    evidenceSummary: await buildTaskEvidenceSummary(taskForSession, system),
    storyReadiness: await buildTaskStoryReadiness(taskForSession, system),
    investValidation: buildTaskInvestValidation(taskForSession),
  };

  // Allocate task-level dev server port for dev/review columns
  let taskDevPort: number | undefined;
  const currentStage = board?.columns.find((col) => col.id === (params.expectedColumnId ?? nextTask.columnId))?.stage;
  if (currentStage === "dev" || currentStage === "review") {
    const registry = getTaskDevServerRegistry();
    const allocated = await registry.ensureForTask(
      nextTask.id,
      params.expectedColumnId ?? nextTask.columnId ?? "",
      "pending",
    );
    taskDevPort = allocated.port;
  }

  // Compute board-level flow guidance for the agent
  const allBoardTasks = await system.taskStore.listByWorkspace(nextTask.workspaceId);
  const boardTasks = nextTask.boardId
    ? allBoardTasks.filter((t) => t.boardId === nextTask.boardId)
    : allBoardTasks;
  const tasksWithFlow = boardTasks.filter(
    (t) => (t.laneSessions?.length ?? 0) > 0 || (t.laneHandoffs?.length ?? 0) > 0,
  );
  const flowReport = tasksWithFlow.length >= 3
    ? analyzeFlowForTasks(tasksWithFlow, {
        workspaceId: nextTask.workspaceId,
        boardId: nextTask.boardId,
      })
    : undefined;

  const triggerResult = await triggerAssignedTaskAgent({
    origin: getInternalApiOrigin(),
    workspaceId: nextTask.workspaceId,
    cwd: worktreeCwd,
    branch: worktreeBranch,
    baseBranch,
    task: taskForSession,
    step: sessionStep,
    specialistLocale: sessionStep?.specialistLocale ?? effectiveAutomation.step?.specialistLocale,
    boardColumns: board?.columns ?? [],
    summaryContext,
    flowReport,
    eventBus: system.eventBus,
    taskDevPort,
    workspaceMetadata: workspace?.metadata,
  });

  if (triggerResult.sessionId) {
    completeRunningSessionsOutsideColumn(nextTask, nextTask.columnId, {
      excludeSessionId: triggerResult.sessionId,
    });
    nextTask.triggerSessionId = triggerResult.sessionId;
    // Track session in history
    if (!nextTask.sessionIds) nextTask.sessionIds = [];
    if (!nextTask.sessionIds.includes(triggerResult.sessionId)) {
      nextTask.sessionIds.push(triggerResult.sessionId);
    }
    const currentColumn = board?.columns.find((column) => column.id === nextTask.columnId);
    upsertTaskLaneSession(nextTask, {
      sessionId: triggerResult.sessionId,
      worktreeId: nextTask.worktreeId,
      cwd: worktreeCwd,
      columnId: nextTask.columnId,
      columnName: currentColumn?.name,
      stepId: sessionStep?.id,
      stepIndex: sessionStepIndex,
      stepName: sessionStep?.specialistName ?? sessionStep?.specialistId ?? sessionStep?.role,
      provider: sessionProviderId,
      role: sessionStep?.role ?? effectiveAutomation.role,
      specialistId: sessionStep?.specialistId ?? effectiveAutomation.specialistId,
      specialistName: sessionStep?.specialistName ?? effectiveAutomation.specialistName,
      transport: triggerResult.transport ?? sessionStep?.transport ?? effectiveAutomation.transport,
      externalTaskId: triggerResult.externalTaskId,
      contextId: triggerResult.contextId,
      attempt: params.supervision?.attempt,
      loopMode: params.supervision?.mode,
      completionRequirement: params.supervision?.completionRequirement,
      objective: params.supervision?.objective ?? nextTask.objective,
      recoveredFromSessionId: params.supervision?.recoveredFromSessionId,
      recoveryReason: params.supervision?.recoveryReason,
      status: "running",
    });
    nextTask.lastSyncError = undefined;
    if (nextTask.worktreeId) {
      await system.worktreeStore.assignSession(nextTask.worktreeId, triggerResult.sessionId);
    }
  } else {
    const errDetail = triggerResult.error ?? "unknown (triggerResult returned no sessionId and no error)";
    console.error(
      `[startKanbanTaskSession] triggerAssignedTaskAgent failed for task ${nextTask.id}: ${errDetail}`,
    );
    nextTask.lastSyncError = errDetail;
  }

  await system.taskStore.save(nextTask);
  return {
    sessionId: triggerResult.sessionId ?? null,
    error: triggerResult.error,
  };
}

async function getBoardConcurrencyLimit(system: RoutaSystem, workspaceId: string, boardId: string): Promise<number> {
  const workspace = await system.workspaceStore.get(workspaceId);
  return getBoardSessionConcurrencyLimit(workspace?.metadata, boardId);
}

async function resolveDevSessionSupervision(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  _stage: KanbanColumnStage,
) {
  const workspace = await system.workspaceStore.get(workspaceId);
  return getKanbanDevSessionSupervision(workspace?.metadata, boardId);
}

async function sendPromptToKanbanSession(
  system: RoutaSystem,
  params: {
    workspaceId: string;
    sessionId: string;
    prompt: string;
  },
): Promise<void> {
  const sessionStore = getHttpSessionStore();
  const sessionRecord = sessionStore.getSession(params.sessionId);
  const targetAgentId = sessionRecord?.routaAgentId;

  if (targetAgentId) {
    const conversationResult = await system.tools.readAgentConversation({
      agentId: targetAgentId,
      lastN: 5,
    });

    if (conversationResult.success) {
      const messageCount = (conversationResult.data as { messages?: unknown[] } | undefined)?.messages?.length ?? 0;
      console.debug(
        `[WorkflowOrchestrator] Read ${messageCount} recent messages for agent ${targetAgentId} before recovery prompt.`,
      );
    } else {
      console.warn(
        `[WorkflowOrchestrator] Failed to read conversation for agent ${targetAgentId}: ${conversationResult.error}`,
      );
    }

    const toolResult = await system.tools.messageAgent({
      fromAgentId: targetAgentId,
      toAgentId: targetAgentId,
      message: params.prompt,
    });

    if (toolResult.success) {
      return;
    }

    console.warn(
      `[WorkflowOrchestrator] Failed to send recovery prompt via agent ${targetAgentId}: ${toolResult.error}. Falling back to session/prompt.`,
    );
  }

  await dispatchSessionPrompt({
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
    prompt: [{ type: "text", text: params.prompt }],
  });
}

async function scanStaleTaskTriggers(system: RoutaSystem): Promise<number> {
  let cleanedCount = 0;

  const workspaces = await system.workspaceStore.list();
  for (const ws of workspaces) {
    const tasks = await system.taskStore.listByWorkspace(ws.id);
    for (const task of tasks) {
      const cleaned = await clearStaleTriggerSession(task, getHttpSessionStore(), system.taskStore);
      if (cleaned) cleanedCount++;
    }
  }

  return cleanedCount;
}

export function getKanbanSessionQueue(system: RoutaSystem): KanbanSessionQueue {
  const g = globalThis as Record<string, unknown>;
  let queue = g[QUEUE_KEY] as KanbanSessionQueue | undefined;

  if (queue && !queue.isCompatible(system.eventBus, system.taskStore)) {
    queue.stop();
    delete g[QUEUE_KEY];
    queue = undefined;
  }

  if (!queue) {
    queue = new KanbanSessionQueue(
      system.eventBus,
      system.taskStore,
      (workspaceId, boardId) => getBoardConcurrencyLimit(system, workspaceId, boardId),
    );
    g[QUEUE_KEY] = queue;
  }

  return queue;
}

/**
 * Get or create the global KanbanWorkflowOrchestrator instance.
 */
export function getWorkflowOrchestrator(system: RoutaSystem): KanbanWorkflowOrchestrator {
  const g = globalThis as Record<string, unknown>;
  let orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;

  const isCompatible = orchestrator
    && typeof (orchestrator as KanbanWorkflowOrchestrator & { processColumnTransition?: unknown }).processColumnTransition === "function"
    && g[VERSION_KEY] === ORCHESTRATOR_VERSION;

  if (orchestrator && !isCompatible) {
    console.log(
      `[WorkflowOrchestrator] Recreating singleton (version changed: ${g[VERSION_KEY]} → ${ORCHESTRATOR_VERSION}).`,
    );
    orchestrator.stop();
    delete g[GLOBAL_KEY];
    delete g[STARTED_KEY];
    orchestrator = undefined;
  }

  if (!orchestrator) {
    orchestrator = new KanbanWorkflowOrchestrator(
      system.eventBus,
      system.kanbanBoardStore,
      system.taskStore,
    );
    g[GLOBAL_KEY] = orchestrator;
    g[VERSION_KEY] = ORCHESTRATOR_VERSION;
  }

  return orchestrator;
}

/**
 * Start the workflow orchestrator singleton. Idempotent across HMR restarts.
 */
export function startWorkflowOrchestrator(system: RoutaSystem): void {
  const g = globalThis as Record<string, unknown>;
  const orchestrator = getWorkflowOrchestrator(system);
  const queue = getKanbanSessionQueue(system);
  orchestrator.setCreateSession((params) => createAutomationSession(system, params));
  orchestrator.setCleanupCardSession((cardId) => queue.removeCardJob(cardId));
  orchestrator.setResolveDevSessionSupervision(({ workspaceId, boardId, stage }) =>
    resolveDevSessionSupervision(system, workspaceId, boardId, stage)
  );
  orchestrator.setResolveBranchRules(async ({ workspaceId, boardId }) => {
    const workspace = await system.workspaceStore.get(workspaceId);
    return getKanbanBranchRules(workspace?.metadata, boardId);
  });
  orchestrator.setSendKanbanSessionPrompt((params) => sendPromptToKanbanSession(system, {
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    prompt: params.prompt,
  }));
  orchestrator.setScanStaleTaskTriggers(() => scanStaleTaskTriggers(system));
  orchestrator.setExecuteAutoPrCreation((params) => executeAutoPrCreation(
    system.worktreeStore,
    system.taskStore,
    system.codebaseStore,
    params,
  ));
  orchestrator.setWorktreeStore(system.worktreeStore);
  orchestrator.setTriggerStandaloneConflictResolver(async ({ cardId }) => {
    const task = await system.taskStore.get(cardId);
    if (!task) return { error: "Task not found" };
    return enqueueKanbanTaskSession(system, {
      task,
      ignoreExistingTrigger: true,
      bypassDependencyGate: true,
      step: {
        id: "conflict-resolver",
        role: "DEVELOPER",
        specialistId: "kanban-conflict-resolver",
        specialistName: "Conflict Resolver",
      },
      stepIndex: 0,
    });
  });
  orchestrator.start();
  queue.start();
  startWorktreeCleanupListener(system);
  startPrMergeListener(system);
  startPrAutoCreateListener(system);
  orchestrator.setNotifyBacklogChange((boardId, workspaceId) => {
    notifyBacklogChange(system, boardId, workspaceId);
  });
  startGraphRefinerTrigger(system);
  g[STARTED_KEY] = true;
}

export async function processKanbanColumnTransition(
  system: RoutaSystem,
  data: ColumnTransitionData,
): Promise<void> {
  startWorkflowOrchestrator(system);
  const orchestrator = getWorkflowOrchestrator(system);
  await orchestrator.processColumnTransition(data);
}

/**
 * Reset the orchestrator (for testing).
 */
export function resetWorkflowOrchestrator(): void {
  const g = globalThis as Record<string, unknown>;

  const orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;
  if (orchestrator) {
    orchestrator.stop();
  }

  const queue = g[QUEUE_KEY] as KanbanSessionQueue | undefined;
  if (queue) {
    queue.stop();
  }

  stopGraphRefinerTrigger();

  delete g[GLOBAL_KEY];
  delete g[QUEUE_KEY];
  delete g[STARTED_KEY];
  delete g[VERSION_KEY];
  delete g[FAILURES_KEY];
}
