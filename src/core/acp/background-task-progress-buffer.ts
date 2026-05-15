/**
 * BackgroundTaskProgressBuffer — Batched, debounced persistence for background task progress.
 *
 * Instead of writing every SSE notification's progress to DB immediately,
 * this buffer accumulates updates in memory and flushes them when:
 * - A debounce timer fires (500ms)
 * - The caller requests an explicit flush (session cleanup / shutdown)
 *
 * Task completion (turn_complete) bypasses this buffer entirely and writes
 * directly to DB to ensure reliability.
 *
 * Pattern follows SessionWriteBuffer (session-write-buffer.ts).
 */

import { getRoutaSystem } from "../routa-system";

export interface PendingTaskProgress {
  taskId: string;
  taskOutput?: string;
  outputDirty: boolean;
  lastActivity: Date;
  currentActivity?: string;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ProgressAccumulateData {
  taskOutput?: string;
  outputDirty: boolean;
  currentActivity?: string;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
}

export class BackgroundTaskProgressBuffer {
  private pending = new Map<string, PendingTaskProgress>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private flushPromises = new Map<string, Promise<void>>();

  static readonly DEBOUNCE_MS = 500;

  accumulate(sessionId: string, taskId: string, data: ProgressAccumulateData): void {
    const existing = this.pending.get(sessionId);
    if (existing) {
      if (data.taskOutput !== undefined && data.outputDirty) {
        existing.taskOutput = data.taskOutput;
        existing.outputDirty = true;
      }
      existing.lastActivity = new Date();
      if (data.currentActivity !== undefined) {
        existing.currentActivity = data.currentActivity;
      }
      existing.toolCallCount = data.toolCallCount;
      existing.inputTokens = data.inputTokens;
      existing.outputTokens = data.outputTokens;
    } else {
      this.pending.set(sessionId, {
        taskId,
        taskOutput: data.outputDirty ? data.taskOutput : undefined,
        outputDirty: data.outputDirty,
        lastActivity: new Date(),
        currentActivity: data.currentActivity,
        toolCallCount: data.toolCallCount,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
      });
    }
    this.resetTimer(sessionId);
  }

  async flush(sessionId: string): Promise<void> {
    this.clearTimer(sessionId);
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    this.pending.delete(sessionId);

    const prev = this.flushPromises.get(sessionId) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        const system = getRoutaSystem();
        if (entry.outputDirty && entry.taskOutput !== undefined) {
          await system.backgroundTaskStore.updateTaskOutput(entry.taskId, entry.taskOutput);
        }
        await system.backgroundTaskStore.updateProgress(entry.taskId, {
          lastActivity: entry.lastActivity,
          currentActivity: entry.currentActivity,
          toolCallCount: entry.toolCallCount,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
        });
      } catch {
        // Progress tracking is best-effort
      }
    });
    this.flushPromises.set(sessionId, next);
    try {
      await next;
    } catch {
      // Swallow — flush error must not propagate
    }
  }

  async flushAll(): Promise<void> {
    const sessionIds = [...this.pending.keys()];
    await Promise.allSettled(sessionIds.map((id) => this.flush(id)));
  }

  dispose(sessionId: string): void {
    this.clearTimer(sessionId);
    this.pending.delete(sessionId);
    this.flushPromises.delete(sessionId);
  }

  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  private resetTimer(sessionId: string): void {
    this.clearTimer(sessionId);
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.flush(sessionId);
    }, BackgroundTaskProgressBuffer.DEBOUNCE_MS);
    this.timers.set(sessionId, timer);
  }

  private clearTimer(sessionId: string): void {
    const existing = this.timers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(sessionId);
    }
  }

  disposeAll(): void {
    for (const sessionId of [...this.pending.keys()]) {
      this.dispose(sessionId);
    }
  }
}
