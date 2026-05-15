/**
 * Sync Error Writer — Unified read/write for task.lastSyncError.
 *
 * All lastSyncError mutations and parsing should go through this module
 * instead of ad-hoc string operations scattered across the codebase.
 * This ensures consistent format, single source of truth for error types,
 * and makes adding new error types a one-file change.
 *
 * Format: JSON-encoded SyncErrorPayload. The parser also accepts legacy
 * text-encoded strings for backward compatibility during migration.
 */

import type { Task } from "../models/task";

// ─── Error Types ──────────────────────────────────────────────────────────────

export type SyncErrorType =
  | "circuit_breaker"
  | "rate_limited"
  | "repeat_limit"
  | "advance_recovery"
  | "done_stuck"
  | "dependency_blocked"
  | "gate_soft_fail";

export interface SyncErrorPayload {
  type: SyncErrorType;
  message: string;
  /** Circuit-breaker cooldown reset count (only for circuit_breaker type) */
  resetCount?: number;
  /** Cooldown duration in ms (only for types that support cooldown) */
  cooldownMs?: number;
  /** Precise cooldown expiry timestamp (epoch ms). Preferred over cooldownMs for expiry checks. */
  cooldownUntil?: number | null;
  /** Embedded previous error (e.g. PR failure info preserved across resets) */
  prev?: string;
}

// ─── Format / Parse ───────────────────────────────────────────────────────────

/**
 * Format a SyncErrorPayload into a JSON string for lastSyncError.
 * Computes cooldownUntil from cooldownMs when provided.
 */
export function formatSyncError(payload: SyncErrorPayload): string {
  const out: SyncErrorPayload = { ...payload };
  if (out.cooldownMs && out.cooldownMs > 0 && !out.cooldownUntil) {
    out.cooldownUntil = Date.now() + out.cooldownMs;
  }
  return JSON.stringify(out);
}

/** Parse a raw lastSyncError string back into a typed payload. Supports JSON and legacy text. */
export function parseSyncError(raw: string | undefined): SyncErrorPayload | null {
  if (!raw) return null;

  // ── New JSON format ──
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.type === "string") {
        return obj as SyncErrorPayload;
      }
    } catch {
      // Malformed JSON — fall through to legacy parsing
    }
  }

  // ── Legacy text format (backward-compatible) ──

  // Circuit breaker: "[circuit-breaker:reset=N] ..."
  const cbMatch = raw.match(/^\[circuit-breaker:reset=(\d+)\]\s*(.*?)(?:\s*\|\s*prev:\s*(.*))?$/s);
  if (cbMatch) {
    return {
      type: "circuit_breaker",
      resetCount: parseInt(cbMatch[1], 10),
      message: cbMatch[2].trim(),
      prev: cbMatch[3]?.trim(),
    };
  }

  // Legacy circuit breaker without reset count
  if (raw.startsWith("[circuit-breaker]")) {
    return {
      type: "circuit_breaker",
      resetCount: 0,
      message: raw.replace(/^\[circuit-breaker\]\s*/, "").trim(),
    };
  }

  // Rate limited: "[rate-limited] ..."
  if (raw.startsWith("[rate-limited]")) {
    return {
      type: "rate_limited",
      message: raw.replace(/^\[rate-limited\]\s*/, "").trim(),
    };
  }

  // Advance recovery: "[advance-recovery] ..."
  if (raw.startsWith("[advance-recovery]")) {
    return { type: "advance_recovery", message: raw.trim() };
  }

  // Done lane stuck: "[done-lane-stuck] ..."
  if (raw.startsWith("[done-lane-stuck]")) {
    return { type: "done_stuck", message: raw.trim() };
  }

  // Dependency blocked
  if (raw.startsWith("Blocked by unfinished dependencies")) {
    return { type: "dependency_blocked", message: raw.trim() };
  }

  // Repeat limit
  if (raw.startsWith("Stopped Kanban automation")) {
    return { type: "repeat_limit", message: raw.trim() };
  }

  // Gate soft fail
  if (raw.includes("failed but soft-gated")) {
    return { type: "gate_soft_fail", message: raw.trim() };
  }

  // Unknown format — return as generic
  return { type: "circuit_breaker", message: raw };
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function getErrorType(raw: string | undefined): SyncErrorType | null {
  return parseSyncError(raw)?.type ?? null;
}

export function isCircuitBreaker(raw: string | undefined): boolean {
  return getErrorType(raw) === "circuit_breaker";
}

export function isRateLimited(raw: string | undefined): boolean {
  return getErrorType(raw) === "rate_limited";
}

/** Parse cooldown reset count from a circuit-breaker error string. */
export function parseCbResetCount(raw: string | undefined): number {
  return parseSyncError(raw)?.resetCount ?? 0;
}

/**
 * Check if the error is in cooldown.
 * Prefers cooldownUntil (exact expiry) when available; falls back to
 * updatedAt + cooldownMs heuristic for legacy entries.
 */
export function isCooldownActive(
  raw: string | undefined,
  updatedAt: Date | string | number,
  cooldownMs: number,
): boolean {
  if (!raw) return false;
  const payload = parseSyncError(raw);
  if (!payload) return false;
  if (payload.type !== "circuit_breaker" && payload.type !== "rate_limited") return false;

  // Precise expiry from cooldownUntil
  if (payload.cooldownUntil != null) {
    return Date.now() < payload.cooldownUntil;
  }

  // Legacy heuristic: updatedAt + cooldownMs
  const updatedMs = updatedAt instanceof Date
    ? updatedAt.getTime()
    : new Date(updatedAt).getTime();
  return Date.now() - updatedMs < cooldownMs;
}

// ─── Convenience builders ─────────────────────────────────────────────────────

export function buildCircuitBreakerError(resetCount: number, message: string, prev?: string): string {
  return formatSyncError({ type: "circuit_breaker", resetCount, message, prev });
}

export function buildRateLimitedError(message: string): string {
  return formatSyncError({ type: "rate_limited", message });
}

export function buildAdvanceRecoveryError(message: string): string {
  return formatSyncError({ type: "advance_recovery", message });
}

export function buildDoneStuckError(message: string): string {
  return formatSyncError({ type: "done_stuck", message });
}

export function buildDependencyBlockedError(pendingDeps: string[]): string {
  return formatSyncError({
    type: "dependency_blocked",
    message: `Blocked by unfinished dependencies: ${pendingDeps.join(", ")}`,
  });
}

/** Parse retry count from a [done-lane-stuck] message containing "retry #N". */
export function parseDoneStuckRetryCount(raw: string): number {
  const match = raw.match(/retry #(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// ─── Stuck Marker Cleanup ──────────────────────────────────────────────────────

/**
 * Clear the stuck marker on a task with a unified strategy.
 *
 * @param task  The task to clean up (must have `lastSyncError`, `laneSessions`, `columnId`).
 * @param strategy
 *   - "shallow": only clear `lastSyncError` (Lane Scanner circuit-breaker recovery).
 *   - "deep":    clear `lastSyncError` + filter failed sessions in the current column
 *                (Done-Lane Recovery).
 *   - "full":    clear `lastSyncError` + filter failed/timed_out sessions across ALL columns
 *                (Restart Recovery startup sweep).
 * @returns A partial update object suitable for passing to `atomicUpdate` or `save`.
 */
export function clearStuckMarker(
  task: { lastSyncError?: string; laneSessions?: Task["laneSessions"]; columnId?: string },
  strategy: "shallow" | "deep" | "full",
): { lastSyncError: undefined; laneSessions: Task["laneSessions"] } {
  const sessions = task.laneSessions ?? [];

  let filteredSessions: Task["laneSessions"];
  switch (strategy) {
    case "shallow":
      // No session filtering — just clear the error marker.
      filteredSessions = sessions;
      break;
    case "deep":
      // Remove failed sessions only in the current column.
      filteredSessions = sessions.filter(
        (s) => s.columnId !== task.columnId || s.status !== "failed",
      );
      break;
    case "full":
      // Remove failed AND timed_out sessions across ALL columns.
      filteredSessions = sessions.filter(
        (s) => s.status !== "failed" && s.status !== "timed_out",
      );
      break;
  }

  return { lastSyncError: undefined, laneSessions: filteredSessions };
}
