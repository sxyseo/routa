import { describe, expect, it } from "vitest";
import { buildTaskPrompt } from "../agent-trigger";
import { createTask } from "../../models/task";

describe("buildTaskPrompt", () => {
  it("keeps backlog automation in planning mode", () => {
    const task = createTask({
      id: "task-1",
      title: "echo hello world",
      objective: "echo hello world",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("Treat backlog as planning and refinement, not implementation");
    expect(prompt).toContain("Do not move the card out of backlog from this planning step");
    expect(prompt).toContain("Do NOT create or sync GitHub issues during backlog planning.");
    expect(prompt).toContain("Do not use native tools such as Bash, Read, Write, Edit, Glob, or Grep in backlog planning");
    expect(prompt).toContain("decompose_tasks");
    expect(prompt).not.toContain("Start implementation work immediately");
  });

  it("keeps dev automation in implementation mode", () => {
    const task = createTask({
      id: "task-2",
      title: "Implement login form",
      objective: "Build the login screen",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("Start implementation work immediately");
    expect(prompt).toContain("move_card");
    expect(prompt).toContain("report_to_parent");
  });
});
