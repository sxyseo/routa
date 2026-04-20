/**
 * Next.js Instrumentation — runs once on server startup.
 * Used to start the in-process cron scheduler for the local Node.js backend.
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
 * Runs in Node.js runtime only — no Edge Runtime constraints.
 */
function installHttpServerObserver(): void {
  if (process.env.ROUTA_PERF_DISABLED === "1") return;

  const { performance } = require("node:perf_hooks") as typeof import("node:perf_hooks");
  const { metricsCollector } = require("./core/http/performance-metrics") as typeof import("./core/http/performance-metrics");
  const http = require("node:http") as typeof import("node:http");

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

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Install HTTP server-level observer for full API route coverage
    installHttpServerObserver();

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

      servicesSpan?.setAttribute("routa.scheduler.started", !skipRuntimeServices);
      servicesSpan?.setAttribute(
        "routa.background_worker.started",
        !skipRuntimeServices
      );
      servicesSpan?.end();
    }, resolveRuntimeServicesDelayMs());
  }
}
