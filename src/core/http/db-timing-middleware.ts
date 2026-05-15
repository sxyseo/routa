import { performance } from "node:perf_hooks";
import { metricsCollector } from "./performance-metrics";

const DB_SLOW_THRESHOLD_MS = 100;

/**
 * Wrap a better-sqlite3 Database instance to time every prepared statement execution.
 * This works at the driver level — below Drizzle — so it catches all queries.
 */
export function withSqliteTiming<T extends object>(sqlite: T, driverName = "sqlite"): T {
  if (process.env.ROUTA_DB_TIMING !== "1") {
    return sqlite;
  }

  const threshold = Number(process.env.ROUTA_DB_SLOW_THRESHOLD_MS) || DB_SLOW_THRESHOLD_MS;
  const sqliteAny = sqlite as Record<string, unknown>;

  const originalPrepare = sqliteAny.prepare as (...args: unknown[]) => unknown;
  if (typeof originalPrepare !== "function") {
    return sqlite;
  }

  sqliteAny.prepare = function (...args: unknown[]) {
    const stmt = originalPrepare.apply(sqliteAny, args) as Record<string, unknown>;
    const sql = typeof args[0] === "string" ? args[0] : String(args[0]);

    // Wrap the execution methods on the statement
    for (const method of ["run", "get", "all"]) {
      const originalFn = stmt[method];
      if (typeof originalFn !== "function") continue;

      stmt[method] = function (...fnArgs: unknown[]) {
        const start = performance.now();
        try {
          const result = (originalFn as (...a: unknown[]) => unknown).apply(stmt, fnArgs);
          const durationMs = performance.now() - start;
          recordTiming(driverName, `${method}:${sql.slice(0, 60)}`, durationMs, threshold);
          return result;
        } catch (error) {
          const durationMs = performance.now() - start;
          recordTiming(driverName, `${method}:${sql.slice(0, 60)}`, durationMs, threshold);
          throw error;
        }
      };
    }

    return stmt;
  };

  return sqlite;
}

/**
 * Wrap a Postgres client to time queries.
 * Intercepts the `query` or underlying query execution.
 */
export function withPostgresTiming<T extends object>(client: T, _driverName = "pg"): T {
  if (process.env.ROUTA_DB_TIMING !== "1") {
    return client;
  }

  const _threshold = Number(process.env.ROUTA_DB_SLOW_THRESHOLD_MS) || DB_SLOW_THRESHOLD_MS;
  const _clientAny = client as Record<string, unknown>;

  // postgres-js uses .unsafe() / internal query methods
  // Neon uses HTTP, so timing is captured at the Drizzle level
  // For now, we rely on Store timing to cover Postgres query performance
  // This can be extended later with Drizzle middleware when available

  return client;
}

function recordTiming(driver: string, operation: string, durationMs: number, threshold: number): void {
  metricsCollector.recordDbTiming({
    timestamp: new Date().toISOString(),
    driver,
    operation,
    durationMs: Math.round(durationMs * 10) / 10,
  });

  if (durationMs >= threshold) {
    console.warn(`[db:slow] ${driver}.${operation} took ${durationMs.toFixed(1)}ms`);
  }
}
