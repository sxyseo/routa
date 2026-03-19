import { describe, expect, it } from "vitest";
import { resolveEffectiveTaskAutomation, resolveKanbanAutomationStep } from "../effective-task-automation";

describe("resolveEffectiveTaskAutomation", () => {
  it("falls back to the current lane automation when the card has no override", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "backlog",
      },
      [
        {
          id: "backlog",
          automation: {
            enabled: true,
            steps: [{
              id: "refine",
              providerId: "claude",
              role: "ROUTA",
              specialistId: "backlog-refiner",
              specialistName: "Backlog Refiner",
            }],
          },
        },
      ],
    );

    expect(resolved.canRun).toBe(true);
    expect(resolved.source).toBe("lane");
    expect(resolved.providerId).toBe("claude");
    expect(resolved.role).toBe("ROUTA");
    expect(resolved.specialistId).toBe("backlog-refiner");
    expect(resolved.specialistName).toBe("Backlog Refiner");
    expect(resolved.steps).toHaveLength(1);
    expect(resolved.stepIndex).toBe(0);
    expect(resolved.step?.id).toBe("refine");
  });

  it("prefers explicit card overrides over lane defaults", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "backlog",
        assignedProvider: "codex",
        assignedRole: "DEVELOPER",
        assignedSpecialistId: "implementor",
        assignedSpecialistName: "Implementor",
      },
      [
        {
          id: "backlog",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "ROUTA",
            specialistId: "backlog-refiner",
            specialistName: "Backlog Refiner",
          },
        },
      ],
    );

    expect(resolved.canRun).toBe(true);
    expect(resolved.source).toBe("card");
    expect(resolved.providerId).toBe("codex");
    expect(resolved.role).toBe("DEVELOPER");
    expect(resolved.specialistId).toBe("implementor");
    expect(resolved.specialistName).toBe("Implementor");
  });

  it("returns no runnable automation when neither the card nor lane is configured", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "backlog",
      },
      [
        {
          id: "backlog",
          automation: {
            enabled: false,
            providerId: "claude",
          },
        },
      ],
    );

    expect(resolved.canRun).toBe(false);
    expect(resolved.source).toBe("none");
    expect(resolved.providerId).toBeUndefined();
    expect(resolved.role).toBeUndefined();
  });

  it("inherits provider and role defaults from the selected specialist", () => {
    const resolveSpecialist = (id: string) => id === "kanban-dev-executor"
      ? {
        name: "Kanban Dev Executor",
        role: "CRAFTER",
        defaultProvider: "claude",
      }
      : undefined;

    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "dev",
      },
      [
        {
          id: "dev",
          automation: {
            enabled: true,
            steps: [{
              id: "implement",
              specialistId: "kanban-dev-executor",
            }],
          },
        },
      ],
      resolveSpecialist,
    );

    expect(resolved.providerId).toBe("claude");
    expect(resolved.role).toBe("CRAFTER");
    expect(resolved.specialistName).toBe("Kanban Dev Executor");
    expect(resolved.step).toMatchObject({
      providerId: "claude",
      role: "CRAFTER",
      specialistName: "Kanban Dev Executor",
    });
  });

  it("resolves a single step with specialist execution defaults", () => {
    const resolved = resolveKanbanAutomationStep(
      {
        id: "review",
        specialistId: "review-guard",
      },
      (id) => id === "review-guard"
        ? {
          name: "Review Guard",
          role: "GATE",
          defaultProvider: "codex",
        }
        : undefined,
    );

    expect(resolved).toMatchObject({
      id: "review",
      specialistId: "review-guard",
      specialistName: "Review Guard",
      role: "GATE",
      providerId: "codex",
    });
  });
});
