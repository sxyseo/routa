/**
 * Store Dedup Proxy — Promise coalescing + TTL cache for read-heavy store methods.
 *
 * Wraps store instances so concurrent identical read queries within a short TTL
 * window share a single underlying Promise instead of each firing an independent
 * database call. Write methods immediately invalidate the store's cache.
 *
 * Layer order: raw store → timing proxy → dedup proxy
 * (timing measures real DB latency; dedup coalesces redundant calls)
 */

import type { RoutaSystem } from "../routa-system";

const LIST_TTL_MS = 2_000;
const DEFAULT_TTL_MS = 3_000;
const MAX_CACHE_SIZE = 100;

const decoratedStores = new WeakSet<object>();
const decoratedSystems = new WeakSet<object>();

const READ_PREFIXES = ["list", "get", "find", "count", "getDefault"] as const;
const WRITE_PREFIXES = [
  "save", "update", "delete", "remove", "set",
  "add", "clear", "append", "create",
] as const;

interface CacheEntry {
  promise: Promise<unknown>;
  createdAt: number;
}

function isReadMethod(method: string): boolean {
  return (READ_PREFIXES as readonly string[]).some(p => method.startsWith(p));
}

function isWriteMethod(method: string): boolean {
  return (WRITE_PREFIXES as readonly string[]).some(p => method.startsWith(p));
}

function buildCacheKey(method: string, args: unknown[]): string {
  if (args.length === 0) return method;
  return `${method}(${JSON.stringify(args)})`;
}

function getTtl(method: string): number {
  return method.startsWith("list") ? LIST_TTL_MS : DEFAULT_TTL_MS;
}

function sweepExpired(cache: Map<string, CacheEntry>, now: number): void {
  for (const [k, v] of cache) {
    if (now - v.createdAt >= DEFAULT_TTL_MS) cache.delete(k);
  }
}

export function decorateStoreWithDedup<T extends object>(
  store: T,
  storeName: string,
): T {
  if (decoratedStores.has(store)) return store;

  const cache = new Map<string, CacheEntry>();

  const proxy = new Proxy(store, {
    get(target, prop) {
      const original = target[prop as keyof T];
      if (typeof original !== "function") return original;
      const method = String(prop);

      return function (this: unknown, ...args: unknown[]) {
        // Write: clear cache, call through
        if (isWriteMethod(method)) {
          cache.clear();
          return original.apply(target, args);
        }

        // Non-read: pass through
        if (!isReadMethod(method)) return original.apply(target, args);

        // Read: dedup/coalesce
        const key = buildCacheKey(method, args);
        const ttl = getTtl(method);
        const now = Date.now();

        const existing = cache.get(key);
        if (existing && now - existing.createdAt < ttl) {
          return existing.promise;
        }

        // Evict stale entries when cache grows large
        if (cache.size >= MAX_CACHE_SIZE) sweepExpired(cache, now);

        const promise = original.apply(target, args) as Promise<unknown>;
        cache.set(key, { promise, createdAt: now });

        // Remove on rejection so next caller retries
        if (promise && typeof promise === "object" && typeof promise.catch === "function") {
          promise.catch(() => { cache.delete(key); });
        }

        return promise;
      };
    },
  });

  decoratedStores.add(proxy);
  return proxy;
}

export function decorateSystemWithDedup(system: RoutaSystem): RoutaSystem {
  if (process.env.ROUTA_STORE_DEDUP === "0") return system;
  if (decoratedSystems.has(system as object)) return system;

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
      (decorated as Record<string, unknown>)[key] = decorateStoreWithDedup(
        store as object,
        key,
      );
    }
  }

  decoratedSystems.add(decorated);
  return decorated;
}
