import { describe, expect, it } from "vitest";
import { createTask } from "../../models/task";
import type { Task } from "../../models/task";
import {
  buildTaskStoryReadinessChecks,
  validateTaskReadiness,
} from "../task-derived-summary";

function makeTask(overrides: {
  scope?: string;
  objective?: string;
  comment?: string;
  dependencies?: string[];
  parallelGroup?: string;
}) {
  return createTask({
    id: "test-task",
    title: "Test task",
    objective: overrides.objective ?? "Do something",
    workspaceId: "test-workspace",
    scope: overrides.scope,
    dependencies: overrides.dependencies,
    parallelGroup: overrides.parallelGroup,
  });
}

describe("buildTaskStoryReadinessChecks", () => {
  describe("dependenciesDeclared", () => {
    it("passes when dependencies array is non-empty", () => {
      const task = makeTask({ dependencies: ["task-1", "task-2"] });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(true);
      expect(checks.dependenciesDeclaredHint).toBeUndefined();
    });

    it("passes when parallel group is set", () => {
      const task = makeTask({ parallelGroup: "group-a" });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(true);
      expect(checks.dependenciesDeclaredHint).toBeUndefined();
    });

    // Canonical story unblock_condition path is covered by canonical-story.test.ts
    // The hasCanonicalDependencies flag flows directly into checkDependenciesDeclared

    // AC1: scope mentions external dependencies but dependencies array is empty → fail with hint
    it("fails with hint when scope mentions 'requires' and dependencies array is empty", () => {
      const task = makeTask({ scope: "Backend module that requires Redis for caching" });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
      expect(checks.dependenciesDeclaredHint).toContain("requires");
      expect(checks.dependenciesDeclaredHint).toContain("no dependencies are declared");
    });

    it("fails with hint when scope mentions 'depends on' and dependencies array is empty", () => {
      const task = makeTask({ scope: "Feature that depends on the payment API" });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
      expect(checks.dependenciesDeclaredHint).toContain("depends on");
    });

    it("fails with hint when scope mentions 'integrates with' and dependencies array is empty", () => {
      const task = makeTask({ scope: "Integrates with Slack for notifications" });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
      expect(checks.dependenciesDeclaredHint).toContain("Integrates with");
    });

    it("fails with hint when scope mentions 'uses' and dependencies array is empty", () => {
      const task = makeTask({ scope: "Uses PostgreSQL for data storage" });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
      expect(checks.dependenciesDeclaredHint).toContain("Uses");
    });

    it("fails with hint when scope mentions 'needs' and dependencies array is empty", () => {
      const task = makeTask({ scope: "Needs Docker to run integration tests" });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
    });

    it("fails with hint when scope mentions 'relies on' and dependencies array is empty", () => {
      const task = makeTask({ scope: "Relies on AWS S3 for file uploads" });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
    });

    it("fails with hint when scope mentions 'consumes' and dependencies array is empty", () => {
      const task = makeTask({ scope: "Consumes the billing microservice API" });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
    });

    // AC1: "no dependencies" text does NOT override scope dependency hints
    it("fails even when text says 'no dependencies' if scope mentions external dependencies", () => {
      const task = makeTask({
        scope: "Requires Redis for session management",
        objective: "Implement caching. No dependencies needed.",
      });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
      expect(checks.dependenciesDeclaredHint).toContain("Requires");
    });

    // AC2: no scope dependency hints + explicit "no dependencies" → pass
    it("passes when scope has no dependency hints and text explicitly says 'no dependencies'", () => {
      const task = makeTask({
        scope: "Refactor the internal utility module",
        objective: "Clean up code. No dependencies.",
      });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(true);
      expect(checks.dependenciesDeclaredHint).toBeUndefined();
    });

    // AC2: no scope hints, no explicit marking → fail
    it("fails when no dependencies, no scope hints, and no explicit marking", () => {
      const task = makeTask({
        scope: "Refactor the utility module",
        objective: "Clean up the codebase",
      });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(false);
      expect(checks.dependenciesDeclaredHint).toBeUndefined();
    });

    // Backward compatibility: narrative pattern match still works
    it("passes when narrative mentions 'depends on' without scope hints", () => {
      const task = makeTask({
        scope: "Internal refactor",
        objective: "This task depends on the API being available.",
      });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(true);
    });

    it("passes when narrative mentions 'dependency plan' without scope hints", () => {
      const task = makeTask({
        objective: "Work on the feature. Dependency plan: none needed.",
      });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(true);
    });

    it("passes when dependencies array is populated even if scope mentions external deps", () => {
      const task = makeTask({
        scope: "Requires Redis for caching",
        dependencies: ["redis-setup-task"],
      });
      const checks = buildTaskStoryReadinessChecks(task);
      expect(checks.dependenciesDeclared).toBe(true);
      expect(checks.dependenciesDeclaredHint).toBeUndefined();
    });
  });
});

describe("validateTaskReadiness", () => {
  it("includes dependencies_declared in missing when check fails with scope hints", () => {
    const task = makeTask({
      scope: "Requires Redis for caching",
      objective: "Implement caching layer",
    });
    const readiness = validateTaskReadiness(task, ["dependencies_declared"]);
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toContain("dependencies_declared");
    expect(readiness.checks.dependenciesDeclared).toBe(false);
    expect(readiness.checks.dependenciesDeclaredHint).toContain("Requires");
  });

  it("is ready when dependencies_declared passes and is required", () => {
    const task = makeTask({
      scope: "Internal refactor",
      objective: "Clean up. No dependencies.",
    });
    const readiness = validateTaskReadiness(task, ["dependencies_declared"]);
    expect(readiness.ready).toBe(true);
    expect(readiness.missing).not.toContain("dependencies_declared");
  });
});
