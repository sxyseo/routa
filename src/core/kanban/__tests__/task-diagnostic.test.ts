import { describe, it, expect } from "vitest";
import { parseTaskDiagnostic } from "../task-diagnostic";

const NOW = 1_700_000_000_000;

describe("parseTaskDiagnostic", () => {
  it("returns undefined when no lastSyncError", () => {
    expect(parseTaskDiagnostic({})).toBeUndefined();
    expect(parseTaskDiagnostic({ lastSyncError: "" })).toBeUndefined();
  });

  // ── Circuit breaker ──────────────────────────────────────────────────────

  it("parses circuit breaker with reset count", () => {
    const result = parseTaskDiagnostic(
      {
        lastSyncError: "[circuit-breaker:reset=2] Session creation failed 3 times. Retry after cooldown.",
        updatedAt: new Date(NOW - 60_000).toISOString(),
      },
      { now: NOW },
    );
    expect(result).toBeDefined();
    expect(result!.category).toBe("circuit_breaker");
    expect(result!.autoRecoverable).toBe(true);
    expect(result!.meta?.resetCount).toBe(2);
    expect(result!.recoveryHint).toContain("自动重试");
  });

  it("detects permanently skipped circuit breaker", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: "[circuit-breaker:reset=5] Session creation failed 3 times. Retry after cooldown.",
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("circuit_breaker");
    expect(result!.autoRecoverable).toBe(false);
    expect(result!.message).toContain("永久跳过");
    expect(result!.suggestions).toHaveLength(1);
  });

  it("detects cooldown expired for circuit breaker", () => {
    const result = parseTaskDiagnostic(
      {
        lastSyncError: "[circuit-breaker:reset=1] pending retry.",
        updatedAt: new Date(NOW - 600_000).toISOString(), // 10 minutes ago
      },
      { now: NOW },
    );
    expect(result).toBeDefined();
    expect(result!.recoveryHint).toContain("冷却已过期");
  });

  // ── Rate limited ─────────────────────────────────────────────────────────

  it("parses rate-limited marker", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: "[rate-limited] API rate limit exceeded. Retry after 60s.",
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("rate_limited");
    expect(result!.autoRecoverable).toBe(true);
    expect(result!.message).not.toContain("[rate-limited]");
  });

  // ── Dependency blocked ───────────────────────────────────────────────────

  it("parses dependency blocked", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: "Blocked by unfinished dependencies: task-abc, task-def",
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("dependency_blocked");
    expect(result!.autoRecoverable).toBe(true);
    expect(result!.meta?.pendingDependencies).toEqual(["task-abc", "task-def"]);
  });

  // ── Retry limit ──────────────────────────────────────────────────────────

  it("parses non-dev automation retry limit", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: 'Stopped Kanban automation for "Todo" after 4 runs. Non-dev lanes are limited to 3 automation runs to prevent loops.',
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("retry_limit");
    expect(result!.autoRecoverable).toBe(false);
    expect(result!.meta?.columnName).toBe("Todo");
    expect(result!.meta?.runCount).toBe(4);
  });

  // ── PR failure ───────────────────────────────────────────────────────────

  it("parses PR creation failure", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: "Auto PR creation failed: git push failed — remote rejected (attempt 2/3)",
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("pr_failure");
    expect(result!.autoRecoverable).toBe(false);
  });

  it("parses PR branch not found failure", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: "Auto PR creation failed: branch feat/xyz not found on remote after push.",
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("pr_failure");
  });

  // ── Fan-In conflict ─────────────────────────────────────────────────────

  it("parses fan-in conflict", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: "[Fan-In] Merge conflict in src/main.ts between child branches",
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("fan_in_conflict");
    expect(result!.autoRecoverable).toBe(false);
  });

  // ── Stale session ────────────────────────────────────────────────────────

  it("parses stale session error", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: "embedded ACP processes cannot be resumed on a different instance",
      triggerSessionId: "sess-123",
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("stale_session");
    expect(result!.autoRecoverable).toBe(true);
  });

  // ── Unknown error ────────────────────────────────────────────────────────

  it("falls back to unknown_error for unrecognized messages", () => {
    const result = parseTaskDiagnostic({
      lastSyncError: "Something went wrong that we haven't categorized",
    });
    expect(result).toBeDefined();
    expect(result!.category).toBe("unknown_error");
    expect(result!.autoRecoverable).toBe(false);
    expect(result!.message).toBe("Something went wrong that we haven't categorized");
  });
});
