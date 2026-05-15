/**
 * Decision Classifier unit tests.
 */
import { describe, it, expect } from "vitest";
import { classifyDiagnostics } from "../decision-classifier";
import { createInMemoryOverseerStateStore } from "../overseer-state-store";
import type { OverseerDiagnostic } from "../diagnostics";

function makeDiagnostic(
  pattern: OverseerDiagnostic["pattern"],
  taskId: string,
  category: OverseerDiagnostic["category"] = "AUTO",
): OverseerDiagnostic {
  return {
    pattern,
    category,
    taskId,
    description: `Test: ${pattern} for ${taskId}`,
    details: {},
  };
}

describe("DecisionClassifier", () => {
  it("should classify diagnostics with correct actions", async () => {
    const store = createInMemoryOverseerStateStore();
    const diagnostics: OverseerDiagnostic[] = [
      makeDiagnostic("stale-trigger-session", "task-1"),
      makeDiagnostic("orphan-worktree", "task-2"),
      makeDiagnostic("dependency-block-resolved", "task-3"),
    ];

    const decisions = await classifyDiagnostics(diagnostics, store);
    expect(decisions).toHaveLength(3);
    expect(decisions[0].action).toBe("clear-trigger-session");
    expect(decisions[1].action).toBe("clear-worktree-ref");
    expect(decisions[2].action).toBe("unblock-dependency");
  });

  it("should deduplicate same (pattern, taskId) within window", async () => {
    const store = createInMemoryOverseerStateStore();
    const diag = makeDiagnostic("stale-trigger-session", "task-1");

    // First classification
    const d1 = await classifyDiagnostics([diag], store);
    expect(d1).toHaveLength(1);

    // Second classification (should be deduped)
    const d2 = await classifyDiagnostics([diag], store);
    expect(d2).toHaveLength(0);
  });

  it("should respect resource limits per category", async () => {
    const store = createInMemoryOverseerStateStore();
    const diagnostics: OverseerDiagnostic[] = [];
    // Create 15 AUTO diagnostics (limit is 10)
    for (let i = 0; i < 15; i++) {
      diagnostics.push(makeDiagnostic("stale-trigger-session", `task-${i}`));
    }

    const decisions = await classifyDiagnostics(diagnostics, store);
    expect(decisions.length).toBeLessThanOrEqual(10);
  });

  it("should classify NOTIFY patterns correctly", async () => {
    const store = createInMemoryOverseerStateStore();
    const diagnostics: OverseerDiagnostic[] = [
      makeDiagnostic("orphan-in-progress", "task-1", "NOTIFY"),
    ];

    const decisions = await classifyDiagnostics(diagnostics, store);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].category).toBe("NOTIFY");
  });
});
