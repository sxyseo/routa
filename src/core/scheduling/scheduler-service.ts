/**
 * SchedulerService — in-process cron scheduler for the local Node.js backend.
 *
 * Uses node-cron to tick every minute and run the schedule dispatcher directly.
 * Only active outside Vercel production.
 *
 * In production on Vercel, the tick is handled by Vercel Cron Jobs instead.
 *
 * Registered ticks:
 *   - schedule tick: fires due user-defined schedules as background tasks
 *   - auto-archive tick: archives stale done cards to the archived column
 */

import nodeCron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { getRoutaSystem } from "../routa-system";
import { runScheduleTick } from "./run-schedule-tick";
import { runAutoArchiveTick } from "../kanban/auto-archive-tick";
import { runDoneLaneRecoveryTick, cleanupOrphanPendingMarkers } from "../kanban/done-lane-recovery-tick";
import { sweepStuckTasksOnStartup } from "../kanban/restart-recovery";
import { cleanupOrphanBranchesOnStartup } from "../kanban/orphan-branch-cleanup";
import { runWithSpan } from "../telemetry/tracing";
import { withHeartbeat } from "./system-heartbeat-registry";

let schedulerTask: ScheduledTask | null = null;
let autoArchiveTask: ScheduledTask | null = null;
let doneLaneRecoveryTask: ScheduledTask | null = null;
let overseerHealthTask: ScheduledTask | null = null;
let isStarted = false;

export function startSchedulerService(): void {
  if (isStarted) return;

  // Only start in-process scheduler outside Vercel production
  const isVercelProduction =
    process.env.VERCEL === "1" && process.env.NODE_ENV === "production";
  if (isVercelProduction) {
    console.log("[Scheduler] Skipping in-process scheduler (Vercel handles crons)");
    return;
  }

  console.log("[Scheduler] Starting in-process cron scheduler (every minute)");

  schedulerTask = nodeCron.schedule("* * * * *", () => {
    void runWithSpan(
      "routa.scheduler.tick_cycle",
      {},
      async (span) => {
        await withHeartbeat("schedule-tick", async () => {
          const result = await runScheduleTick(getRoutaSystem());
          span.setAttribute("routa.schedule.due_count", result.dueCount);
          span.setAttribute("routa.schedules.fired_count", result.fired);

          if (result.fired > 0) {
            console.log(`[Scheduler] Tick fired ${result.fired} schedule(s): ${result.scheduleIds.join(", ")}`);
          }
        });
      },
    ).catch((error) => {
      console.error("[Scheduler] Tick failed:", error);
    });
  });

  // Auto-archive tick runs every hour (minute 0 of every hour)
  autoArchiveTask = nodeCron.schedule("0 * * * *", () => {
    void runWithSpan(
      "routa.scheduler.auto_archive_tick",
      {},
      async (span) => {
        await withHeartbeat("auto-archive-tick", async () => {
          const result = await runAutoArchiveTick(getRoutaSystem());
          span.setAttribute("routa.auto_archive.examined", result.examined);
          span.setAttribute("routa.auto_archive.archived", result.archived);
          span.setAttribute("routa.auto_archive.skipped", result.skipped.length);
        });
      },
    ).catch((error) => {
      console.error("[Scheduler] Auto-archive tick failed:", error);
    });
  });

  // Done-lane recovery tick runs every 3 minutes to detect and recover
  // stuck tasks (webhook-lost merges, CB-exhausted PRs, orphan sessions).
  doneLaneRecoveryTask = nodeCron.schedule("*/3 * * * *", () => {
    void runWithSpan(
      "routa.scheduler.done_lane_recovery_tick",
      {},
      async (span) => {
        await withHeartbeat("done-lane-recovery-tick", async () => {
          const result = await runDoneLaneRecoveryTick(getRoutaSystem());
          span.setAttribute("routa.done_lane_recovery.examined", result.examined);
          span.setAttribute("routa.done_lane_recovery.recovered", result.recovered);
          span.setAttribute("routa.done_lane_recovery.conflicts", result.conflictResolved);
          span.setAttribute("routa.done_lane_recovery.stuck", result.stuckMarked);
        });
      },
    ).catch((error) => {
      console.error("[Scheduler] Done-lane recovery tick failed:", error);
    });
  });

  // Startup cleanup: clear orphan pending markers from interrupted sessions
  // so the first recovery tick can immediately re-detect stuck cards.
  void runWithSpan(
    "routa.scheduler.startup_cleanup",
    {},
    async () => {
      // Clean up orphan remote branches before marker cleanup, since
      // branch deletion is independent of task state recovery.
      await cleanupOrphanBranchesOnStartup();
      await cleanupOrphanPendingMarkers(getRoutaSystem());
      // Sweep permanently-stuck tasks (repeat-limit, CB max resets, step-resume limit)
      // so the LaneScanner and recovery ticks can re-evaluate on the fresh instance.
      await sweepStuckTasksOnStartup(getRoutaSystem());
    },
  ).catch((error) => {
    console.error("[Scheduler] Startup cleanup failed:", error);
  });

  // Overseer health tick runs every 5 minutes for smart monitoring
  overseerHealthTask = nodeCron.schedule("*/5 * * * *", () => {
    void runWithSpan(
      "routa.scheduler.overseer_health_tick",
      {},
      async (span) => {
        await withHeartbeat("overseer-health-tick", async () => {
          const { getOverseerContext, runOverseerHealthTick } = require("../overseer") as typeof import("../overseer");
          const ctx = getOverseerContext();
          if (!ctx) {
            console.warn("[Scheduler] Overseer context not initialized — skipping tick");
            return;
          }
          const result = await runOverseerHealthTick(getRoutaSystem(), ctx);
          span.setAttribute("routa.overseer.examined", result.examined);
          span.setAttribute("routa.overseer.auto_fixed", result.autoFixed);
          span.setAttribute("routa.overseer.notified", result.notified);
          span.setAttribute("routa.overseer.escalated", result.escalated);
          span.setAttribute("routa.overseer.errors", result.errors);
        });
      },
    ).catch((error) => {
      console.error("[Scheduler] Overseer health tick failed:", error);
    });
  });

  isStarted = true;
}

export function stopSchedulerService(): void {
  schedulerTask?.stop();
  autoArchiveTask?.stop();
  doneLaneRecoveryTask?.stop();
  overseerHealthTask?.stop();
  schedulerTask = null;
  autoArchiveTask = null;
  doneLaneRecoveryTask = null;
  overseerHealthTask = null;
  isStarted = false;
}
