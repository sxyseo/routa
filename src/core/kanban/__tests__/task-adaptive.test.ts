import { describe, expect, it } from "vitest";
import { buildKanbanTaskAdaptiveHarnessOptions, stripSpeculativeKanbanTaskAdaptiveSnapshot } from "../task-adaptive";

describe("buildKanbanTaskAdaptiveHarnessOptions", () => {
  it("does not emit task-adaptive hints for fresh backlog cards without confirmed context", () => {
    const options = buildKanbanTaskAdaptiveHarnessOptions("Fallback prompt", {
      locale: "en",
      role: "CRAFTER",
      task: {
        id: "task-backlog-fresh",
        title: "Investigate new feature request",
        columnId: "backlog",
        triggerSessionId: "session-1",
      },
    });

    expect(options).toBeUndefined();
  });

  it("forwards task context search spec into task-adaptive harness hints", () => {
    const options = buildKanbanTaskAdaptiveHarnessOptions("Fallback prompt", {
      locale: "en",
      role: "CRAFTER",
      task: {
        id: "task-1",
        title: "Investigate JIT Context",
        columnId: "backlog",
        triggerSessionId: "session-1",
        contextSearchSpec: {
          query: "kanban jit context card detail",
          featureCandidates: ["kanban-workflow", "session-recovery"],
          relatedFiles: [
            "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
            "src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx",
          ],
          routeCandidates: ["/workspace/:workspaceId/kanban"],
          apiCandidates: ["POST /api/tasks"],
          moduleHints: ["kanban-card-detail"],
          symptomHints: ["operation not permitted"],
        },
      },
    });

    expect(options).toMatchObject({
      taskId: "task-1",
      taskLabel: "Investigate JIT Context",
      query: "kanban jit context card detail",
      taskType: "planning",
      locale: "en",
      role: "CRAFTER",
      historySessionIds: ["session-1"],
      featureIds: ["kanban-workflow", "session-recovery"],
      filePaths: [
        "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
        "src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx",
      ],
      routeCandidates: ["/workspace/:workspaceId/kanban"],
      apiCandidates: ["POST /api/tasks"],
      moduleHints: ["kanban-card-detail"],
      symptomHints: ["operation not permitted"],
    });
  });

  it("falls back to the task title when no explicit context query exists", () => {
    const options = buildKanbanTaskAdaptiveHarnessOptions("Fallback prompt", {
      task: {
        id: "task-2",
        title: "Fix Kanban card detail JIT context",
        columnId: "todo",
      },
    });

    expect(options).toMatchObject({
      taskLabel: "Fix Kanban card detail JIT context",
      query: "Fix Kanban card detail JIT context",
      taskType: "planning",
    });
  });

  it("strips speculative backlog snapshots until context is confirmed", () => {
    const sanitized = stripSpeculativeKanbanTaskAdaptiveSnapshot({
      id: "task-3",
      title: "Backlog issue import",
      columnId: "backlog",
      jitContextSnapshot: {
        generatedAt: "2026-04-22T08:00:00.000Z",
        summary: "Speculative snapshot",
        matchConfidence: "high" as const,
        matchReasons: ["Matched a weak feature candidate"],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: ["session-1"],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      },
    });

    expect(sanitized.jitContextSnapshot).toBeUndefined();
  });
});
