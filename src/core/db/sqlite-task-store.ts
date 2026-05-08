import { and, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./sqlite-schema";
import { normalizeTaskCreationSource } from "../kanban/task-creation-policy";
import { hydrateTaskComments, type Task, type TaskStatus } from "../models/task";
import type { TaskStore } from "../store/task-store";

type SqliteDb = BetterSQLite3Database<typeof sqliteSchema>;

export class SqliteTaskStore implements TaskStore {
  constructor(private db: SqliteDb) {}

  async save(task: Task): Promise<void> {
    const version = (task as Task & { version?: number }).version ?? 1;
    await this.db
      .insert(sqliteSchema.tasks)
      .values({
        id: task.id,
        title: task.title,
        objective: task.objective,
        comment: task.comment,
        comments: task.comments ?? [],
        scope: task.scope,
        acceptanceCriteria: task.acceptanceCriteria,
        verificationCommands: task.verificationCommands,
        testCases: task.testCases,
        assignedTo: task.assignedTo,
        status: task.status,
        boardId: task.boardId,
        columnId: task.columnId,
        position: task.position,
        priority: task.priority,
        labels: task.labels,
        assignee: task.assignee,
        assignedProvider: task.assignedProvider,
        assignedRole: task.assignedRole,
        assignedSpecialistId: task.assignedSpecialistId,
        assignedSpecialistName: task.assignedSpecialistName,
        fallbackAgentChain: task.fallbackAgentChain,
        enableAutomaticFallback: task.enableAutomaticFallback,
        maxFallbackAttempts: task.maxFallbackAttempts,
        triggerSessionId: task.triggerSessionId,
        sessionIds: task.sessionIds ?? [],
        laneSessions: task.laneSessions ?? [],
        laneHandoffs: task.laneHandoffs ?? [],
        vcsId: task.vcsId,
        vcsNumber: task.vcsNumber,
        vcsUrl: task.vcsUrl,
        vcsRepo: task.vcsRepo,
        vcsState: task.vcsState,
        vcsSyncedAt: task.vcsSyncedAt,
        lastSyncError: task.lastSyncError,
        isPullRequest: task.isPullRequest,
        pullRequestUrl: task.pullRequestUrl ?? null,
        pullRequestMergedAt: task.pullRequestMergedAt ?? null,
        dependencies: task.dependencies,
        blocking: task.blocking ?? [],
        dependencyStatus: task.dependencyStatus,
        parentTaskId: task.parentTaskId,
        parallelGroup: task.parallelGroup,
        workspaceId: task.workspaceId,
        sessionId: task.sessionId,
        creationSource: task.creationSource,
        codebaseIds: task.codebaseIds ?? [],
        worktreeId: task.worktreeId,
        deliverySnapshot: task.deliverySnapshot,
        completionSummary: task.completionSummary,
        verificationVerdict: task.verificationVerdict,
        verificationReport: task.verificationReport,
        version,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })
      .onConflictDoUpdate({
        target: sqliteSchema.tasks.id,
        set: {
          title: task.title,
          objective: task.objective,
          comment: task.comment,
          comments: task.comments ?? [],
          scope: task.scope,
          acceptanceCriteria: task.acceptanceCriteria,
          verificationCommands: task.verificationCommands,
          testCases: task.testCases,
          assignedTo: task.assignedTo,
          status: task.status,
          boardId: task.boardId,
          columnId: task.columnId,
          position: task.position,
          priority: task.priority,
          labels: task.labels,
          assignee: task.assignee,
          assignedProvider: task.assignedProvider,
          assignedRole: task.assignedRole,
          assignedSpecialistId: task.assignedSpecialistId,
          assignedSpecialistName: task.assignedSpecialistName,
          fallbackAgentChain: task.fallbackAgentChain,
          enableAutomaticFallback: task.enableAutomaticFallback,
          maxFallbackAttempts: task.maxFallbackAttempts,
          triggerSessionId: task.triggerSessionId ?? null,
          sessionIds: task.sessionIds ?? [],
          laneSessions: task.laneSessions ?? [],
          laneHandoffs: task.laneHandoffs ?? [],
          vcsId: task.vcsId,
          vcsNumber: task.vcsNumber,
          vcsUrl: task.vcsUrl,
          vcsRepo: task.vcsRepo,
          vcsState: task.vcsState,
          vcsSyncedAt: task.vcsSyncedAt,
          lastSyncError: task.lastSyncError ?? null,
          isPullRequest: task.isPullRequest,
          pullRequestUrl: task.pullRequestUrl ?? null,
          pullRequestMergedAt: task.pullRequestMergedAt ?? null,
          dependencies: task.dependencies,
          blocking: task.blocking ?? [],
          dependencyStatus: task.dependencyStatus,
          parentTaskId: task.parentTaskId,
          parallelGroup: task.parallelGroup,
          sessionId: task.sessionId,
          creationSource: task.creationSource,
          codebaseIds: task.codebaseIds ?? [],
          worktreeId: task.worktreeId,
          deliverySnapshot: task.deliverySnapshot,
          completionSummary: task.completionSummary,
          verificationVerdict: task.verificationVerdict,
          verificationReport: task.verificationReport,
          version: sql`${sqliteSchema.tasks.version} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  async get(taskId: string): Promise<Task | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.tasks)
      .where(eq(sqliteSchema.tasks.id, taskId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.tasks)
      .where(eq(sqliteSchema.tasks.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async listByStatus(workspaceId: string, status: TaskStatus): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.tasks)
      .where(and(eq(sqliteSchema.tasks.workspaceId, workspaceId), eq(sqliteSchema.tasks.status, status)));
    return rows.map(this.toModel);
  }

  async listByAssignee(agentId: string): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.tasks)
      .where(eq(sqliteSchema.tasks.assignedTo, agentId));
    return rows.map(this.toModel);
  }

  async findReadyTasks(workspaceId: string): Promise<Task[]> {
    const allTasks = await this.listByWorkspace(workspaceId);
    const taskMap = new Map(allTasks.map((task) => [task.id, task]));

    return allTasks.filter((task) => {
      if (task.status !== "PENDING") return false;
      return task.dependencies.every((depId) => {
        const dependency = taskMap.get(depId);
        return dependency && dependency.status === "COMPLETED";
      });
    });
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.db
      .update(sqliteSchema.tasks)
      .set({
        status,
        updatedAt: new Date(),
        version: sql`${sqliteSchema.tasks.version} + 1`,
      })
      .where(eq(sqliteSchema.tasks.id, taskId));
  }

  async delete(taskId: string): Promise<void> {
    await this.db.delete(sqliteSchema.tasks).where(eq(sqliteSchema.tasks.id, taskId));
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const result = this.db
      .delete(sqliteSchema.tasks)
      .where(eq(sqliteSchema.tasks.workspaceId, workspaceId))
      .run();
    return Number(result.changes ?? 0);
  }

  async atomicUpdate(
    taskId: string,
    expectedVersion: number,
    updates: Partial<
      Pick<
        Task,
        | "status"
        | "columnId"
        | "triggerSessionId"
        | "completionSummary"
        | "verificationVerdict"
        | "verificationReport"
        | "assignedTo"
        | "lastSyncError"
        | "pullRequestUrl"
        | "pullRequestMergedAt"
        | "laneSessions"
        | "updatedAt"
      >
    >,
  ): Promise<boolean> {
    // Drizzle ORM treats `undefined` as "skip this field" rather than "set to NULL".
    // Convert undefined values to null so clearing fields (e.g. lastSyncError) works.
    const sanitized = Object.fromEntries(
      Object.entries(updates).map(([k, v]) => [k, v === undefined ? null : v]),
    ) as typeof updates;
    const result = this.db
      .update(sqliteSchema.tasks)
      .set({
        ...sanitized,
        version: sql`${sqliteSchema.tasks.version} + 1`,
        // Only bump updatedAt if the caller did not explicitly provide one.
        // This preserves the caller's intent (e.g. clearStaleTriggerSession's
        // skipUpdatedAtBump for COMPLETED+PR tasks).
        ...("updatedAt" in sanitized ? {} : { updatedAt: new Date() }),
      })
      .where(and(eq(sqliteSchema.tasks.id, taskId), eq(sqliteSchema.tasks.version, expectedVersion)))
      .run();

    return (result?.changes ?? 0) > 0;
  }

  private toModel(row: typeof sqliteSchema.tasks.$inferSelect): Task {
    const comments = hydrateTaskComments(
      row.comments as import("../models/task").TaskCommentEntry[] | undefined,
      row.comment ?? undefined,
    );

    return {
      id: row.id,
      title: row.title,
      objective: row.objective,
      comment: row.comment ?? undefined,
      comments,
      scope: row.scope ?? undefined,
      acceptanceCriteria: (row.acceptanceCriteria as string[]) ?? undefined,
      verificationCommands: (row.verificationCommands as string[]) ?? undefined,
      testCases: (row.testCases as string[]) ?? undefined,
      assignedTo: row.assignedTo ?? undefined,
      status: row.status as TaskStatus,
      boardId: row.boardId ?? undefined,
      columnId: row.columnId ?? undefined,
      position: row.position,
      priority: row.priority as import("../models/task").TaskPriority | undefined,
      labels: (row.labels as string[]) ?? [],
      assignee: row.assignee ?? undefined,
      assignedProvider: row.assignedProvider ?? undefined,
      assignedRole: row.assignedRole ?? undefined,
      assignedSpecialistId: row.assignedSpecialistId ?? undefined,
      assignedSpecialistName: row.assignedSpecialistName ?? undefined,
      fallbackAgentChain: (row.fallbackAgentChain as import("../models/task").FallbackAgent[]) ?? undefined,
      enableAutomaticFallback: row.enableAutomaticFallback ?? undefined,
      maxFallbackAttempts: row.maxFallbackAttempts ?? undefined,
      triggerSessionId: row.triggerSessionId ?? undefined,
      sessionIds: (row.sessionIds as string[]) ?? [],
      laneSessions: (row.laneSessions as import("../models/task").TaskLaneSession[]) ?? [],
      laneHandoffs: (row.laneHandoffs as import("../models/task").TaskLaneHandoff[]) ?? [],
      vcsId: row.vcsId ?? undefined,
      vcsNumber: row.vcsNumber ?? undefined,
      vcsUrl: row.vcsUrl ?? undefined,
      vcsRepo: row.vcsRepo ?? undefined,
      vcsState: row.vcsState ?? undefined,
      vcsSyncedAt: row.vcsSyncedAt ?? undefined,
      lastSyncError: row.lastSyncError ?? undefined,
      isPullRequest: row.isPullRequest ?? undefined,
      pullRequestUrl: row.pullRequestUrl ?? undefined,
      pullRequestMergedAt: row.pullRequestMergedAt ?? undefined,
      dependencies: (row.dependencies as string[]) ?? [],
      blocking: (row.blocking as string[]) ?? [],
      dependencyStatus: (row.dependencyStatus as "clear" | "blocked") ?? undefined,
      parentTaskId: row.parentTaskId ?? undefined,
      parallelGroup: row.parallelGroup ?? undefined,
      workspaceId: row.workspaceId,
      sessionId: row.sessionId ?? undefined,
      creationSource: normalizeTaskCreationSource(row.creationSource, {
        sessionId: row.sessionId,
      }),
      codebaseIds: (row.codebaseIds as string[]) ?? [],
      worktreeId: row.worktreeId ?? undefined,
      deliverySnapshot: row.deliverySnapshot as import("../models/task").TaskDeliverySnapshot | undefined,
      completionSummary: row.completionSummary ?? undefined,
      verificationVerdict: row.verificationVerdict as import("../models/task").VerificationVerdict | undefined,
      verificationReport: row.verificationReport ?? undefined,
      version: row.version ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
