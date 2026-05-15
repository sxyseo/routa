/**
 * OverseerStateStore — persistent state for the overseer subsystem.
 *
 * Stores:
 *   - Decision deduplication keys (5-min window)
 *   - Circuit breaker state
 *   - Pending ESCALATE decisions awaiting approval
 */

import { sql } from "drizzle-orm";
import type { SqliteDatabase } from "../db/sqlite";

// ─── Types ──────────────────────────────────────────────────────────

export interface OverseerDecision {
  id: string;
  pattern: string;
  taskId: string | null;
  category: "AUTO" | "NOTIFY" | "ESCALATE";
  action: string;
  details: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "executed";
  token: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface CircuitBreakerState {
  consecutiveFailures: number;
  lastFailureAt: number | null;
  isOpen: boolean;
  lastSuccessAt: number | null;
}

const DEFAULT_CB_STATE: CircuitBreakerState = {
  consecutiveFailures: 0,
  lastFailureAt: null,
  isOpen: false,
  lastSuccessAt: null,
};

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ─── In-Memory Fallback ────────────────────────────────────────────

class InMemoryOverseerStateStore {
  private decisions = new Map<string, OverseerDecision>();
  private state = new Map<string, string>();

  async isDeduped(pattern: string, taskId: string | null): Promise<boolean> {
    const key = `dedup:${pattern}:${taskId ?? "*"}`;
    const value = this.state.get(key);
    if (!value) return false;
    const at = parseInt(value, 10);
    return Date.now() - at < DEDUP_WINDOW_MS;
  }

  async recordDedup(pattern: string, taskId: string | null): Promise<void> {
    const key = `dedup:${pattern}:${taskId ?? "*"}`;
    this.state.set(key, String(Date.now()));
  }

  async saveDecision(decision: OverseerDecision): Promise<void> {
    this.decisions.set(decision.id, decision);
  }

  async getDecision(id: string): Promise<OverseerDecision | null> {
    return this.decisions.get(id) ?? null;
  }

  async updateDecisionStatus(id: string, status: OverseerDecision["status"], resolvedAt: number): Promise<void> {
    const d = this.decisions.get(id);
    if (d) {
      d.status = status;
      d.resolvedAt = resolvedAt;
    }
  }

  async getCircuitBreakerState(): Promise<CircuitBreakerState> {
    const raw = this.state.get("circuit_breaker");
    if (!raw) return { ...DEFAULT_CB_STATE };
    try {
      return JSON.parse(raw) as CircuitBreakerState;
    } catch {
      return { ...DEFAULT_CB_STATE };
    }
  }

  async setCircuitBreakerState(state: CircuitBreakerState): Promise<void> {
    this.state.set("circuit_breaker", JSON.stringify(state));
  }

  async getPendingEscalations(): Promise<OverseerDecision[]> {
    const now = Date.now();
    const THIRTY_MIN = 30 * 60 * 1000;
    return Array.from(this.decisions.values()).filter(
      (d) => d.category === "ESCALATE" && d.status === "pending" && d.createdAt + THIRTY_MIN > now,
    );
  }
}

// ─── SQLite Implementation ─────────────────────────────────────────

class SqliteOverseerStateStore {
  constructor(private db: SqliteDatabase) {}

  async isDeduped(pattern: string, taskId: string | null): Promise<boolean> {
    const key = `dedup:${pattern}:${taskId ?? "*"}`;
    const rows = this.db.all(sql`
      SELECT value FROM overseer_state WHERE key = ${key}
    `) as Array<{ value: string }>;
    if (rows.length === 0) return false;
    const at = parseInt(rows[0].value, 10);
    if (isNaN(at)) return false;
    return Date.now() - at < DEDUP_WINDOW_MS;
  }

  async recordDedup(pattern: string, taskId: string | null): Promise<void> {
    const key = `dedup:${pattern}:${taskId ?? "*"}`;
    this.db.run(sql`
      INSERT INTO overseer_state (key, value, updated_at) VALUES (${key}, ${String(Date.now())}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET value = ${String(Date.now())}, updated_at = ${Date.now()}
    `);
  }

  async saveDecision(decision: OverseerDecision): Promise<void> {
    this.db.run(sql`
      INSERT INTO overseer_decisions (id, pattern, task_id, category, action, details, status, token, created_at, resolved_at)
      VALUES (${decision.id}, ${decision.pattern}, ${decision.taskId}, ${decision.category}, ${decision.action}, ${decision.details}, ${decision.status}, ${decision.token}, ${decision.createdAt}, ${decision.resolvedAt})
      ON CONFLICT(id) DO UPDATE SET status = ${decision.status}, token = ${decision.token}, resolved_at = ${decision.resolvedAt}
    `);
  }

  async getDecision(id: string): Promise<OverseerDecision | null> {
    const rows = this.db.all(sql`
      SELECT id, pattern, task_id, category, action, details, status, token, created_at, resolved_at
      FROM overseer_decisions WHERE id = ${id}
    `) as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async updateDecisionStatus(id: string, status: OverseerDecision["status"], resolvedAt: number): Promise<void> {
    this.db.run(sql`
      UPDATE overseer_decisions SET status = ${status}, resolved_at = ${resolvedAt} WHERE id = ${id}
    `);
  }

  async getCircuitBreakerState(): Promise<CircuitBreakerState> {
    const rows = this.db.all(sql`
      SELECT value FROM overseer_state WHERE key = 'circuit_breaker'
    `) as Array<{ value: string }>;
    if (rows.length === 0) return { ...DEFAULT_CB_STATE };
    try {
      return JSON.parse(rows[0].value) as CircuitBreakerState;
    } catch {
      return { ...DEFAULT_CB_STATE };
    }
  }

  async setCircuitBreakerState(state: CircuitBreakerState): Promise<void> {
    this.db.run(sql`
      INSERT INTO overseer_state (key, value, updated_at) VALUES ('circuit_breaker', ${JSON.stringify(state)}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET value = ${JSON.stringify(state)}, updated_at = ${Date.now()}
    `);
  }

  async getPendingEscalations(): Promise<OverseerDecision[]> {
    const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
    const rows = this.db.all(sql`
      SELECT id, pattern, task_id, category, action, details, status, token, created_at, resolved_at
      FROM overseer_decisions
      WHERE category = 'ESCALATE' AND status = 'pending' AND created_at > ${cutoff}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): OverseerDecision {
    return {
      id: row.id as string,
      pattern: row.pattern as string,
      taskId: (row.task_id as string) ?? null,
      category: row.category as OverseerDecision["category"],
      action: row.action as string,
      details: (row.details as string) ?? null,
      status: row.status as OverseerDecision["status"],
      token: (row.token as string) ?? null,
      createdAt: row.created_at as number,
      resolvedAt: (row.resolved_at as number) ?? null,
    };
  }
}

// ─── Union Type & Factory ──────────────────────────────────────────

export type OverseerStateStore = InMemoryOverseerStateStore | SqliteOverseerStateStore;

export function createInMemoryOverseerStateStore(): InMemoryOverseerStateStore {
  return new InMemoryOverseerStateStore();
}

export function createSqliteOverseerStateStore(db: SqliteDatabase): SqliteOverseerStateStore {
  return new SqliteOverseerStateStore(db);
}
