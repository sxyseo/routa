/**
 * Health Tick — main overseer tick function that runs every 5 minutes.
 *
 * Flow:
 *   1. Circuit breaker check
 *   2. Collect system diagnostics
 *   3. Classify into AUTO / NOTIFY / ESCALATE decisions
 *   4. Execute AUTO decisions
 *   5. Send NOTIFY messages
 *   6. Emit ESCALATE events (handled by event-listener)
 */

import type { RoutaSystem } from "../routa-system";
import type { OverseerTickResult } from "./diagnostics";
import { dependencyUnblockFields } from "../kanban/dependency-gate";
import { TaskStatus } from "../models/task";
import { safeAtomicSave } from "../kanban/atomic-task-update";
import { collectSystemDiagnostics } from "./diagnostics";
import { classifyDiagnostics, toOverseerDecision } from "./decision-classifier";
import type { OverseerStateStore } from "./overseer-state-store";
import type { ClassifiedDecision } from "./decision-classifier";
import { OverseerCircuitBreaker } from "./circuit-breaker";
import { getWeChatWorkChannel } from "../notifications/wechat-work-channel";
import { AgentEventType } from "../events/event-bus";

export interface OverseerContext {
  stateStore: OverseerStateStore;
  circuitBreaker: OverseerCircuitBreaker;
}

/**
 * Run a single overseer health tick.
 */
export async function runOverseerHealthTick(
  system: RoutaSystem,
  ctx: OverseerContext,
): Promise<OverseerTickResult> {
  const result: OverseerTickResult = {
    examined: 0,
    autoFixed: 0,
    notified: 0,
    escalated: 0,
    skipped: 0,
    errors: 0,
  };

  // 1. Circuit breaker check
  const isAvailable = await ctx.circuitBreaker.isAvailable();
  if (!isAvailable) {
    console.warn("[Overseer] Circuit breaker is open — skipping tick");
    return result;
  }

  try {
    // 2. Collect diagnostics
    const diagnostics = await collectSystemDiagnostics(system);
    result.examined = diagnostics.length;

    // 3. Classify
    const decisions = await classifyDiagnostics(diagnostics, ctx.stateStore);

    // 4. Execute decisions by category
    const autoDecisions = decisions.filter((d) => d.category === "AUTO");
    const notifyDecisions = decisions.filter((d) => d.category === "NOTIFY");
    const escalateDecisions = decisions.filter((d) => d.category === "ESCALATE");

    // Execute AUTO
    for (const decision of autoDecisions) {
      try {
        await executeAutoDecision(system, decision);
        result.autoFixed++;
      } catch (err) {
        console.error(`[Overseer] AUTO fix failed for ${decision.pattern}:`, err);
        result.errors++;
      }
    }

    // Execute NOTIFY
    const wechatChannel = getWeChatWorkChannel();
    for (const decision of notifyDecisions) {
      try {
        await executeNotifyDecision(system, decision, wechatChannel);
        result.notified++;
      } catch (err) {
        console.error(`[Overseer] NOTIFY failed for ${decision.pattern}:`, err);
        result.errors++;
      }
    }

    // Persist and emit ESCALATE
    for (const decision of escalateDecisions) {
      try {
        await ctx.stateStore.saveDecision(toOverseerDecision(decision));
        system.eventBus.emit({
          type: AgentEventType.OVERSEER_ALERT,
          agentId: "overseer",
          workspaceId: "default",
          data: {
            decisionId: decision.id,
            pattern: decision.pattern,
            taskId: decision.taskId,
            category: decision.category,
            description: decision.description,
            details: decision.details,
          },
          timestamp: new Date(),
        });
        result.escalated++;
      } catch (err) {
        console.error(`[Overseer] ESCALATE failed for ${decision.pattern}:`, err);
        result.errors++;
      }
    }

    // Record success
    await ctx.circuitBreaker.recordSuccess();

    if (result.autoFixed > 0 || result.notified > 0 || result.escalated > 0) {
      console.log(
        `[Overseer] Tick complete: examined=${result.examined} auto=${result.autoFixed} ` +
        `notify=${result.notified} escalate=${result.escalated} errors=${result.errors}`,
      );
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Overseer] Tick failed:", errorMsg);
    await ctx.circuitBreaker.recordFailure(errorMsg);
    result.errors++;
  }

  return result;
}

// ─── AUTO executors ────────────────────────────────────────────────

async function executeAutoDecision(
  system: RoutaSystem,
  decision: ClassifiedDecision,
): Promise<void> {
  switch (decision.action) {
    case "clear-trigger-session": {
      const task = await system.taskStore.get(decision.taskId);
      if (task) {
        await safeAtomicSave(task, system.taskStore, {
          triggerSessionId: null,
          updatedAt: new Date(),
        }, "Overseer clear-trigger-session");
        console.log(`[Overseer] AUTO: Cleared stale triggerSessionId for task ${decision.taskId}`);
      }
      break;
    }

    case "clear-pending-marker": {
      const task = await system.taskStore.get(decision.taskId);
      if (task) {
        const cleanedComment = (task.comment ?? "")
          .replace(/\[auto-merger-pending\]/g, "")
          .replace(/\[automation-limit\]/g, "")
          .replace(/\[pending-review\]/g, "")
          .trim();
        await safeAtomicSave(task, system.taskStore, {
          comment: cleanedComment || null,
          updatedAt: new Date(),
        }, "Overseer clear-pending-marker");
        console.log(`[Overseer] AUTO: Cleared pending marker for task ${decision.taskId}`);
      }
      break;
    }

    case "clear-worktree-ref": {
      const task = await system.taskStore.get(decision.taskId);
      if (task) {
        await safeAtomicSave(task, system.taskStore, {
          worktreeId: null,
          updatedAt: new Date(),
        }, "Overseer clear-worktree-ref");
        console.log(`[Overseer] AUTO: Cleared orphan worktree ref for task ${decision.taskId}`);
      }
      break;
    }

    case "unblock-dependency": {
      const task = await system.taskStore.get(decision.taskId);
      if (task) {
        const fields = dependencyUnblockFields();
        // If task is stuck in non-standard "blocked" column, move it back to backlog
        // so LaneScanner can pick it up.
        const columnOverride = task.columnId === "blocked" ? { columnId: "backlog" } : {};
        await safeAtomicSave(task, system.taskStore, {
          ...fields,
          ...columnOverride,
        }, "Overseer unblock-dependency");
        console.log(`[Overseer] AUTO: Unblocked dependencies for task ${decision.taskId}`);
        system.eventBus.emit({
          type: AgentEventType.COLUMN_TRANSITION,
          agentId: "overseer",
          workspaceId: task.workspaceId,
          data: {
            cardId: task.id,
            cardTitle: task.title,
            boardId: task.boardId ?? "",
            workspaceId: task.workspaceId,
            fromColumnId: task.columnId ?? "",
            toColumnId: task.columnId ?? "",
            fromColumnName: "",
            toColumnName: "",
            source: { type: "dependency_unblock" },
          },
          timestamp: new Date(),
        });
      }
      break;
    }

    case "mark-completed": {
      const task = await system.taskStore.get(decision.taskId);
      if (task) {
        await safeAtomicSave(task, system.taskStore, {
          status: TaskStatus.COMPLETED,
          columnId: "done",
          lastSyncError: null,
          updatedAt: new Date(),
        }, "Overseer mark-completed (webhook-lost-pr-merge)");
        console.log(`[Overseer] AUTO: Marked task ${decision.taskId} as COMPLETED (merged PR but wrong status)`);
      }
      break;
    }

    case "retry-version-conflict": {
      const task = await system.taskStore.get(decision.taskId);
      if (task) {
        // safeAtomicSave handles version increment internally via atomicUpdate.
        // No need to manually bump version — the optimistic lock will retry on conflict.
        await safeAtomicSave(task, system.taskStore, {
          lastSyncError: null,
          updatedAt: new Date(),
        }, "Overseer retry-version-conflict");
        console.log(`[Overseer] AUTO: Retried version conflict for task ${decision.taskId}`);
      }
      break;
    }

    case "reset-orphan-session": {
      const task = await system.taskStore.get(decision.taskId);
      if (task) {
        const filteredSessions = task.columnId && task.laneSessions
          ? task.laneSessions.filter(
              (s: { columnId?: string }) => s.columnId !== task.columnId,
            )
          : task.laneSessions;
        const cleanedComment = (task.comment ?? "")
          .replace(/\[automation-limit\]/g, "")
          .replace(/\[auto-merger-pending\]/g, "")
          .replace(/\[pending-review\]/g, "")
          .trim();
        await safeAtomicSave(task, system.taskStore, {
          triggerSessionId: null,
          laneSessions: filteredSessions,
          comment: cleanedComment || null,
          updatedAt: new Date(),
        }, "Overseer reset-orphan-session");
        console.log(`[Overseer] AUTO: Reset orphan session for task ${decision.taskId} — LaneScanner will re-pickup`);

        // Notify Orchestrator to clear any zombie activeAutomations entry.
        // The Overseer can only clean persisted state (triggerSessionId);
        // the in-memory Map on Orchestrator is invisible to us, so we emit
        // a transition event with orphan_cleanup source so Orchestrator
        // can clear the zombie before re-triggering.
        if (task.columnId && task.boardId) {
          system.eventBus.emit({
            type: AgentEventType.COLUMN_TRANSITION,
            agentId: "overseer-orphan-cleanup",
            workspaceId: task.workspaceId,
            data: {
              cardId: task.id,
              cardTitle: task.title,
              boardId: task.boardId,
              workspaceId: task.workspaceId,
              fromColumnId: task.columnId,
              toColumnId: task.columnId,
              source: { type: "orphan_cleanup" },
            } as unknown as Record<string, unknown>,
            timestamp: new Date(),
          });
        }
      }
      break;
    }

    default:
      console.log(`[Overseer] AUTO: No-op for action ${decision.action}`);
  }
}

// ─── NOTIFY executor ───────────────────────────────────────────────

async function executeNotifyDecision(
  system: RoutaSystem,
  decision: ClassifiedDecision,
  wechatChannel: ReturnType<typeof getWeChatWorkChannel>,
): Promise<void> {
  // Execute the underlying fix
  await executeAutoDecision(system, decision);

  // Send notification
  await wechatChannel.sendNotification({
    pattern: decision.pattern,
    taskId: decision.taskId,
    description: decision.description,
  });

  console.log(`[Overseer] NOTIFY: ${decision.pattern} for task ${decision.taskId}`);
}
