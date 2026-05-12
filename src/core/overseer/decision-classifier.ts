/**
 * DecisionClassifier — classifies diagnostics into AUTO/NOTIFY/ESCALATE
 * decisions with deduplication and resource limits.
 */

import type { OverseerDiagnostic, DiagnosticPattern } from "./diagnostics";
import type { OverseerStateStore, OverseerDecision } from "./overseer-state-store";

// ─── Types ──────────────────────────────────────────────────────────

export type DecisionAction =
  | "clear-trigger-session"
  | "clear-pending-marker"
  | "clear-worktree-ref"
  | "unblock-dependency"
  | "retry-version-conflict"
  | "reset-orphan-session"
  | "log-only"
  | "notify-human"
  | "escalate";

export interface ClassifiedDecision {
  id: string;
  pattern: DiagnosticPattern;
  category: "AUTO" | "NOTIFY" | "ESCALATE";
  taskId: string;
  description: string;
  action: DecisionAction;
  details: Record<string, unknown>;
}

// ─── Pattern → Action mapping ──────────────────────────────────────

const PATTERN_ACTION_MAP: Record<DiagnosticPattern, DecisionAction> = {
  "stale-trigger-session": "clear-trigger-session",
  "expired-pending-marker": "clear-pending-marker",
  "orphan-worktree": "clear-worktree-ref",
  "dependency-block-resolved": "unblock-dependency",
  "version-conflict-retry": "retry-version-conflict",
  "webhook-lost-pr-merge": "log-only",
  "orphan-in-progress": "reset-orphan-session",
  "automation-limit-marker": "clear-pending-marker",
  "cb-cooldown-expired": "log-only",
};

// ─── Resource Limits per tick ───────────────────────────────────────

const MAX_AUTO = 20;
const MAX_NOTIFY = 5;
const MAX_ESCALATE = 3;

// ─── Classifier ────────────────────────────────────────────────────

/**
 * Classify raw diagnostics into actionable decisions.
 *
 * Applies:
 *   1. Deduplication (5-min window via state store)
 *   2. Resource limits (max per category per tick)
 *   3. Pattern → action mapping
 */
export async function classifyDiagnostics(
  diagnostics: OverseerDiagnostic[],
  stateStore: OverseerStateStore,
): Promise<ClassifiedDecision[]> {
  const decisions: ClassifiedDecision[] = [];
  const counts = { AUTO: 0, NOTIFY: 0, ESCALATE: 0 };

  // Prioritize orphan-in-progress over other AUTO patterns so recovery
  // actions are not crowded out by lower-impact orphan-worktree cleanups.
  const prioritized = [...diagnostics].sort((a, b) => {
    const prio = (p: string) => p === "orphan-in-progress" ? 0 : 1;
    return prio(a.pattern) - prio(b.pattern);
  });

  for (const diag of prioritized) {
    // Dedup check
    const isDeduped = await stateStore.isDeduped(diag.pattern, diag.taskId);
    if (isDeduped) continue;

    // Resource limit check
    const cat = diag.category;
    const limits = { AUTO: MAX_AUTO, NOTIFY: MAX_NOTIFY, ESCALATE: MAX_ESCALATE };
    if (counts[cat] >= limits[cat]) continue;

    const action = PATTERN_ACTION_MAP[diag.pattern] ?? "log-only";

    decisions.push({
      id: `od_${diag.pattern}_${diag.taskId}_${Date.now()}`,
      pattern: diag.pattern,
      category: cat,
      taskId: diag.taskId,
      description: diag.description,
      action,
      details: diag.details,
    });

    counts[cat]++;

    // Record dedup
    await stateStore.recordDedup(diag.pattern, diag.taskId);
  }

  return decisions;
}

/**
 * Convert classified decisions to OverseerDecision records for persistence.
 */
export function toOverseerDecision(decision: ClassifiedDecision): OverseerDecision {
  return {
    id: decision.id,
    pattern: decision.pattern,
    taskId: decision.taskId,
    category: decision.category,
    action: decision.action,
    details: JSON.stringify(decision.details),
    status: decision.category === "ESCALATE" ? "pending" : "executed",
    token: null,
    createdAt: Date.now(),
    resolvedAt: decision.category !== "ESCALATE" ? Date.now() : null,
  };
}
