/**
 * KanbanTools — ACP-exposed tools for managing Kanban boards and cards.
 *
 * Provides operations for:
 * - Board management: create_board, list_boards, get_board
 * - Card operations: create_card, move_card, update_card, delete_card
 * - Column operations: create_column, delete_column
 * - Search/filter: search_cards, list_cards_by_column
 *
 * Cards are implemented using the Task model with boardId and columnId fields.
 */

import { v4 as uuidv4 } from "uuid";
import { KanbanBoardStore } from "../store/kanban-board-store";
import { TaskStore } from "../store/task-store";
import { ArtifactStore } from "../store/artifact-store";
import {
  createKanbanBoard,
  KanbanColumn,
  KanbanColumnStage,
  columnIdToTaskStatus,
} from "../models/kanban";
import type { RoutaSystem } from "../routa-system";
import {
  createTask,
  Task,
  TaskLaneHandoffRequestType,
  TaskLaneHandoffStatus,
  TaskPriority,
} from "../models/task";
import { ArtifactType } from "../models/artifact";
import { ToolResult, successResult, errorResult } from "./tool-result";
import { EventBus } from "../events/event-bus";
import { emitColumnTransition } from "../kanban/column-transition";
import { getKanbanEventBroadcaster } from "../kanban/kanban-event-broadcaster";
import {
  createTaskLaneHandoff,
  getPreviousLaneSession,
  getTaskLaneHandoff,
  getTaskLaneSession,
  upsertTaskLaneHandoff,
} from "../kanban/task-lane-history";
import { finalizeActiveTaskSession } from "../kanban/task-session-transition";
import { buildRemainingLaneStepsMessage, resolveCurrentLaneAutomationState } from "../kanban/lane-automation-state";
import { getInternalApiOrigin } from "../kanban/agent-trigger";
import {
  formatRequiredTaskFieldLabel,
  resolveTargetRequiredTaskFields,
  validateTaskReadiness,
} from "../kanban/task-derived-summary";
import {
  appendTaskComment,
  appendTaskCommentEntry,
} from "../kanban/task-comment-log";
import {
  buildTaskDeliveryReadiness,
  buildTaskDeliveryTransitionErrorFromRules,
  type TaskDeliveryReadiness,
} from "../kanban/task-delivery-readiness";
import {
  captureTaskDeliverySnapshot,
  shouldCaptureTaskDeliverySnapshotForColumn,
} from "../kanban/task-delivery-snapshot";
import {
  buildContractGateNote,
  buildContractLoopBreakerMessage,
  buildTaskContractReadiness,
  buildTaskContractTransitionErrorFromRules,
  buildTaskContractUpdateErrorFromRules,
  CONTRACT_GATE_BLOCKED_LABEL,
  countContractGateFailures,
  resolveCurrentOrNextContractGate,
} from "../kanban/task-contract-readiness";
import { resolveTaskWorktreeTruth } from "../kanban/task-worktree-truth";
import { checkCanMoveToNextColumn, updateDependencyRelations } from "../kanban/dependency-gate";

const DESCRIPTION_FROZEN_STAGES = new Set<KanbanColumnStage>(["dev", "review", "blocked", "done", "archived"]);

export class KanbanTools {
  private eventBus?: EventBus;
  private artifactStore?: ArtifactStore;
  private automationSystem?: RoutaSystem;
  private kanbanBroadcaster = getKanbanEventBroadcaster();

  constructor(
    private kanbanBoardStore: KanbanBoardStore,
    private taskStore: TaskStore,
  ) {}

  /** Set the event bus for emitting column transition events */
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  /** Set the artifact store for checking required artifacts */
  setArtifactStore(artifactStore: ArtifactStore): void {
    this.artifactStore = artifactStore;
  }

  /** Set the Routa system used for direct automation enqueue after card creation */
  setAutomationSystem(system: RoutaSystem): void {
    this.automationSystem = system;
  }

  // ─── Board Operations ───────────────────────────────────────────────────

  async createBoard(params: {
    workspaceId: string;
    name: string;
    columns?: string[];
  }): Promise<ToolResult> {
    const columns: KanbanColumn[] | undefined = params.columns?.map((name, index) => ({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      position: index,
      stage: "backlog" as const,
    }));

    const board = createKanbanBoard({
      id: uuidv4(),
      workspaceId: params.workspaceId,
      name: params.name,
      columns,
    });

    await this.kanbanBoardStore.save(board);
    this.notifyWorkspaceChanged(board.workspaceId, "board", "created", board.id);

    return successResult({
      boardId: board.id,
      name: board.name,
      columns: board.columns.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  async listBoards(workspaceId: string): Promise<ToolResult> {
    const boards = await this.kanbanBoardStore.listByWorkspace(workspaceId);
    return successResult(
      boards.map((b) => ({
        id: b.id,
        name: b.name,
        isDefault: b.isDefault,
        columnCount: b.columns.length,
      })),
    );
  }

  async getBoard(boardId: string): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(boardId);
    if (!board) {
      return errorResult(`Board not found: ${boardId}`);
    }

    const tasks = await this.taskStore.listByWorkspace(board.workspaceId);
    const boardTasks = tasks.filter((t) => t.boardId === boardId);

    return successResult({
      id: board.id,
      name: board.name,
      isDefault: board.isDefault,
      columns: board.columns.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        position: c.position,
        cards: boardTasks
          .filter((t) => (t.columnId ?? "backlog") === c.id)
          .sort((a, b) => a.position - b.position)
          .map((t) => this.taskToCard(t)),
      })),
    });
  }

  // ─── Card Operations ────────────────────────────────────────────────────

  async createCard(params: {
    boardId?: string;
    columnId?: string;
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    labels?: string[];
    assignedProvider?: string;
    workspaceId: string;
  }): Promise<ToolResult> {
    const board = await this.resolveBoard(params.workspaceId, params.boardId);
    if (!board) {
      return errorResult(
        params.boardId
          ? `Board not found: ${params.boardId}`
          : `No board found for workspace: ${params.workspaceId}`,
      );
    }

    const targetColumnId = params.columnId ?? "backlog";
    const column = board.columns.find((c) => c.id === targetColumnId);
    if (!column) {
      return errorResult(`Column not found: ${targetColumnId}`);
    }

    const tasks = await this.taskStore.listByWorkspace(params.workspaceId);
    const columnTasks = tasks.filter(
      (t) => t.boardId === board.id && (t.columnId ?? "backlog") === targetColumnId,
    );
    const position = columnTasks.length;

    const task = createTask({
      id: uuidv4(),
      title: params.title,
      objective: params.description ?? "",
      workspaceId: params.workspaceId,
      boardId: board.id,
      columnId: targetColumnId,
      position,
      status: columnIdToTaskStatus(targetColumnId),
      priority: params.priority as TaskPriority | undefined,
      labels: params.labels,
      assignedProvider: params.assignedProvider,
    });

    await this.taskStore.save(task);
    await this.triggerCreatedCardAutomation(board, column, task);
    this.notifyWorkspaceChanged(task.workspaceId, "task", "created", task.id);

    return successResult(this.taskToCard(task));
  }

  async moveCard(params: {
    cardId: string;
    targetColumnId: string;
    position?: number;
  }): Promise<ToolResult> {
    const task = await this.taskStore.get(params.cardId);
    if (!task) {
      return errorResult(`Card not found: ${params.cardId}`);
    }

    if (!task.boardId) {
      return errorResult(`Card ${params.cardId} is not associated with a board`);
    }

    const board = await this.kanbanBoardStore.get(task.boardId);
    if (!board) {
      return errorResult(`Board not found: ${task.boardId}`);
    }

    const targetColumn = board.columns.find((c) => c.id === params.targetColumnId);
    // Allow "archived" as a virtual column even if not present on the board
    const isArchivedVirtualColumn = params.targetColumnId === "archived" && !targetColumn;
    if (!targetColumn && !isArchivedVirtualColumn) {
      return errorResult(`Column not found: ${params.targetColumnId}`);
    }
    const resolvedTargetColumn = targetColumn ?? {
      id: "archived",
      name: "Archived",
      position: board.columns.length,
      stage: "archived" as KanbanColumnStage,
    };

    const fromColumnId = task.columnId ?? "backlog";
    // Archived cards cannot be moved out via moveCard; use a dedicated unarchive endpoint instead
    if (fromColumnId === "archived") {
      return errorResult(`Cannot move card "${task.title}" out of Archived. Use a dedicated unarchive action to restore it.`);
    }
    const fromColumn = board.columns.find((c) => c.id === fromColumnId);
    // Done-to-blocked guard: reject moves of APPROVED cards from done to blocked.
    // An approved card should not be re-blocked — if there is a post-approval
    // infrastructure issue, clear the verdict first or create a separate follow-up.
    if (
      fromColumn?.stage === "done"
      && resolvedTargetColumn.stage === "blocked"
      && task.verificationVerdict === "APPROVED"
    ) {
      return errorResult(
        `Cannot move card "${task.title}" to Blocked: this card has verificationVerdict=APPROVED. ` +
        "Approved cards should remain in Done. If there is a post-approval issue, " +
        "clear the verificationVerdict first or create a separate follow-up card.",
      );
    }
    const allowReviewFallbackToDev = fromColumnId === "review"
      && params.targetColumnId === "dev"
      && task.verificationVerdict === "NOT_APPROVED";
    if (fromColumnId !== params.targetColumnId && task.triggerSessionId && !allowReviewFallbackToDev) {
      const laneAutomationState = resolveCurrentLaneAutomationState(task, board.columns, {
        currentSessionId: task.triggerSessionId,
      });
      const moveBlockedMessage = buildRemainingLaneStepsMessage(task.title, laneAutomationState);
      if (moveBlockedMessage) {
        return errorResult(moveBlockedMessage);
      }
    }

    // Cross-column active automation guard: reject if another column has an active automation on this card
    if (this.automationSystem && fromColumnId !== params.targetColumnId) {
      try {
        const { getWorkflowOrchestrator } = await import("../kanban/workflow-orchestrator-singleton");
        const orchestrator = getWorkflowOrchestrator(this.automationSystem);
        const activeAutomation = orchestrator.getAutomationForCard(task.id);
        if (
          activeAutomation
          && (activeAutomation.status === "queued" || activeAutomation.status === "running")
          && activeAutomation.columnId !== fromColumnId
        ) {
          return errorResult(
            `Cannot move "${task.title}" to "${resolvedTargetColumn.name}": an active automation is still running ` +
            `in column "${activeAutomation.columnName ?? activeAutomation.columnId}" (status: ${activeAutomation.status}). ` +
            "Wait for it to complete before moving the card.",
          );
        }
      } catch {
        // Orchestrator may not be initialized in all contexts; skip cross-column check
      }
    }

    // AC3: Check dependency gate before allowing transition
    if (task.dependencies && task.dependencies.length > 0 && fromColumnId !== params.targetColumnId) {
      const depCheck = await checkCanMoveToNextColumn(
        task,
        params.targetColumnId,
        board.columns,
        this.taskStore,
      );
      if (!depCheck.canMove) {
        return errorResult(depCheck.message ?? `Cannot move card to "${targetColumn?.name ?? params.targetColumnId}": blocked by unfinished dependencies: ${depCheck.blockedBy.join(", ")}`);
      }
    }

    // Split parent guard: block move to done/archived if child tasks are not completed
    if (
      task.splitPlan?.childTaskIds?.length
      && (resolvedTargetColumn.stage === "archived" || resolvedTargetColumn.stage === "done")
    ) {
      const pendingChildren: string[] = [];
      for (const childId of task.splitPlan.childTaskIds) {
        const child = await this.taskStore.get(childId);
        if (child && child.status !== "COMPLETED" && child.status !== "ARCHIVED") {
          pendingChildren.push(child.title ?? childId);
        }
      }
      if (pendingChildren.length > 0) {
        return errorResult(
          `Cannot move "${task.title}" to ${resolvedTargetColumn.name ?? params.targetColumnId}: ` +
          `${pendingChildren.length} child task(s) not completed: ${pendingChildren.slice(0, 3).join(", ")}`,
        );
      }
    }

    // Check required artifacts before allowing transition
    const requiredArtifacts = resolvedTargetColumn.automation?.requiredArtifacts;
    if (requiredArtifacts && requiredArtifacts.length > 0 && this.artifactStore) {
      const missingArtifacts: string[] = [];
      for (const artifactType of requiredArtifacts) {
        const artifacts = await this.artifactStore.listByTaskAndType(
          task.id,
          artifactType as ArtifactType
        );
        if (artifacts.length === 0) {
          missingArtifacts.push(artifactType);
        }
      }
      if (missingArtifacts.length > 0) {
        return errorResult(
          `Cannot move card to "${resolvedTargetColumn.name}": missing required artifacts: ${missingArtifacts.join(", ")}. ` +
          `Please provide these artifacts before moving the card.`
        );
      }
    }

    const requiredTaskFields = resolveTargetRequiredTaskFields(board.columns, resolvedTargetColumn.id);
    if (requiredTaskFields.length > 0) {
      const readiness = validateTaskReadiness(task, requiredTaskFields);
      if (!readiness.ready) {
        const missingTaskFields = readiness.missing.map(formatRequiredTaskFieldLabel);
        return errorResult(
          `Cannot move card to "${resolvedTargetColumn.name}": missing required task fields: ${missingTaskFields.join(", ")}. `
          + "Please complete this story definition before moving the card.",
        );
      }
    }

    const contractReadiness = buildTaskContractReadiness(task, resolvedTargetColumn.automation?.contractRules);
    const contractError = buildTaskContractTransitionErrorFromRules(
      contractReadiness,
      resolvedTargetColumn.name,
      resolvedTargetColumn.automation?.contractRules,
    );
    if (contractError) {
      await this.recordTaskContractGateFailure(
        task,
        contractError,
        resolvedTargetColumn.name,
        contractReadiness.loopBreakerThreshold,
        task.triggerSessionId,
      );
      return errorResult(contractError);
    }

    let deliveryReadiness: TaskDeliveryReadiness | undefined;
    if (this.isAutomationSystemCompatible()) {
      deliveryReadiness = await buildTaskDeliveryReadiness(task, this.automationSystem!);
      const deliveryError = buildTaskDeliveryTransitionErrorFromRules(
        deliveryReadiness,
        resolvedTargetColumn.name,
        resolvedTargetColumn.automation?.deliveryRules,
        task,
      );
      if (deliveryError) {
        await this.recordTaskMoveBlockComment(task, deliveryError, task.triggerSessionId);
        return errorResult(deliveryError);
      }
    }

    if (
      fromColumnId !== params.targetColumnId
      && shouldCaptureTaskDeliverySnapshotForColumn(params.targetColumnId)
      && this.isAutomationSystemCompatible()
    ) {
      deliveryReadiness ??= await buildTaskDeliveryReadiness(task, this.automationSystem!);
      task.deliverySnapshot = captureTaskDeliverySnapshot(task, deliveryReadiness, {
        source: params.targetColumnId === "done" ? "done_transition" : "review_transition",
      });
    }

    // Preserve the current active session in history before clearing
    // This allows the next column's automation to create a fresh session
    finalizeActiveTaskSession(task);

    task.columnId = params.targetColumnId;
    task.status = columnIdToTaskStatus(params.targetColumnId);
    task.position = params.position ?? task.position;
    task.updatedAt = new Date();

    await this.taskStore.save(task);

    // Use lightweight kanban:archived event for archived cards instead of kanban:changed
    if (params.targetColumnId === "archived") {
      this.kanbanBroadcaster.notifyArchived({
        cardId: task.id,
        newStage: "archived",
        workspaceId: task.workspaceId,
      });
    } else {
      this.notifyWorkspaceChanged(task.workspaceId, "task", fromColumnId !== params.targetColumnId ? "moved" : "updated", task.id);
    }

    // Emit column transition event if column actually changed
    if (this.eventBus && fromColumnId !== params.targetColumnId) {
      emitColumnTransition(this.eventBus, {
        cardId: task.id,
        cardTitle: task.title,
        boardId: task.boardId,
        workspaceId: task.workspaceId,
        fromColumnId,
        toColumnId: params.targetColumnId,
        fromColumnName: fromColumn?.name,
        toColumnName: resolvedTargetColumn.name,
      });
    }

    return successResult(this.taskToCard(task));
  }

  async updateCard(params: {
    cardId: string;
    title?: string;
    description?: string;
    comment?: string;
    agentId?: string;
    sessionId?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    labels?: string[];
    pullRequestUrl?: string;
  }): Promise<ToolResult> {
    const task = await this.taskStore.get(params.cardId);
    if (!task) {
      return errorResult(`Card not found: ${params.cardId}`);
    }

    const stage = await this.resolveTaskStage(task);
    if (params.description !== undefined && stage && DESCRIPTION_FROZEN_STAGES.has(stage)) {
      return errorResult(
        `Cannot update card description in ${stage}. The story description is frozen from dev onward; update the comment field instead.`
      );
    }

    if (params.description !== undefined && task.boardId) {
      const board = await this.kanbanBoardStore.get(task.boardId);
      const contractGate = board
        ? resolveCurrentOrNextContractGate(board.columns, task.columnId)
        : null;
      if (contractGate) {
        const nextTask = {
          ...task,
          objective: params.description,
        };
        const contractReadiness = buildTaskContractReadiness(nextTask, contractGate.rules);
        const contractError = buildTaskContractUpdateErrorFromRules(
          contractReadiness,
          contractGate.columnName,
          contractGate.rules,
        );
        if (contractError) {
          await this.recordTaskContractGateFailure(
            task,
            contractError,
            contractGate.columnName,
            contractReadiness.loopBreakerThreshold,
            params.sessionId,
          );
          return errorResult(contractError);
        }
      }
    }

    if (params.title !== undefined) task.title = params.title;
    if (params.description !== undefined) task.objective = params.description;
    if (params.comment !== undefined) {
      task.comment = appendTaskComment(task.comment, params.comment);
      task.comments = appendTaskCommentEntry(task.comments, params.comment, {
        agentId: params.agentId,
        sessionId: params.sessionId,
      });
    }
    if (params.priority !== undefined) task.priority = params.priority as TaskPriority;
    if (params.labels !== undefined) task.labels = params.labels;
    if (params.pullRequestUrl !== undefined) task.pullRequestUrl = params.pullRequestUrl;
    task.updatedAt = new Date();

    await this.taskStore.save(task);
    this.notifyWorkspaceChanged(task.workspaceId, "task", "updated", task.id);

    return successResult(this.taskToCard(task));
  }

  async requestPreviousLaneHandoff(params: {
    taskId: string;
    requestType: TaskLaneHandoffRequestType;
    request: string;
    sessionId: string;
  }): Promise<ToolResult> {
    const task = await this.taskStore.get(params.taskId);
    if (!task) {
      return errorResult(`Card not found: ${params.taskId}`);
    }
    if (!task.boardId) {
      return errorResult(`Card ${params.taskId} is not associated with a board`);
    }

    const board = await this.kanbanBoardStore.get(task.boardId);
    if (!board) {
      return errorResult(`Board not found: ${task.boardId}`);
    }

    const currentLaneSession = getTaskLaneSession(task, params.sessionId);
    const previousLaneSession = getPreviousLaneSession(task, board, task.columnId);
    if (!previousLaneSession?.sessionId) {
      return errorResult(`No previous lane session found for card ${params.taskId}`);
    }
    const taskWorktreeTruth = this.automationSystem
      ? await resolveTaskWorktreeTruth(task, this.automationSystem)
      : null;
    const targetCwd = previousLaneSession.cwd ?? taskWorktreeTruth?.cwd ?? currentLaneSession?.cwd;

    const handoff = createTaskLaneHandoff({
      id: uuidv4(),
      fromSessionId: params.sessionId,
      toSessionId: previousLaneSession.sessionId,
      fromColumnId: currentLaneSession?.columnId ?? task.columnId,
      toColumnId: previousLaneSession.columnId,
      worktreeId: task.worktreeId,
      cwd: targetCwd,
      requestType: params.requestType,
      request: params.request,
    });
    upsertTaskLaneHandoff(task, handoff);
    const shouldReturnToPreviousLane = task.columnId === "review"
      && task.verificationVerdict === "NOT_APPROVED"
      && previousLaneSession.columnId
      && previousLaneSession.columnId !== task.columnId;
    const previousColumn = shouldReturnToPreviousLane
      ? board.columns.find((column) => column.id === previousLaneSession.columnId)
      : undefined;
    if (shouldReturnToPreviousLane && previousLaneSession.columnId) {
      finalizeActiveTaskSession(task);
      task.columnId = previousLaneSession.columnId;
      task.status = columnIdToTaskStatus(previousLaneSession.columnId);
      task.updatedAt = new Date();
    }
    await this.taskStore.save(task);
    if (shouldReturnToPreviousLane && previousLaneSession.columnId) {
      this.notifyWorkspaceChanged(task.workspaceId, "task", "moved", task.id);
      if (this.eventBus) {
        emitColumnTransition(this.eventBus, {
          cardId: task.id,
          cardTitle: task.title,
          boardId: task.boardId,
          workspaceId: task.workspaceId,
          fromColumnId: "review",
          toColumnId: previousLaneSession.columnId,
          fromColumnName: board.columns.find((column) => column.id === "review")?.name,
          toColumnName: previousColumn?.name,
        });
      }
    }

    try {
      await this.promptSession(
        previousLaneSession.sessionId,
        task.workspaceId,
        this.buildPreviousLaneHandoffPrompt({
          task,
          handoffId: handoff.id,
          requestType: params.requestType,
          request: params.request,
          requestingColumnId: handoff.fromColumnId,
          requestingSessionId: params.sessionId,
          worktreeId: handoff.worktreeId,
          cwd: handoff.cwd,
        }),
      );
      handoff.status = "delivered";
      await this.taskStore.save(task);
      this.notifyWorkspaceChanged(task.workspaceId, "task", "updated", task.id);
      return successResult({
        handoffId: handoff.id,
        status: handoff.status,
        targetSessionId: previousLaneSession.sessionId,
        targetColumnId: previousLaneSession.columnId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to deliver handoff request";
      handoff.status = "failed";
      handoff.respondedAt = new Date().toISOString();
      handoff.responseSummary = `Unable to deliver handoff request to ${previousLaneSession.columnName ?? previousLaneSession.columnId ?? "the previous lane"} session ${previousLaneSession.sessionId.slice(0, 8)}: ${message}`;
      await this.taskStore.save(task);
      this.notifyWorkspaceChanged(task.workspaceId, "task", "updated", task.id);
      return successResult({
        handoffId: handoff.id,
        status: handoff.status,
        targetSessionId: previousLaneSession.sessionId,
        targetColumnId: previousLaneSession.columnId,
        deliveryError: message,
      });
    }
  }

  async submitLaneHandoff(params: {
    taskId: string;
    handoffId: string;
    status: Exclude<TaskLaneHandoffStatus, "requested" | "delivered">;
    summary: string;
    sessionId: string;
  }): Promise<ToolResult> {
    const task = await this.taskStore.get(params.taskId);
    if (!task) {
      return errorResult(`Card not found: ${params.taskId}`);
    }

    const handoff = getTaskLaneHandoff(task, params.handoffId);
    if (!handoff) {
      return errorResult(`Lane handoff not found: ${params.handoffId}`);
    }
    if (handoff.toSessionId !== params.sessionId) {
      return errorResult(`Lane handoff ${params.handoffId} is not assigned to this session`);
    }

    handoff.status = params.status;
    handoff.responseSummary = params.summary;
    handoff.respondedAt = new Date().toISOString();
    await this.taskStore.save(task);
    this.notifyWorkspaceChanged(task.workspaceId, "task", "updated", task.id);

    if (handoff.fromSessionId && handoff.fromSessionId !== params.sessionId) {
      try {
        await this.promptSession(
          handoff.fromSessionId,
          task.workspaceId,
          this.buildHandoffResponsePrompt(task, handoff),
        );
      } catch {
        // Keep the durable task record even if the origin session is no longer available.
      }
    }

    return successResult({
      handoffId: handoff.id,
      status: handoff.status,
      respondedAt: handoff.respondedAt,
    });
  }

  async deleteCard(cardId: string): Promise<ToolResult> {
    const task = await this.taskStore.get(cardId);
    if (!task) {
      return errorResult(`Card not found: ${cardId}`);
    }

    await this.taskStore.delete(cardId);
    this.notifyWorkspaceChanged(task.workspaceId, "task", "deleted", cardId);

    return successResult({ deleted: true, cardId });
  }

  // ─── Column Operations ──────────────────────────────────────────────────

  async createColumn(params: {
    boardId: string;
    name: string;
    color?: string;
  }): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(params.boardId);
    if (!board) {
      return errorResult(`Board not found: ${params.boardId}`);
    }

    const columnId = params.name.toLowerCase().replace(/\s+/g, "-");
    if (board.columns.some((c) => c.id === columnId)) {
      return errorResult(`Column already exists: ${columnId}`);
    }

    const newColumn: KanbanColumn = {
      id: columnId,
      name: params.name,
      color: params.color,
      position: board.columns.length,
      stage: "backlog",
    };

    board.columns.push(newColumn);
    board.updatedAt = new Date();

    await this.kanbanBoardStore.save(board);
    this.notifyWorkspaceChanged(board.workspaceId, "column", "created", newColumn.id);

    return successResult({
      columnId: newColumn.id,
      name: newColumn.name,
      position: newColumn.position,
    });
  }

  async deleteColumn(params: {
    columnId: string;
    boardId: string;
    deleteCards?: boolean;
  }): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(params.boardId);
    if (!board) {
      return errorResult(`Board not found: ${params.boardId}`);
    }

    const columnIndex = board.columns.findIndex((c) => c.id === params.columnId);
    if (columnIndex === -1) {
      return errorResult(`Column not found: ${params.columnId}`);
    }

    const tasks = await this.taskStore.listByWorkspace(board.workspaceId);
    const columnTasks = tasks.filter(
      (t) => t.boardId === params.boardId && (t.columnId ?? "backlog") === params.columnId,
    );

    if (params.deleteCards) {
      for (const task of columnTasks) {
        await this.taskStore.delete(task.id);
      }
    } else if (columnTasks.length > 0) {
      // Move cards to backlog
      for (const task of columnTasks) {
        task.columnId = "backlog";
        task.updatedAt = new Date();
        await this.taskStore.save(task);
      }
    }

    board.columns.splice(columnIndex, 1);
    // Reorder remaining columns
    board.columns.forEach((c, i) => {
      c.position = i;
    });
    board.updatedAt = new Date();

    await this.kanbanBoardStore.save(board);
    this.notifyWorkspaceChanged(board.workspaceId, "column", "deleted", params.columnId);

    return successResult({
      deleted: true,
      columnId: params.columnId,
      cardsDeleted: params.deleteCards ? columnTasks.length : 0,
      cardsMoved: params.deleteCards ? 0 : columnTasks.length,
    });
  }

  // ─── Search/Filter Operations ───────────────────────────────────────────

  async searchCards(params: {
    query: string;
    boardId?: string;
    workspaceId: string;
  }): Promise<ToolResult> {
    const tasks = await this.taskStore.listByWorkspace(params.workspaceId);
    const queryLower = params.query.toLowerCase();

    const matchingTasks = tasks.filter((t) => {
      if (params.boardId && t.boardId !== params.boardId) return false;
      if (!t.boardId) return false; // Only include tasks that are on a board

      const titleMatch = t.title.toLowerCase().includes(queryLower);
      const labelMatch = t.labels.some((l) => l.toLowerCase().includes(queryLower));
      const assigneeMatch = t.assignee?.toLowerCase().includes(queryLower);

      return titleMatch || labelMatch || assigneeMatch;
    });

    return successResult(matchingTasks.map((t) => this.taskToCard(t)));
  }

  async listCardsByColumn(columnId: string, boardId?: string, workspaceId?: string): Promise<ToolResult> {
    const board = workspaceId
      ? await this.resolveBoard(workspaceId, boardId)
      : boardId
        ? await this.kanbanBoardStore.get(boardId)
        : null;
    if (!board) {
      return errorResult(
        boardId
          ? `Board not found: ${boardId}`
          : `No board found for workspace: ${workspaceId ?? "unknown"}`,
      );
    }

    const column = board.columns.find((c) => c.id === columnId);
    if (!column) {
      return errorResult(`Column not found: ${columnId}`);
    }

    const tasks = await this.taskStore.listByWorkspace(board.workspaceId);
    const columnTasks = tasks
      .filter((t) => t.boardId === board.id && (t.columnId ?? "backlog") === columnId)
      .sort((a, b) => a.position - b.position);

    return successResult({
      columnId,
      columnName: column.name,
      cards: columnTasks.map((t) => this.taskToCard(t)),
    });
  }

  // Helper to convert Task to Card format
  /**
   * Decompose a natural language input into multiple Kanban cards.
   * Returns the created tasks as card objects.
   *
   * Supports optional parentTaskId to link sub-tasks to a parent,
   * and per-task `dependencies` (as sibling refs) for ordering.
   */
  async decomposeTasks(params: {
    boardId?: string;
    workspaceId: string;
    tasks: {
      title: string;
      description?: string;
      priority?: "low" | "medium" | "high" | "urgent";
      labels?: string[];
      assignedProvider?: string;
      scope?: string;
      acceptanceCriteria?: string[];
      verificationCommands?: string[];
      testCases?: string[];
      /** Sibling ref for cross-task dependency linkage */
      ref?: string;
      /** Refs of sibling tasks this one depends on */
      dependsOn?: string[];
      /** File paths this task is expected to touch (conflict pre-detection) */
      estimatedFilePaths?: string[];
    }[];
    columnId?: string;
    /** Link all created cards to this parent task */
    parentTaskId?: string;
  }): Promise<ToolResult> {
    const board = await this.resolveBoard(params.workspaceId, params.boardId);
    if (!board) {
      return errorResult(
        params.boardId
          ? `Board not found: ${params.boardId}`
          : `No board found for workspace: ${params.workspaceId}`,
      );
    }

    const targetColumnId = params.columnId ?? "backlog";
    const column = board.columns.find((c) => c.id === targetColumnId);
    if (!column) {
      return errorResult(`Column not found: ${targetColumnId}`);
    }

    const existingTasks = await this.taskStore.listByWorkspace(params.workspaceId);
    const columnTasks = existingTasks.filter(
      (t) => t.boardId === board.id && (t.columnId ?? "backlog") === targetColumnId,
    );
    let position = columnTasks.length;

    // Resolve parent task for codebaseIds inheritance
    let parentTask: Task | undefined;
    if (params.parentTaskId) {
      parentTask = await this.taskStore.get(params.parentTaskId);
      if (!parentTask) {
        return errorResult(`Parent task not found: ${params.parentTaskId}`);
      }
    }

    // Map ref → real taskId for cross-task dependency resolution
    const refToId = new Map<string, string>();

    const createdCards = [];
    for (const item of params.tasks) {
      const taskId = uuidv4();
      if (item.ref) refToId.set(item.ref, taskId);

      // Resolve dependsOn refs → actual task IDs
      const depIds = (item.dependsOn ?? [])
        .map((ref) => refToId.get(ref))
        .filter((id): id is string => id !== undefined);

      const task = createTask({
        id: taskId,
        title: item.title,
        objective: item.description ?? "",
        workspaceId: params.workspaceId,
        boardId: board.id,
        columnId: targetColumnId,
        position: position++,
        status: columnIdToTaskStatus(targetColumnId),
        priority: item.priority as TaskPriority | undefined,
        labels: item.labels,
        assignedProvider: item.assignedProvider,
        scope: item.scope,
        acceptanceCriteria: item.acceptanceCriteria,
        verificationCommands: item.verificationCommands,
        testCases: item.testCases,
        parentTaskId: params.parentTaskId,
        dependencies: depIds,
        codebaseIds: parentTask?.codebaseIds,
      });
      await this.taskStore.save(task);

      // Maintain bidirectional blocking relations for declared dependencies
      if (depIds.length > 0) {
        await updateDependencyRelations(taskId, depIds, this.taskStore);
      }

      await this.triggerCreatedCardAutomation(board, column, task);
      createdCards.push(this.taskToCard(task));
    }
    this.notifyWorkspaceChanged(board.workspaceId, "task", "created");

    return successResult({ count: createdCards.length, cards: createdCards });
  }

  /**
   * Split an existing task into multiple sub-tasks with dependency ordering.
   * Delegates to executeSplit() for topological validation and creation.
   */
  async splitTask(params: {
    parentTaskId: string;
    subTasks: {
      ref: string;
      title: string;
      description?: string;
      scope?: string;
      acceptanceCriteria?: string[];
      verificationCommands?: string[];
      testCases?: string[];
      dependsOn?: string[];
      estimatedFilePaths?: string[];
    }[];
    mergeStrategy?: "cascade" | "fan_in" | "cascade_fan_in";
    boardId?: string;
  }): Promise<ToolResult> {
    const parentTask = await this.taskStore.get(params.parentTaskId);
    if (!parentTask) {
      return errorResult(`Parent task not found: ${params.parentTaskId}`);
    }

    // Build dependency edges from per-task dependsOn
    const dependencyEdges: Array<[string, string]> = [];
    for (const sub of params.subTasks) {
      for (const depRef of sub.dependsOn ?? []) {
        dependencyEdges.push([depRef, sub.ref]);
      }
    }

    const { executeSplit } = await import("../kanban/task-split-orchestrator");
    try {
      const result = await executeSplit(
        parentTask,
        params.subTasks.map((s) => ({
          ref: s.ref,
          title: s.title,
          objective: s.description ?? "",
          scope: s.scope,
          acceptanceCriteria: s.acceptanceCriteria,
          verificationCommands: s.verificationCommands,
          testCases: s.testCases,
          estimatedFilePaths: s.estimatedFilePaths,
        })),
        dependencyEdges,
        { taskStore: this.taskStore, kanbanBoardStore: this.kanbanBoardStore },
        {
          mergeStrategy: params.mergeStrategy,
          boardId: params.boardId ?? parentTask.boardId,
        },
      );

      this.notifyWorkspaceChanged(parentTask.workspaceId, "task", "created");

      return successResult({
        parentTaskId: result.parentTaskId,
        childTaskIds: result.childTaskIds,
        mergeStrategy: result.plan.mergeStrategy,
        warnings: result.warnings,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(message);
    }
  }

  private notifyWorkspaceChanged(
    workspaceId: string,
    entity: "task" | "board" | "column" | "queue",
    action: "created" | "updated" | "deleted" | "moved" | "refreshed",
    resourceId?: string,
  ) {
    this.kanbanBroadcaster.notify({
      workspaceId,
      entity,
      action,
      resourceId,
      source: "agent",
    });
  }

  private taskToCard(task: Task) {
    return {
      id: task.id,
      title: task.title,
      description: task.objective,
      comment: task.comment,
      comments: task.comments,
      status: task.status,
      columnId: task.columnId ?? "backlog",
      position: task.position,
      priority: task.priority,
      labels: task.labels,
      assignee: task.assignee,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      dependencies: task.dependencies,
      dependencyStatus: task.dependencyStatus,
    };
  }

  private async resolveTaskStage(task: Task): Promise<KanbanColumnStage | undefined> {
    const columnId = task.columnId ?? "backlog";
    if (!task.boardId) {
      return normalizeColumnStage(columnId);
    }

    const board = await this.kanbanBoardStore.get(task.boardId);
    return board?.columns.find((column) => column.id === columnId)?.stage ?? normalizeColumnStage(columnId);
  }

  private async promptSession(
    sessionId: string,
    workspaceId: string,
    prompt: string,
  ): Promise<void> {
    const response = await fetch(`${getInternalApiOrigin()}/api/acp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: uuidv4(),
        method: "session/prompt",
        params: {
          sessionId,
          workspaceId,
          prompt: [{ type: "text", text: prompt }],
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`session/prompt HTTP ${response.status}`);
    }

    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
      return;
    }

    await response.arrayBuffer();
  }

  private buildPreviousLaneHandoffPrompt(params: {
    task: Task;
    handoffId: string;
    requestType: TaskLaneHandoffRequestType;
    request: string;
    requestingColumnId?: string;
    requestingSessionId: string;
    worktreeId?: string;
    cwd?: string;
  }): string {
    return [
      `You have received a lane handoff request for card ${params.task.id}: ${params.task.title}.`,
      "",
      `Requesting lane: ${params.requestingColumnId ?? "unknown"}`,
      `Request type: ${this.formatHandoffRequestType(params.requestType)}`,
      `Request: ${params.request}`,
      params.worktreeId ? `Task worktreeId: ${params.worktreeId}` : undefined,
      params.cwd ? `Task cwd: ${params.cwd}` : undefined,
      "",
      "Complete only the requested support work for this card.",
      "If runtime setup or environment preparation is needed, perform it in this session.",
      "Use update_card, provide_artifact, capture_screenshot, or other task-scoped tools as needed.",
      `When done or blocked, call submit_lane_handoff with taskId: "${params.task.id}", handoffId: "${params.handoffId}", and a concise summary.`,
      `This request originated from session ${params.requestingSessionId.slice(0, 8)}.`,
    ].join("\n");
  }

  private buildHandoffResponsePrompt(
    task: Task,
    handoff: NonNullable<ReturnType<typeof getTaskLaneHandoff>>,
  ): string {
    return [
      `Lane handoff update for card ${task.id}: ${task.title}.`,
      "",
      `Request type: ${this.formatHandoffRequestType(handoff.requestType)}`,
      `Status: ${handoff.status}`,
      `Original request: ${handoff.request}`,
      handoff.worktreeId ? `Task worktreeId: ${handoff.worktreeId}` : undefined,
      handoff.cwd ? `Task cwd: ${handoff.cwd}` : undefined,
      handoff.responseSummary ? `Response: ${handoff.responseSummary}` : "Response: no summary provided",
      "",
      "Continue your current lane work using this updated runtime context.",
    ].join("\n");
  }

  private formatHandoffRequestType(requestType: TaskLaneHandoffRequestType): string {
    switch (requestType) {
      case "environment_preparation":
        return "Environment preparation";
      case "runtime_context":
        return "Runtime context";
      case "clarification":
        return "Clarification";
      case "rerun_command":
        return "Rerun command";
      default:
        return requestType;
    }
  }

  private async resolveBoard(workspaceId: string, boardId?: string) {
    if (boardId) {
      const board = await this.kanbanBoardStore.get(boardId);
      if (board?.workspaceId === workspaceId) {
        return board;
      }
    }

    return await this.kanbanBoardStore.getDefault(workspaceId);
  }

  private async triggerCreatedCardAutomation(
    board: { id: string; workspaceId: string },
    column: KanbanColumn,
    task: Task,
  ): Promise<void> {
    if (!column.automation?.enabled) {
      return;
    }

    if (this.automationSystem && this.isAutomationSystemCompatible()) {
      const orchestratorModule = await import("../kanban/workflow-orchestrator-singleton");
      orchestratorModule.startWorkflowOrchestrator(this.automationSystem);
      const result = await orchestratorModule.enqueueKanbanTaskSession(this.automationSystem, {
        task,
        expectedColumnId: column.id,
      });
      if (result.error) {
        console.warn(`[KanbanTools] Failed to enqueue automation for card ${task.id}: ${result.error}`);
      }
    }

    if (!this.eventBus) {
      return;
    }

    emitColumnTransition(this.eventBus, {
      cardId: task.id,
      cardTitle: task.title,
      boardId: board.id,
      workspaceId: board.workspaceId,
      fromColumnId: "__created__",
      toColumnId: column.id,
      fromColumnName: "Created",
      toColumnName: column.name,
    });
  }

  private isAutomationSystemCompatible(): boolean {
    return Boolean(
      this.automationSystem
      && this.automationSystem.taskStore === this.taskStore
      && this.automationSystem.kanbanBoardStore === this.kanbanBoardStore,
    );
  }

  private async recordTaskMoveBlockComment(
    task: Task,
    message: string,
    sessionId?: string,
  ): Promise<void> {
    const note = `Move blocked: ${message}`.trim();
    const lastComment = task.comments?.[task.comments.length - 1]?.body?.trim();
    if (lastComment === note) {
      return;
    }

    task.comment = appendTaskComment(task.comment, note);
    task.comments = appendTaskCommentEntry(task.comments, note, {
      sessionId,
      source: undefined,
    });
    task.updatedAt = new Date();
    await this.taskStore.save(task);
    this.notifyWorkspaceChanged(task.workspaceId, "task", "updated", task.id);
  }

  private async recordTaskContractGateFailure(
    task: Task,
    message: string,
    targetColumnName: string,
    threshold: number,
    sessionId?: string,
  ): Promise<void> {
    const note = buildContractGateNote(message);
    let changed = true;

    task.comment = appendTaskComment(task.comment, note);
    task.comments = appendTaskCommentEntry(task.comments, note, {
      sessionId,
      source: undefined,
    });

    const failureCount = countContractGateFailures(task);
    if (failureCount >= threshold) {
      const nextLabels = Array.from(new Set([...(task.labels ?? []), CONTRACT_GATE_BLOCKED_LABEL]));
      const nextMessage = buildContractLoopBreakerMessage(targetColumnName, failureCount, threshold);
      if (task.lastSyncError !== nextMessage) {
        task.lastSyncError = nextMessage;
        changed = true;
      }
      if (nextLabels.length !== (task.labels ?? []).length) {
        task.labels = nextLabels;
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    task.updatedAt = new Date();
    await this.taskStore.save(task);
    this.notifyWorkspaceChanged(task.workspaceId, "task", "updated", task.id);
  }
}

function normalizeColumnStage(columnId?: string): KanbanColumnStage | undefined {
  switch ((columnId ?? "backlog").toLowerCase()) {
    case "backlog":
    case "todo":
    case "dev":
    case "review":
    case "blocked":
    case "done":
    case "archived":
      return (columnId ?? "backlog").toLowerCase() as KanbanColumnStage;
    default:
      return undefined;
  }
}
