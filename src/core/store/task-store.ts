/**
 * TaskStore - port of routa-core TaskStore.kt
 *
 * In-memory storage for tasks and their lifecycle.
 */

import { hydrateTaskComments, Task, TaskStatus } from "../models/task";

export interface TaskStore {
  save(task: Task): Promise<void>;
  get(taskId: string): Promise<Task | undefined>;
  listByWorkspace(workspaceId: string): Promise<Task[]>;
  listByStatus(workspaceId: string, status: TaskStatus): Promise<Task[]>;
  listByAssignee(agentId: string): Promise<Task[]>;
  findReadyTasks(workspaceId: string): Promise<Task[]>;
  updateStatus(taskId: string, status: TaskStatus): Promise<void>;
  delete(taskId: string): Promise<void>;
  deleteByWorkspace(workspaceId: string): Promise<number>;
  findByPullRequestUrl?(url: string): Promise<Task | undefined>;
  /**
   * Atomically update a task using optimistic locking.
   * Returns true if the row was updated (version matched), false if version conflict.
   * Implementations that don't support locking should fall back to unconditional save.
   */
  atomicUpdate?(
    taskId: string,
    expectedVersion: number,
    updates: Partial<Pick<Task, "status" | "columnId" | "triggerSessionId" | "completionSummary" | "verificationVerdict" | "verificationReport" | "assignedTo" | "lastSyncError" | "laneSessions" | "updatedAt" | "pullRequestMergedAt" | "pullRequestUrl" | "isPullRequest" | "worktreeId" | "comment" | "dependencyStatus">>,
  ): Promise<boolean>;
}

export class InMemoryTaskStore implements TaskStore {
  private tasks = new Map<string, Task>();

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, { ...task });
  }

  async get(taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task ? this.hydrateTask(task) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.workspaceId === workspaceId)
      .map((task) => this.hydrateTask(task));
  }

  async listByStatus(
    workspaceId: string,
    status: TaskStatus
  ): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.workspaceId === workspaceId && t.status === status)
      .map((task) => this.hydrateTask(task));
  }

  async listByAssignee(agentId: string): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.assignedTo === agentId)
      .map((task) => this.hydrateTask(task));
  }

  async findReadyTasks(workspaceId: string): Promise<Task[]> {
    const allTasks = await this.listByWorkspace(workspaceId);
    return allTasks.filter((task) => {
      if (task.status !== TaskStatus.PENDING) return false;
      // Check all dependencies are completed
      return task.dependencies.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === TaskStatus.COMPLETED;
      });
    });
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = new Date();
    }
  }

  async delete(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    let deleted = 0;
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.workspaceId !== workspaceId) continue;
      this.tasks.delete(taskId);
      deleted += 1;
    }
    return deleted;
  }

  async findByPullRequestUrl(url: string): Promise<Task | undefined> {
    for (const task of this.tasks.values()) {
      if (task.pullRequestUrl === url || task.vcsUrl === url) {
        return this.hydrateTask(task);
      }
    }
    return undefined;
  }

  async atomicUpdate(
    taskId: string,
    expectedVersion: number,
    updates: Partial<Pick<Task, "status" | "columnId" | "triggerSessionId" | "completionSummary" | "verificationVerdict" | "verificationReport" | "assignedTo" | "lastSyncError" | "laneSessions" | "updatedAt" | "pullRequestMergedAt" | "pullRequestUrl" | "isPullRequest" | "worktreeId" | "comment" | "dependencyStatus">>,
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || (task.version ?? 1) !== expectedVersion) return false;
    Object.assign(task, updates);
    task.version = (task.version ?? 1) + 1;
    // Only bump updatedAt if the caller did not explicitly omit it.
    if (!("updatedAt" in updates)) task.updatedAt = new Date();
    return true;
  }

  private hydrateTask(task: Task): Task {
    return {
      ...task,
      comments: hydrateTaskComments(task.comments, task.comment),
    };
  }
}
