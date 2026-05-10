/**
 * Kanban System Config — centralized configuration for the kanban automation system.
 *
 * Reading priority: workspace metadata > environment variables > defaults.
 * Import `getKanbanConfig()` to get the resolved config.
 */

// ─── Config Interface ────────────────────────────────────────────────────────

export interface KanbanSystemConfig {
  // ── Circuit Breaker ──
  /** Max consecutive session failures before triggering circuit breaker. */
  sessionRetryLimit: number;
  /** Cooldown (ms) before resetting circuit breaker. */
  sessionRetryResetMs: number;
  /** Max cooldown resets before permanent skip. */
  cbMaxCooldownResets: number;

  // ── Watchdog ──
  /** Interval (ms) between watchdog scans for inactive sessions. */
  watchdogScanIntervalMs: number;
  /** Max retries for stale queued automations. */
  staleMaxRetries: number;

  // ── Automation Limits ──
  /** Repeat limit for non-dev lanes. */
  nonDevRepeatLimit: number;
  /** Repeat limit for blocked lane. */
  blockedRepeatLimit: number;
  /** Max duration (ms) for a single automation run. */
  maxAutomationDurationMs: number;
  /** Repeat limit time window (ms). */
  repeatLimitTimeWindowMs: number;

  // ── Delays & Thresholds ──
  /** Delay (ms) after PR merge before archiving. */
  postMergeArchiveMs: number;
  /** Minimum age (ms) before PR merge verification. */
  prVerificationMinAgeMs: number;
  /** Age (ms) for orphan detection in done-lane recovery. */
  orphanAgeMs: number;
  /** Delay (ms) before cleaning up completed automations. */
  completedCleanupDelayMs: number;
  /** Threshold (ms) for stale queued automations. */
  staleQueuedThresholdMs: number;
  /** Delay (ms) before worktree cleanup. */
  worktreeCleanupDelayMs: number;

  // ── Flow Ledger ──
  /** Failure rate threshold (0–1) for skipping columns. */
  flowFailureThreshold: number;

  // ── Concurrency ──
  /** Default per-board session concurrency limit. */
  defaultSessionConcurrencyLimit: number;

  // ── PR Auto-Create ──
  /** Max retry attempts for PR creation. */
  prRetryLimit: number;

  // ── Recovery Specialists ──
  /** Max retry attempts for conflict-resolver before permanent stuck marking. */
  conflictResolverMaxRetries: number;
  /** Max duration (ms) for an auto-merger session before forced termination. */
  autoMergerTimeoutMs: number;

  // ── Graph Refiner ──
  /** Whether the Graph Refiner is enabled. */
  graphRefinerEnabled: boolean;
  /** Minimum backlog tasks to trigger graph analysis. */
  graphRefinerMinTasks: number;
  /** Debounce interval (ms) after last backlog change before running refiner. */
  graphRefinerDebounceMs: number;
  /** Maximum tasks to analyze in a single refiner run. */
  graphRefinerMaxTasks: number;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: KanbanSystemConfig = {
  sessionRetryLimit: 3,
  sessionRetryResetMs: 5 * 60 * 1000,
  cbMaxCooldownResets: 5,
  watchdogScanIntervalMs: 30_000,
  staleMaxRetries: 3,
  nonDevRepeatLimit: 3,
  blockedRepeatLimit: 10,
  maxAutomationDurationMs: 12 * 60 * 60 * 1000,
  repeatLimitTimeWindowMs: 30 * 60 * 1000,
  postMergeArchiveMs: 60 * 60 * 1000,
  prVerificationMinAgeMs: 1 * 60 * 1000,
  orphanAgeMs: 3 * 60 * 1000,
  completedCleanupDelayMs: 30_000,
  staleQueuedThresholdMs: 60_000,
  worktreeCleanupDelayMs: 60_000,
  flowFailureThreshold: 0.7,
  defaultSessionConcurrencyLimit: 2,
  prRetryLimit: 3,
  conflictResolverMaxRetries: 3,
  autoMergerTimeoutMs: 10 * 60 * 1000,
  graphRefinerEnabled: true,
  graphRefinerMinTasks: 3,
  graphRefinerDebounceMs: 30_000,
  graphRefinerMaxTasks: 50,
};

// ─── Resolver ────────────────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Get the resolved kanban system config.
 * Environment variables take precedence over defaults.
 * Future: workspace metadata overrides can be layered here.
 */
export function getKanbanConfig(): KanbanSystemConfig {
  return {
    sessionRetryLimit: envInt("ROUTA_SESSION_RETRY_LIMIT", DEFAULTS.sessionRetryLimit),
    sessionRetryResetMs: envInt("ROUTA_SESSION_RETRY_RESET_MS", DEFAULTS.sessionRetryResetMs),
    cbMaxCooldownResets: envInt("ROUTA_CB_MAX_COOLDOWN_RESETS", DEFAULTS.cbMaxCooldownResets),
    watchdogScanIntervalMs: envInt("ROUTA_WATCHDOG_SCAN_INTERVAL_MS", DEFAULTS.watchdogScanIntervalMs),
    staleMaxRetries: envInt("ROUTA_STALE_MAX_RETRIES", DEFAULTS.staleMaxRetries),
    nonDevRepeatLimit: envInt("ROUTA_NON_DEV_REPEAT_LIMIT", DEFAULTS.nonDevRepeatLimit),
    blockedRepeatLimit: envInt("ROUTA_BLOCKED_REPEAT_LIMIT", DEFAULTS.blockedRepeatLimit),
    maxAutomationDurationMs: envInt("ROUTA_MAX_AUTOMATION_DURATION_MS", DEFAULTS.maxAutomationDurationMs),
    repeatLimitTimeWindowMs: envInt("ROUTA_REPEAT_LIMIT_TIME_WINDOW_MS", DEFAULTS.repeatLimitTimeWindowMs),
    postMergeArchiveMs: envInt("ROUTA_POST_MERGE_ARCHIVE_MS", DEFAULTS.postMergeArchiveMs),
    prVerificationMinAgeMs: envInt("ROUTA_PR_VERIFICATION_MIN_AGE_MS", DEFAULTS.prVerificationMinAgeMs),
    orphanAgeMs: envInt("ROUTA_ORPHAN_AGE_MS", DEFAULTS.orphanAgeMs),
    completedCleanupDelayMs: envInt("ROUTA_COMPLETED_CLEANUP_DELAY_MS", DEFAULTS.completedCleanupDelayMs),
    staleQueuedThresholdMs: envInt("ROUTA_STALE_QUEUED_THRESHOLD_MS", DEFAULTS.staleQueuedThresholdMs),
    worktreeCleanupDelayMs: envInt("ROUTA_WORKTREE_CLEANUP_DELAY_MS", DEFAULTS.worktreeCleanupDelayMs),
    flowFailureThreshold: envFloat("ROUTA_FLOW_FAILURE_THRESHOLD", DEFAULTS.flowFailureThreshold),
    defaultSessionConcurrencyLimit: envInt("ROUTA_SESSION_CONCURRENCY_LIMIT", DEFAULTS.defaultSessionConcurrencyLimit),
    prRetryLimit: envInt("ROUTA_PR_RETRY_LIMIT", DEFAULTS.prRetryLimit),
    conflictResolverMaxRetries: envInt("ROUTA_CONFLICT_RESOLVER_MAX_RETRIES", DEFAULTS.conflictResolverMaxRetries),
    autoMergerTimeoutMs: envInt("ROUTA_AUTO_MERGER_TIMEOUT_MS", DEFAULTS.autoMergerTimeoutMs),
    graphRefinerEnabled: process.env.ROUTA_GRAPH_REFINER_ENABLED !== "false",
    graphRefinerMinTasks: envInt("ROUTA_GRAPH_REFINER_MIN_TASKS", DEFAULTS.graphRefinerMinTasks),
    graphRefinerDebounceMs: envInt("ROUTA_GRAPH_REFINER_DEBOUNCE_MS", DEFAULTS.graphRefinerDebounceMs),
    graphRefinerMaxTasks: envInt("ROUTA_GRAPH_REFINER_MAX_TASKS", DEFAULTS.graphRefinerMaxTasks),
  };
}
