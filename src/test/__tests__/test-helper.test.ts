/**
 * Test Helper Module Verification
 *
 * This test verifies that the test-helper.ts module can be properly imported and used.
 */

import { describe, expect, it } from "vitest";

describe("test-helper module import verification", () => {
  it("can import GenerateTestId", async () => {
    const { generateTestId } = await import("@/test/test-helper");
    const id = generateTestId("verify");
    expect(id).toMatch(/^verify-/);
  });

  it("can import createTestTask", async () => {
    const { createTestTask } = await import("@/test/test-helper");
    const task = createTestTask();
    expect(task.id).toMatch(/^task-/);
    expect(task.title).toBe("Test Task");
  });

  it("can import createTestAgent", async () => {
    const { createTestAgent } = await import("@/test/test-helper");
    const agent = createTestAgent();
    expect(agent.id).toMatch(/^agent-/);
    expect(agent.name).toBe("Test Agent");
  });

  it("can import createTestKanbanColumn", async () => {
    const { createTestKanbanColumn } = await import("@/test/test-helper");
    const column = createTestKanbanColumn();
    expect(column.id).toMatch(/^column-/);
    expect(column.name).toBe("Backlog");
  });

  it("can import createTestArtifact", async () => {
    const { createTestArtifact } = await import("@/test/test-helper");
    const artifact = createTestArtifact();
    expect(artifact.id).toMatch(/^artifact-/);
    expect(artifact.type).toBe("screenshot");
  });

  it("can import createMockDependency", async () => {
    const { createMockDependency } = await import("@/test/test-helper");
    const { mock, verifyCalled } = createMockDependency<() => string>({
      implementation: () => "test",
    });
    expect(mock()).toBe("test");
    verifyCalled();
  });

  it("can import createTestWorkspace", async () => {
    const { createTestWorkspace } = await import("@/test/test-helper");
    const workspace = createTestWorkspace();
    expect(workspace.id).toMatch(/^workspace-/);
    expect(workspace.title).toBe("Test Workspace");
  });

  it("can import createTestNote", async () => {
    const { createTestNote } = await import("@/test/test-helper");
    const note = createTestNote();
    expect(note.id).toMatch(/^note-/);
    expect(note.title).toBe("Test Note");
  });

  it("can import createTestBoard", async () => {
    const { createTestBoard } = await import("@/test/test-helper");
    const board = createTestBoard();
    expect(board.id).toMatch(/^board-/);
    expect(board.columns).toHaveLength(3);
  });

  it("can import asyncTestUtils", async () => {
    const { asyncTestUtils } = await import("@/test/test-helper");
    const { promise, resolve } = asyncTestUtils.createDeferred<string>();
    resolve("test");
    const result = await promise;
    expect(result).toBe("test");
  });

  it("can import waitForCondition", async () => {
    const { waitForCondition } = await import("@/test/test-helper");
    let counter = 0;
    const condition = () => {
      counter++;
      return counter >= 2;
    };
    const result = await waitForCondition(condition, 100, 10);
    expect(result).toBe(true);
  });
});