/**
 * System Heartbeat Registry — singleton that tracks the health of all
 * system-level background ticks.
 *
 * Provides tickStarted/tickFinished wrappers that record execution history
 * in SQLite (system_job_runs table) and maintain an in-memory status for
 * each registered job. DB failures are silently swallowed so the registry
 * never interferes with normal tick operation.
 */

import { sql } from "drizzle-orm";
import type { SqliteDatabase } from "../db/sqlite";

// ─── Types ──────────────────────────────────────────────────────────

export interface SystemJobMeta {
  id: string;
  name: string;
  description: string;
  group: string;
  interval: string;
}

export type JobRunStatus = "running" | "success" | "error";

export interface SystemJobRun {
  id: string;
  jobId: string;
  status: JobRunStatus;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface SystemJobStatus extends SystemJobMeta {
  lastStatus: JobRunStatus | "idle";
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  recentRuns: SystemJobRun[];
}

// ─── Job Definitions ────────────────────────────────────────────────

/** Built-in jobs registered at module load. */
const builtinJobs: SystemJobMeta[] = [
  {
    id: "schedule-tick",
    name: "Schedule Tick",
    description: "Fires due user-defined schedules as background tasks",
    group: "scheduler",
    interval: "* * * * *",
  },
  {
    id: "auto-archive-tick",
    name: "Auto-Archive Tick",
    description: "Archives stale done cards to the archived column",
    group: "scheduler",
    interval: "0 * * * *",
  },
  {
    id: "done-lane-recovery-tick",
    name: "Done-Lane Recovery Tick",
    description: "Detects and recovers stuck tasks in done lane",
    group: "scheduler",
    interval: "*/10 * * * *",
  },
  {
    id: "kanban-lane-scanner",
    name: "Kanban Lane Scanner",
    description: "Scans kanban lanes for tasks needing automation triggers",
    group: "kanban",
    interval: "30s",
  },
  {
    id: "watchdog-scanner",
    name: "Watchdog Scanner",
    description: "Monitors active sessions for timeout and recovery",
    group: "kanban",
    interval: "30s",
  },
  {
    id: "overseer-health-tick",
    name: "Overseer Health Tick",
    description: "Smart monitoring: auto-fixes stale sessions, orphan worktrees, and escalates critical issues",
    group: "overseer",
    interval: "*/5 * * * *",
  },
];

// ─── Health Rules ───────────────────────────────────────────────────

export interface HealthRule {
  /** Consecutive failures before alerting. */
  consecutiveFailThreshold: number;
  /** Minimum duration (ms) between repeated alerts for the same job. */
  alertCooldownMs: number;
}

const DEFAULT_HEALTH_RULE: HealthRule = {
  consecutiveFailThreshold: 3,
  alertCooldownMs: 5 * 60 * 1000,
};

const MAX_RUNS_PER_JOB = 100;
const GLOBAL_KEY = "__routa_system_heartbeat_registry__";

// ─── In-Memory State ────────────────────────────────────────────────

interface JobState {
  meta: SystemJobMeta;
  lastStatus: JobRunStatus | "idle";
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastAlertAt: number | null;
}

function createRegistryState(): Map<string, JobState> {
  const map = new Map<string, JobState>();
  for (const meta of builtinJobs) {
    map.set(meta.id, { meta, lastStatus: "idle", lastStartedAt: null, lastFinishedAt: null, lastDurationMs: null, lastError: null, consecutiveFailures: 0, lastAlertAt: null });
  }
  return map;
}

function getRegistry(): Map<string, JobState> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createRegistryState();
    const ids = [...(g[GLOBAL_KEY] as Map<string, JobState>).keys()];
    console.log(`[HeartbeatRegistry] Registered ${ids.length} system jobs: ${ids.join(", ")}`);
  }
  return g[GLOBAL_KEY] as Map<string, JobState>;
}

// ─── Dynamic Registration ───────────────────────────────────────────

export function registerJob(meta: SystemJobMeta): void {
  const registry = getRegistry();
  if (registry.has(meta.id)) return;
  registry.set(meta.id, { meta, lastStatus: "idle", lastStartedAt: null, lastFinishedAt: null, lastDurationMs: null, lastError: null, consecutiveFailures: 0, lastAlertAt: null });
  console.log(`[HeartbeatRegistry] Registered dynamic job: ${meta.id}`);
}

export function unregisterJob(jobId: string): void {
  const registry = getRegistry();
  if (registry.delete(jobId)) {
    console.log(`[HeartbeatRegistry] Unregistered job: ${jobId}`);
  }
}

// ─── DB Operations ──────────────────────────────────────────────────

function ensureSystemJobRunsTable(db: SqliteDatabase): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS system_job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_system_job_runs_job_id ON system_job_runs (job_id, started_at DESC)`);
}

function insertRun(db: SqliteDatabase, run: SystemJobRun): void {
  db.run(sql`
    INSERT INTO system_job_runs (id, job_id, status, started_at, finished_at, duration_ms, error, created_at)
    VALUES (${run.id}, ${run.jobId}, ${run.status}, ${run.startedAt}, ${run.finishedAt}, ${run.durationMs}, ${run.error}, ${Date.now()})
  `);
}

function updateRunFinished(db: SqliteDatabase, runId: string, finishedAt: number, durationMs: number, status: JobRunStatus, error: string | null): void {
  db.run(sql`
    UPDATE system_job_runs SET finished_at = ${finishedAt}, duration_ms = ${durationMs}, status = ${status}, error = ${error}
    WHERE id = ${runId}
  `);
}

function pruneOldRuns(db: SqliteDatabase, jobId: string): void {
  db.run(sql`
    DELETE FROM system_job_runs
    WHERE job_id = ${jobId}
    AND id NOT IN (
      SELECT id FROM system_job_runs
      WHERE job_id = ${jobId}
      ORDER BY started_at DESC
      LIMIT ${MAX_RUNS_PER_JOB}
    )
  `);
}

function queryRecentRuns(db: SqliteDatabase, jobId: string, limit: number): SystemJobRun[] {
  const rows = db.all(sql`
    SELECT id, job_id, status, started_at, finished_at, duration_ms, error
    FROM system_job_runs
    WHERE job_id = ${jobId}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `) as Array<{
    id: string; job_id: string; status: string;
    started_at: number; finished_at: number | null;
    duration_ms: number | null; error: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    status: r.status as JobRunStatus,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    error: r.error,
  }));
}

// ─── DB Access Helper ───────────────────────────────────────────────

function checkHealthAlert(jobId: string, state: JobState): void {
  if (state.consecutiveFailures < DEFAULT_HEALTH_RULE.consecutiveFailThreshold) return;
  const now = Date.now();
  if (state.lastAlertAt && now - state.lastAlertAt < DEFAULT_HEALTH_RULE.alertCooldownMs) return;
  state.lastAlertAt = now;
  console.error(
    `[HeartbeatRegistry] HEALTH ALERT: job "${jobId}" has failed ${state.consecutiveFailures} consecutive times. ` +
    `Last error: ${state.lastError ?? "unknown"}`,
  );
}

let tableEnsured = false;

function getDb(): SqliteDatabase | null {
  try {
    const { getSqliteDatabase } = require("../db/sqlite") as { getSqliteDatabase: () => SqliteDatabase };
    const db = getSqliteDatabase();
    if (!tableEnsured) {
      ensureSystemJobRunsTable(db);
      tableEnsured = true;
    }
    return db;
  } catch {
    // DB unavailable — degrade to in-memory mode
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────

let runCounter = 0;

/**
 * Wrap a tick function with heartbeat tracking.
 * Registry failures are fully isolated — they never affect the tick.
 */
export async function withHeartbeat<T>(
  jobId: string,
  tickFn: () => Promise<T>,
): Promise<T> {
  const registry = getRegistry();
  const state = registry.get(jobId);
  if (!state) {
    // Unknown job — just run the tick without tracking
    return tickFn();
  }

  const runId = `run_${jobId}_${Date.now()}_${++runCounter}`;
  const startedAt = Date.now();

  // Update in-memory state to running
  state.lastStatus = "running";
  state.lastStartedAt = startedAt;
  state.lastError = null;

  // Try to persist the start
  const db = getDb();
  if (db) {
    try {
      insertRun(db, { id: runId, jobId, status: "running", startedAt, finishedAt: null, durationMs: null, error: null });
    } catch { /* swallow */ }
  }

  try {
    const result = await tickFn();

    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;

    state.lastStatus = "success";
    state.lastFinishedAt = finishedAt;
    state.lastDurationMs = durationMs;
    state.consecutiveFailures = 0;

    if (db) {
      try {
        updateRunFinished(db, runId, finishedAt, durationMs, "success", null);
        pruneOldRuns(db, jobId);
      } catch { /* swallow */ }
    }

    return result;
  } catch (err) {
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    const errorMsg = err instanceof Error ? err.message : String(err);

    state.lastStatus = "error";
    state.lastFinishedAt = finishedAt;
    state.lastDurationMs = durationMs;
    state.lastError = errorMsg;
    state.consecutiveFailures++;

    // Health alert on consecutive failures
    checkHealthAlert(jobId, state);

    if (db) {
      try {
        updateRunFinished(db, runId, finishedAt, durationMs, "error", errorMsg);
        pruneOldRuns(db, jobId);
      } catch { /* swallow */ }
    }

    throw err;
  }
}

/**
 * Get all registered jobs with their current status and recent runs.
 */
export function getSystemJobStatuses(): SystemJobStatus[] {
  const registry = getRegistry();
  const db = getDb();
  const results: SystemJobStatus[] = [];

  for (const [id, state] of registry) {
    let recentRuns: SystemJobRun[] = [];
    if (db) {
      try {
        recentRuns = queryRecentRuns(db, id, 20);
      } catch { /* swallow */ }
    }
    results.push({
      ...state.meta,
      lastStatus: state.lastStatus,
      lastStartedAt: state.lastStartedAt,
      lastFinishedAt: state.lastFinishedAt,
      lastDurationMs: state.lastDurationMs,
      lastError: state.lastError,
      recentRuns,
    });
  }

  return results;
}

/**
 * Get all registered job metadata (for startup logging).
 */
export function getRegisteredJobs(): SystemJobMeta[] {
  return [...getRegistry().values()].map((s) => s.meta);
}
