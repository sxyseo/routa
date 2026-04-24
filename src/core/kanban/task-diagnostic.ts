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
  | "unknown_error";

export interface TaskDiagnostic {
  category: TaskDiagnosticCategory;
  shortLabel: string;
  message: string;
  rawError?: string;
  autoRecoverable: boolean;
  recoveryHint?: string;
  suggestions: string[];
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

function parseResetCount(lastSyncError: string | undefined): number {
  if (!lastSyncError) return 0;
  const match = lastSyncError.match(/\[circuit-breaker:reset=(\d+)\]/);
  return match ? parseInt(match[1], 10) : (lastSyncError.startsWith(CB_MARKER) ? 0 : 0);
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
  if (lastSyncError.startsWith(CB_MARKER)) {
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
        : lastSyncError.replace(/\[circuit-breaker:reset=\d+\]\s*/, ""),
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
  if (lastSyncError.startsWith(RATE_MARKER)) {
    return {
      category: "rate_limited",
      shortLabel: "Rate limited",
      message: lastSyncError.replace(/\[rate-limited\]\s*/, ""),
      rawError: lastSyncError,
      autoRecoverable: true,
      recoveryHint: "API 限速恢复后自动重试",
      suggestions: ["等待限速解除后自动恢复"],
    };
  }

  // 3. Dependency blocked
  if (lastSyncError.startsWith("Blocked by unfinished dependencies")) {
    const deps = lastSyncError
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
  if (lastSyncError.startsWith("Stopped Kanban automation for")) {
    const nameMatch = lastSyncError.match(/for "(.+?)"/);
    const countMatch = lastSyncError.match(/after (\d+) runs/);
    return {
      category: "retry_limit",
      shortLabel: "Auto limit",
      message: lastSyncError,
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
  if (lastSyncError.startsWith(PR_FAILURE_PREFIX) || lastSyncError.includes("Auto PR creation failed")) {
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

  // 8. Fallback
  return {
    category: "unknown_error",
    shortLabel: "Error",
    message: lastSyncError,
    rawError: lastSyncError,
    autoRecoverable: false,
    suggestions: ["检查详情面板中的完整错误信息"],
  };
}
