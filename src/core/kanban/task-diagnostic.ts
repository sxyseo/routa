/**
 * Task Diagnostic Parser
 *
 * Parses `task.lastSyncError` (and minimal surrounding state) into a structured
 * `TaskDiagnostic` object that the frontend can render directly.
 *
 * Designed as a pure module — no Node.js / process.env dependencies — so both
 * server-side serialization and client-side fallback can import it.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type TaskDiagnosticCategory =
  | "circuit_breaker"
  | "rate_limited"
  | "dependency_blocked"
  | "retry_limit"
  | "pr_failure"
  | "fan_in_conflict"
  | "stale_session"
  | "watchdog_recovery"
  | "done_lane_stuck"
  | "conflict_detected"
  | "unknown_error";

export interface AiErrorInsight {
  rootCause: string;
  severity: "low" | "medium" | "high";
  actionHint: string;
}

export interface TaskDiagnostic {
  category: TaskDiagnosticCategory;
  shortLabel: string;
  message: string;
  rawError?: string;
  autoRecoverable: boolean;
  recoveryHint?: string;
  suggestions: string[];
  aiInsight?: AiErrorInsight;
  meta?: {
    resetCount?: number;
    maxResets?: number;
    remainingCooldownMs?: number;
    columnName?: string;
    runCount?: number;
    pendingDependencies?: string[];
  };
}

export interface TaskDiagnosticInput {
  lastSyncError?: string;
  triggerSessionId?: string;
  dependencyStatus?: string;
  updatedAt?: string;
  columnId?: string;
}

// ── Marker constants (duplicated from backend to avoid process.env imports) ─

const CB_MARKER = "[circuit-breaker]";
const RATE_MARKER = "[rate-limited]";
const PR_FAILURE_PREFIX = "Auto PR creation failed";

const DEFAULT_CB_MAX_RESETS = 5;
const DEFAULT_RETRY_RESET_MS = 5 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Extract the human-readable message from a lastSyncError (JSON or legacy text). */
function extractMessage(raw: string): string {
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw);
      if (obj?.message) return obj.message;
    } catch { /* fall through */ }
  }
  return raw
    .replace(/\[circuit-breaker:reset=\d+\]\s*/, "")
    .replace(/\[circuit-breaker\]\s*/, "")
    .replace(/\[rate-limited\]\s*/, "")
    .replace(/\[done-lane-stuck\]\s*/, "");
}

function parseResetCount(lastSyncError: string | undefined): number {
  if (!lastSyncError) return 0;
  // JSON format
  if (lastSyncError.startsWith("{")) {
    try {
      const obj = JSON.parse(lastSyncError);
      return obj?.resetCount ?? 0;
    } catch { return 0; }
  }
  // Legacy text
  const match = lastSyncError.match(/\[circuit-breaker:reset=(\d+)\]/);
  return match ? parseInt(match[1], 10) : (lastSyncError.startsWith(CB_MARKER) ? 0 : 0);
}

/** Detect the structured error type from a lastSyncError string. */
function detectErrorType(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw);
      return obj?.type ?? null;
    } catch { return null; }
  }
  if (raw.startsWith(CB_MARKER) || raw.match(/^\[circuit-breaker:reset=\d+\]/)) return "circuit_breaker";
  if (raw.startsWith(RATE_MARKER)) return "rate_limited";
  if (raw.startsWith("Blocked by unfinished dependencies")) return "dependency_blocked";
  if (raw.startsWith("Stopped Kanban automation")) return "repeat_limit";
  if (raw.startsWith("[advance-recovery]")) return "advance_recovery";
  if (raw.startsWith("[done-lane-stuck]")) return "done_stuck";
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function parseTaskDiagnostic(
  input: TaskDiagnosticInput,
  options?: { cbMaxResets?: number; retryResetMs?: number; now?: number },
): TaskDiagnostic | undefined {
  const { lastSyncError } = input;
  if (!lastSyncError) return undefined;

  const now = options?.now ?? Date.now();
  const cbMaxResets = options?.cbMaxResets ?? DEFAULT_CB_MAX_RESETS;
  const retryResetMs = options?.retryResetMs ?? DEFAULT_RETRY_RESET_MS;

  // 1. Circuit breaker
  if (detectErrorType(lastSyncError) === "circuit_breaker") {
    const resetCount = parseResetCount(lastSyncError);
    const permanentlySkipped = resetCount >= cbMaxResets;

    let remainingCooldownMs: number | undefined;
    let recoveryHint: string | undefined;
    if (!permanentlySkipped && input.updatedAt) {
      const updatedAtMs = new Date(input.updatedAt).getTime();
      remainingCooldownMs = Math.max(0, updatedAtMs + retryResetMs - now);
      if (remainingCooldownMs > 0) {
        const minutes = Math.ceil(remainingCooldownMs / 60_000);
        recoveryHint = `冷却后约 ${minutes} 分钟自动重试`;
      } else {
        recoveryHint = "冷却已过期，等待下次扫描重试";
      }
    }

    return {
      category: "circuit_breaker",
      shortLabel: "Circuit breaker",
      message: permanentlySkipped
        ? `熔断器已达到最大重置次数 (${resetCount}/${cbMaxResets})，任务被永久跳过。`
        : extractMessage(lastSyncError),
      rawError: lastSyncError,
      autoRecoverable: !permanentlySkipped,
      recoveryHint: permanentlySkipped ? undefined : recoveryHint,
      suggestions: permanentlySkipped
        ? ["手动点击「重新运行」重置熔断状态"]
        : ["等待自动恢复，或手动点击「重新运行」"],
      meta: { resetCount, maxResets: cbMaxResets, remainingCooldownMs },
    };
  }

  // 2. Rate limited
  if (detectErrorType(lastSyncError) === "rate_limited") {
    return {
      category: "rate_limited",
      shortLabel: "Rate limited",
      message: extractMessage(lastSyncError),
      rawError: lastSyncError,
      autoRecoverable: true,
      recoveryHint: "API 限速恢复后自动重试",
      suggestions: ["等待限速解除后自动恢复"],
    };
  }

  // 3. Dependency blocked
  if (detectErrorType(lastSyncError) === "dependency_blocked") {
    const msg = extractMessage(lastSyncError);
    const deps = msg
      .replace("Blocked by unfinished dependencies:", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      category: "dependency_blocked",
      shortLabel: "Dep blocked",
      message: `被 ${deps.length} 个未完成的依赖任务阻塞: ${deps.join(", ")}`,
      rawError: lastSyncError,
      autoRecoverable: true,
      recoveryHint: "依赖任务完成后自动执行",
      suggestions: ["检查依赖任务状态，确保上游任务已完成"],
      meta: { pendingDependencies: deps },
    };
  }

  // 4. Retry limit (non-dev automation repeat limit)
  if (detectErrorType(lastSyncError) === "repeat_limit") {
    const msg = extractMessage(lastSyncError);
    const nameMatch = msg.match(/for "(.+?)"/);
    const countMatch = msg.match(/after (\d+) runs/);
    return {
      category: "retry_limit",
      shortLabel: "Auto limit",
      message: msg,
      rawError: lastSyncError,
      autoRecoverable: false,
      suggestions: ["手动将卡片移回前一列重置计数", "检查自动化配置是否有问题"],
      meta: {
        columnName: nameMatch?.[1],
        runCount: countMatch ? parseInt(countMatch[1], 10) : undefined,
      },
    };
  }

  // 5. PR failure
  if (lastSyncError.includes(PR_FAILURE_PREFIX) || lastSyncError.includes("Auto PR creation failed")) {
    return {
      category: "pr_failure",
      shortLabel: "PR failed",
      message: lastSyncError,
      rawError: lastSyncError,
      autoRecoverable: false,
      suggestions: ["检查 worktree 分支状态和远程仓库连接", "可手动通过 git CLI 创建 PR"],
    };
  }

  // 6. Fan-In conflict
  if (lastSyncError.startsWith("[Fan-In]")) {
    return {
      category: "fan_in_conflict",
      shortLabel: "Merge conflict",
      message: lastSyncError,
      rawError: lastSyncError,
      autoRecoverable: false,
      suggestions: ["在详情面板点击「重试聚合」", "手动解决 worktree 中的合并冲突"],
    };
  }

  // 7. Stale session (triggerSessionId set but error state)
  if (input.triggerSessionId && lastSyncError.includes("cannot be resumed")) {
    return {
      category: "stale_session",
      shortLabel: "Stale session",
      message: lastSyncError,
      rawError: lastSyncError,
      autoRecoverable: true,
      recoveryHint: "过期会话将在下次扫描时被清理",
      suggestions: ["手动点击「重新运行」启动新会话"],
    };
  }

  // 8. Watchdog recovery (session recovered after inactivity / failure)
  if (lastSyncError.includes("recovered after session")) {
    const attemptMatch = lastSyncError.match(/Attempt (\d+)\/(\d+)/);
    return {
      category: "watchdog_recovery",
      shortLabel: "Recovered",
      message: lastSyncError,
      rawError: lastSyncError,
      autoRecoverable: true,
      recoveryHint: "会话已自动恢复，继续执行中",
      suggestions: ["恢复是自动进行的，无需手动干预", "如果反复恢复，检查代理配置"],
      meta: {
        resetCount: attemptMatch?.[1] ? parseInt(attemptMatch[1], 10) : undefined,
        maxResets: attemptMatch?.[2] ? parseInt(attemptMatch[2], 10) : undefined,
      },
    };
  }

  // 9. Done-lane stuck (recovery tick diagnostic)
  if (detectErrorType(lastSyncError) === "done_stuck") {
    return {
      category: "done_lane_stuck",
      shortLabel: "Done stuck",
      message: extractMessage(lastSyncError),
      rawError: lastSyncError,
      autoRecoverable: true,
      recoveryHint: "恢复 tick 将在下次运行时验证 PR 状态并尝试恢复（每 10 分钟）",
      suggestions: [
        "等待恢复 tick 自动处理（约 10 分钟）",
        "手动合并 PR 后系统会自动同步状态",
      ],
    };
  }

  // 10. Merge conflict detected
  if (lastSyncError.includes("Merge conflicts") || lastSyncError.includes("conflict")) {
    return {
      category: "conflict_detected",
      shortLabel: "Merge conflict",
      message: lastSyncError,
      rawError: lastSyncError,
      autoRecoverable: true,
      recoveryHint: "冲突解决 specialist 将自动尝试 rebase",
      suggestions: [
        "等待 conflict-resolver 自动尝试 rebase",
        "如果自动解决失败，手动在 PR 分支解决冲突后推送",
      ],
    };
  }

  // 11. Fallback
  return {
    category: "unknown_error",
    shortLabel: "Error",
    message: lastSyncError,
    rawError: lastSyncError,
    autoRecoverable: false,
    suggestions: ["检查详情面板中的完整错误信息"],
  };
}
