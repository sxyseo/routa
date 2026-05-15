/**
 * Overseer Subsystem — smart monitoring agent entry point.
 *
 * Initializes the state store, circuit breaker, and event listener.
 * The health tick is registered separately in scheduler-service.ts.
 */

import type { RoutaSystem } from "../routa-system";
import type { OverseerStateStore } from "./overseer-state-store";
import type { OverseerContext } from "./health-tick";
import {
  createInMemoryOverseerStateStore,
  createSqliteOverseerStateStore,
} from "./overseer-state-store";
import { OverseerCircuitBreaker } from "./circuit-breaker";
import { registerOverseerEventListener } from "./event-listener";

// ─── Singleton State ───────────────────────────────────────────────

let overseerContext: OverseerContext | null = null;

/**
 * Get the current overseer context (for use by the health tick).
 */
export function getOverseerContext(): OverseerContext | null {
  return overseerContext;
}

/**
 * Initialize and start the overseer subsystem.
 *
 * Creates:
 *   - State store (SQLite or in-memory depending on system configuration)
 *   - Circuit breaker (backed by state store)
 *   - Event listener (handles OVERSEER_ALERT events)
 */
export function startOverseer(system: RoutaSystem): void {
  if (overseerContext) {
    console.log("[Overseer] Already started, skipping");
    return;
  }

  // Create state store
  let stateStore: OverseerStateStore;

  if (system.isPersistent) {
    try {
      const { getSqliteDatabase } = require("../db/sqlite") as typeof import("../db/sqlite");
      const db = getSqliteDatabase();
      stateStore = createSqliteOverseerStateStore(db);
      console.log("[Overseer] Using SQLite state store");
    } catch {
      stateStore = createInMemoryOverseerStateStore();
      console.warn("[Overseer] SQLite unavailable, using in-memory state store");
    }
  } else {
    stateStore = createInMemoryOverseerStateStore();
    console.log("[Overseer] Using in-memory state store");
  }

  // Create circuit breaker
  const circuitBreaker = new OverseerCircuitBreaker(stateStore);

  // Create context
  overseerContext = { stateStore, circuitBreaker };

  // Register event listener for ESCALATE notifications
  registerOverseerEventListener(system.eventBus, stateStore);

  console.log("[Overseer] Subsystem started successfully");
}

/**
 * Stop the overseer subsystem and clean up.
 */
export function stopOverseer(): void {
  overseerContext = null;
  console.log("[Overseer] Subsystem stopped");
}

// ─── Re-exports ────────────────────────────────────────────────────

export { runOverseerHealthTick } from "./health-tick";
export type { OverseerContext } from "./health-tick";
export type { OverseerTickResult } from "./diagnostics";
export { collectSystemDiagnostics } from "./diagnostics";
export { classifyDiagnostics, toOverseerDecision } from "./decision-classifier";
export { OverseerCircuitBreaker } from "./circuit-breaker";
export {
  generateApprovalToken,
  verifyApprovalToken,
} from "./event-listener";
export {
  createInMemoryOverseerStateStore,
  createSqliteOverseerStateStore,
} from "./overseer-state-store";
