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

const SYSTEM_JOBS: SystemJobMeta[] = [
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
];

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
}

function createRegistryState(): Map<string, JobState> {
  const map = new Map<string, JobState>();
  for (const meta of SYSTEM_JOBS) {
    map.set(meta.id, { meta, lastStatus: "idle", lastStartedAt: null, lastFinishedAt: null, lastDurationMs: null, lastError: null });
  }
  return map;
}

function getRegistry(): Map<string, JobState> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createRegistryState();
    console.log(`[HeartbeatRegistry] Registered ${SYSTEM_JOBS.length} system jobs: ${SYSTEM_JOBS.map((j) => j.id).join(", ")}`);
  }
  return g[GLOBAL_KEY] as Map<string, JobState>;
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

  return SYSTEM_JOBS.map((meta) => {
    const state = registry.get(meta.id)!;
    let recentRuns: SystemJobRun[] = [];

    if (db) {
      try {
        recentRuns = queryRecentRuns(db, meta.id, 20);
      } catch { /* swallow — return empty */ }
    }

    return {
      ...meta,
      lastStatus: state.lastStatus,
      lastStartedAt: state.lastStartedAt,
      lastFinishedAt: state.lastFinishedAt,
      lastDurationMs: state.lastDurationMs,
      lastError: state.lastError,
      recentRuns,
    };
  });
}

/**
 * Get all registered job metadata (for startup logging).
 */
export function getRegisteredJobs(): SystemJobMeta[] {
  return [...SYSTEM_JOBS];
}
