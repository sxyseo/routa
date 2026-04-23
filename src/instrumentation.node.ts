/**
 * Next.js Instrumentation -- runs once on server startup.
 * Used to start the in-process cron scheduler for the local Node.js backend.
 *
 * This file is ONLY loaded by the Node.js runtime (Next.js convention).
 * The Edge Runtime loads instrumentation.ts instead, which is a no-op.
 *
 * Uses dynamic `await import()` instead of `require()` to prevent the Edge
 * Runtime bundler from tracing Node.js-only modules at build time.
 * Dynamic imports create separate lazy-loaded chunks that are never fetched
 * when `NEXT_RUNTIME !== "nodejs"`.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { trace } from "@opentelemetry/api";

function resolveRuntimeServicesDelayMs(): number {
  const rawValue = process.env.ROUTA_RUNTIME_SERVICES_DELAY_MS;
  if (!rawValue) {
    return 5_000;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5_000;
}

/**
 * Monkey-patch Node.js HTTP Server to intercept ALL incoming API requests.
 * This covers every route handler without touching any route file.
 * Runs in Node.js runtime only -- no Edge Runtime constraints.
 */
async function installHttpServerObserver(): Promise<void> {
  if (process.env.ROUTA_PERF_DISABLED === "1") return;

  const { performance } = await import("node:perf_hooks");
  const { metricsCollector } = await import("./core/http/performance-metrics");
  const http = await import("node:http");

  const THRESHOLD = Number(process.env.ROUTA_SLOW_API_THRESHOLD_MS) || 1000;
  const LOG_ALL = process.env.ROUTA_API_TIMING_LOG_ALL === "1";
  const originalEmit = http.Server.prototype.emit;

  http.Server.prototype.emit = function (event: string, ...args: unknown[]) {
    if (event !== "request" || args.length < 2) {
      return originalEmit.call(this, event, ...args);
    }

    const [req, res] = args as [import("node:http").IncomingMessage, import("node:http").ServerResponse];
    const url = req.url ?? "/";

    if (!url.startsWith("/api/")) {
      return originalEmit.call(this, event, ...args);
    }

    const start = performance.now();
    const originalEnd = res.end;

    // Wrap res.end to capture completion time
    const patchedEnd = function (this: import("node:http").ServerResponse, ...endArgs: unknown[]) {
      const durationMs = performance.now() - start;
      const shouldRecord = LOG_ALL || durationMs >= THRESHOLD;

      if (shouldRecord) {
        const pathname = url.split("?")[0];
        const record = {
          timestamp: new Date().toISOString(),
          route: pathname,
          method: req.method ?? "GET",
          pathname,
          search: url.includes("?") ? "?" + url.split("?")[1] : "",
          status: res.statusCode ?? 0,
          durationMs: Math.round(durationMs * 10) / 10,
          thresholdMs: THRESHOLD,
        };
        metricsCollector.recordRequest(record);
        if (durationMs >= THRESHOLD) {
          console.warn("[api:slow]", record);
        }
      }

      return (originalEnd as (...a: unknown[]) => unknown).apply(this, endArgs);
    } as unknown as typeof res.end;
    res.end = patchedEnd;

    return originalEmit.call(this, event, ...args);
  };
}

/** Safely call dispose() on an object if it has one. */
function tryDispose(obj: unknown, label: string): void {
  if (obj != null && typeof (obj as Record<string, unknown>).dispose === "function") {
    (obj as { dispose(): void }).dispose();
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let gracefulShutdown = false;

async function gracefulShutdownSequence(): Promise<void> {
  if (gracefulShutdown) return;
  gracefulShutdown = true;

  console.log("[instrumentation] Graceful shutdown initiated");

  // 1. Stop the in-process scheduler
  try {
    const { stopSchedulerService } = await import("./core/scheduling/scheduler-service");
    stopSchedulerService();
  } catch (err) {
    console.error("[instrumentation] Failed to stop scheduler service:", err);
  }

  // 2. Stop the background task worker
  try {
    const { getBackgroundWorker } = await import("./core/background-worker");
    getBackgroundWorker()?.stop();
  } catch (err) {
    console.error("[instrumentation] Failed to stop background worker:", err);
  }

  // 3. Stop the kanban lane scanner
  try {
    const { stopLaneScanner } = await import("./core/kanban/kanban-lane-scanner");
    stopLaneScanner();
  } catch (err) {
    console.error("[instrumentation] Failed to stop lane scanner:", err);
  }

  // 4. Reset the workflow orchestrator and session queue
  try {
    const { resetWorkflowOrchestrator } = await import("./core/kanban/workflow-orchestrator-singleton");
    resetWorkflowOrchestrator();
  } catch (err) {
    console.error("[instrumentation] Failed to reset workflow orchestrator:", err);
  }

  // 5. Kill all ACP agent processes
  try {
    const { getAcpProcessManager } = await import("./core/acp/opencode-process");
    await getAcpProcessManager().killAll();
  } catch (err) {
    console.error("[instrumentation] Failed to kill ACP processes:", err);
  }

  // 6. Dispose the HTTP session store
  try {
    const { getHttpSessionStore } = await import("./core/acp/http-session-store");
    const store = getHttpSessionStore();
    if (typeof store.forceCleanup === "function") {
      store.forceCleanup({ aggressive: true });
    }
  } catch (err) {
    console.error("[instrumentation] Failed to clean up HTTP session store:", err);
  }

  // 7. Dispose the EventBus
  try {
    const { getRoutaSystem } = await import("./core/routa-system");
    tryDispose(getRoutaSystem().eventBus, "EventBus");
  } catch (err) {
    console.error("[instrumentation] Failed to dispose EventBus:", err);
  }

  // 8. Dispose event broadcasters (if they implement dispose)
  try {
    const { getNoteEventBroadcaster } = await import("./core/notes/note-event-broadcaster");
    tryDispose(getNoteEventBroadcaster(), "note event broadcaster");
  } catch (err) {
    console.error("[instrumentation] Failed to dispose note event broadcaster:", err);
  }

  try {
    const { getKanbanEventBroadcaster } = await import("./core/kanban/kanban-event-broadcaster");
    tryDispose(getKanbanEventBroadcaster(), "kanban event broadcaster");
  } catch (err) {
    console.error("[instrumentation] Failed to dispose kanban event broadcaster:", err);
  }

  try {
    const { getSharedSessionEventBroadcaster } = await import("./core/shared-session/event-broadcaster");
    tryDispose(getSharedSessionEventBroadcaster(), "shared session event broadcaster");
  } catch (err) {
    console.error("[instrumentation] Failed to dispose shared session event broadcaster:", err);
  }

  // 9. Stop PR merge listener
  try {
    const { stopPrMergeListener } = await import("./core/kanban/pr-merge-listener");
    const { getRoutaSystem } = await import("./core/routa-system");
    stopPrMergeListener(getRoutaSystem().eventBus);
  } catch (err) {
    console.error("[instrumentation] Failed to stop PR merge listener:", err);
  }

  // 10. Stop GitHub workspace cleanup timer
  try {
    const { stopGithubWorkspaceCleanup } = await import("./core/github/github-workspace");
    stopGithubWorkspaceCleanup();
  } catch (err) {
    console.error("[instrumentation] Failed to stop GitHub workspace cleanup:", err);
  }

  // 11. Shutdown OpenTelemetry SDK (if it was initialized)
  try {
    const { shutdownNextRuntimeTelemetry } = await import("./core/telemetry/node-otel");
    await shutdownNextRuntimeTelemetry();
  } catch (err) {
    console.error("[instrumentation] Failed to shutdown telemetry:", err);
  }

  console.log("[instrumentation] Graceful shutdown complete");
}

function registerSignalHandlers(): void {
  const handler = (signal: string) => {
    console.log(`[instrumentation] Received ${signal}, initiating graceful shutdown`);
    void gracefulShutdownSequence().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}

// ---------------------------------------------------------------------------
// Next.js instrumentation hooks (Node.js runtime only)
// ---------------------------------------------------------------------------

export async function register() {
  // Mirror all console output to log/ directory (per-day rotation)
  const { installConsoleFileLogger } = await import("./core/logging/file-logger");
  installConsoleFileLogger();

  // Install HTTP server-level observer for full API route coverage
  await installHttpServerObserver();

  // Register signal handlers for graceful shutdown
  registerSignalHandlers();

  const { initializeNextRuntimeTelemetry } = await import(
    "./core/telemetry/node-otel"
  );
  const { startSchedulerService } = await import(
    "./core/scheduling/scheduler-service"
  );
  const { startBackgroundWorker } = await import(
    "./core/background-worker"
  );
  const telemetry = initializeNextRuntimeTelemetry();

  if (telemetry.enabled) {
    const span = trace
      .getTracer("routa.nextjs.runtime")
      .startSpan("routa.instrumentation.register");
    span.setAttribute("next.runtime", "nodejs");
    span.setAttribute("routa.otel.output_path", telemetry.outputPath ?? "");
    span.end();
  }

  // Delay startup slightly to let the HTTP server become ready
  setTimeout(() => {
    const servicesSpan = telemetry.enabled
      ? trace
        .getTracer("routa.nextjs.runtime")
        .startSpan("routa.runtime.services.start")
      : null;
    const skipRuntimeServices = process.env.ROUTA_SKIP_RUNTIME_SERVICES === "1";

    if (!skipRuntimeServices) {
      startSchedulerService();
      startBackgroundWorker();
    }

    // Eagerly initialize the RoutaSystem and hydrate sessions from DB
    // so the first API request doesn't bear the full cold-start cost.
    void (async () => {
      try {
        const { getRoutaSystem } = await import("./core/routa-system");
        const { getHttpSessionStore } = await import("./core/acp/http-session-store");
        const system = getRoutaSystem();
        await getHttpSessionStore().hydrateFromDb();
        console.log(`[instrumentation] RoutaSystem initialized (${Object.keys(system).length} stores)`);
      } catch (err) {
        console.error("[instrumentation] Failed to pre-initialize RoutaSystem:", err);
      }
    })();

    servicesSpan?.setAttribute("routa.scheduler.started", !skipRuntimeServices);
    servicesSpan?.setAttribute(
      "routa.background_worker.started",
      !skipRuntimeServices
    );
    servicesSpan?.end();
  }, resolveRuntimeServicesDelayMs());
}

/**
 * Next.js instrumentation hook -- called on server shutdown.
 * Delegates to the shared graceful shutdown sequence.
 */
export async function unregister() {
  await gracefulShutdownSequence();
}
