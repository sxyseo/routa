import { performance } from "node:perf_hooks";
import { metricsCollector } from "./performance-metrics";
import type { RoutaSystem } from "../routa-system";

const STORE_SLOW_THRESHOLD_MS = 200;

/** 用 Proxy 包装单个 Store 实例，拦截所有异步方法调用 */
export function decorateStoreWithTiming<T extends object>(
  store: T,
  storeName: string,
): T {
  const threshold = Number(process.env.ROUTA_STORE_SLOW_THRESHOLD_MS) || STORE_SLOW_THRESHOLD_MS;

  return new Proxy(store, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function") {
        return original;
      }

      return function (this: unknown, ...args: unknown[]) {
        const method = String(prop);
        const start = performance.now();

        const tryRecord = (durationMs: number) => {
          metricsCollector.recordStoreTiming({
            timestamp: new Date().toISOString(),
            storeName,
            method,
            durationMs: Math.round(durationMs * 10) / 10,
          });

          if (durationMs >= threshold) {
            console.warn(`[store:slow] ${storeName}.${method} took ${durationMs.toFixed(1)}ms`);
          }
        };

        try {
          const result = original.apply(this === receiver ? target : this, args);

          if (result && typeof result === "object" && typeof (result as Promise<unknown>).then === "function") {
            return (result as Promise<unknown>).then((resolved: unknown) => {
              tryRecord(performance.now() - start);
              return resolved;
            }, (error: unknown) => {
              tryRecord(performance.now() - start);
              throw error;
            });
          }

          tryRecord(performance.now() - start);
          return result;
        } catch (error) {
          tryRecord(performance.now() - start);
          throw error;
        }
      };
    },
  });
}

/** 包装整个 RoutaSystem 的所有 Store */
export function decorateSystemWithTiming(system: RoutaSystem): RoutaSystem {
  if (process.env.ROUTA_STORE_TIMING !== "1") {
    return system;
  }

  const storeKeys: (keyof RoutaSystem)[] = [
    "agentStore",
    "conversationStore",
    "taskStore",
    "noteStore",
    "workspaceStore",
    "codebaseStore",
    "worktreeStore",
    "backgroundTaskStore",
    "scheduleStore",
    "workflowRunStore",
    "kanbanBoardStore",
    "artifactStore",
    "permissionStore",
  ];

  const decorated = { ...system };
  for (const key of storeKeys) {
    const store = system[key];
    if (store && typeof store === "object") {
      (decorated as Record<string, unknown>)[key] = decorateStoreWithTiming(
        store as object,
        key,
      );
    }
  }

  return decorated;
}
