/**
 * Atomic Task Update — shared optimistic-locking save utility.
 *
 * Extracted from kanban-lane-scanner.ts for reuse across pr-auto-create,
 * done-lane-recovery, fan-in-merge, and other kanban modules.
 *
 * Handles:
 *   - Drizzle ORM `undefined` → `null` conversion (so clearing fields works)
 *   - Optimistic locking via `atomicUpdate` with 1 retry on version conflict
 *   - Fallback to `save()` for stores that lack `atomicUpdate`
 */

import type { Task } from "../models/task";
import type { TaskStore } from "../store/task-store";

type AtomicUpdateFields = Parameters<NonNullable<TaskStore["atomicUpdate"]>>[2];

/**
 * Atomically save task fields using optimistic locking.
 *
 * @param task    The task snapshot (must include `.id` and optionally `.version`).
 * @param store   The TaskStore instance.
 * @param fields  Fields to update (undefined values are converted to null).
 * @param logLabel  Label for log messages.
 * @returns `true` if saved successfully, `false` if the task was deleted or
 *          version conflict persisted after retry.
 */
export async function safeAtomicSave(
  task: Task,
  store: TaskStore,
  fields: AtomicUpdateFields,
  logLabel: string,
): Promise<boolean> {
  // Drizzle ORM treats `undefined` as "skip this field" rather than "set to NULL".
  const sanitizedFields = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, v === undefined ? null : v]),
  ) as AtomicUpdateFields;

  if (task.version !== undefined && store.atomicUpdate) {
    const ok = await store.atomicUpdate(task.id, task.version, sanitizedFields);
    if (!ok) {
      const fresh = await store.get(task.id);
      if (!fresh) {
        console.log(`[${logLabel}] Card ${task.id} deleted during ${logLabel}. Skipping.`);
        return false;
      }
      if (fresh.version !== undefined && store.atomicUpdate) {
        const retryOk = await store.atomicUpdate(fresh.id, fresh.version, sanitizedFields);
        if (!retryOk) {
          console.warn(
            `[${logLabel}] Version conflict persisted after retry for card ${task.id} during ${logLabel}. Skipping.`,
          );
          return false;
        }
        task.version = fresh.version;
        return true;
      }
      await store.save({ ...fresh, ...sanitizedFields });
      return true;
    }
    return true;
  }
  await store.save({ ...task, ...sanitizedFields });
  return true;
}

export type { AtomicUpdateFields };
