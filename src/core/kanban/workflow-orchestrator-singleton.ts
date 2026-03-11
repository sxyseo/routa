/**
 * Workflow Orchestrator Singleton
 *
 * Provides a global instance of the KanbanWorkflowOrchestrator.
 * Initialized when the RoutaSystem is created.
 */

import { KanbanWorkflowOrchestrator } from "./workflow-orchestrator";
import type { RoutaSystem } from "../routa-system";

// Use globalThis to survive HMR in Next.js dev mode
const GLOBAL_KEY = "__routa_workflow_orchestrator__";
const STARTED_KEY = "__routa_workflow_orchestrator_started__";

/**
 * Get or create the global KanbanWorkflowOrchestrator instance.
 */
export function getWorkflowOrchestrator(system: RoutaSystem): KanbanWorkflowOrchestrator {
  const g = globalThis as Record<string, unknown>;
  
  if (!g[GLOBAL_KEY]) {
    const orchestrator = new KanbanWorkflowOrchestrator(
      system.eventBus,
      system.kanbanBoardStore,
      system.taskStore,
    );
    g[GLOBAL_KEY] = orchestrator;
  }
  
  return g[GLOBAL_KEY] as KanbanWorkflowOrchestrator;
}

/**
 * Start the workflow orchestrator singleton. Idempotent across HMR restarts.
 */
export function startWorkflowOrchestrator(system: RoutaSystem): void {
  const g = globalThis as Record<string, unknown>;

  console.log("[WorkflowOrchestrator] startWorkflowOrchestrator called, already started:", !!g[STARTED_KEY]);

  if (g[STARTED_KEY]) {
    console.log("[WorkflowOrchestrator] Already started, skipping");
    return; // Already started
  }

  console.log("[WorkflowOrchestrator] Creating and starting orchestrator...");
  const orchestrator = getWorkflowOrchestrator(system);
  orchestrator.start();
  g[STARTED_KEY] = true;

  console.log("[WorkflowOrchestrator] Started listening for column transitions");
}

/**
 * Reset the orchestrator (for testing).
 */
export function resetWorkflowOrchestrator(): void {
  const g = globalThis as Record<string, unknown>;
  
  const orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;
  if (orchestrator) {
    orchestrator.stop();
  }
  
  delete g[GLOBAL_KEY];
  delete g[STARTED_KEY];
}

