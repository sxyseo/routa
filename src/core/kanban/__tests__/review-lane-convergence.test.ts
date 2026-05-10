import { describe, expect, it } from "vitest";

import { createTask } from "../../models/task";
import { VerificationVerdict } from "../../models/task";
import { createKanbanBoard } from "../../models/kanban";
import { resolveReviewLaneConvergenceTarget } from "../review-lane-convergence";

describe("review lane convergence", () => {
  it("moves approved review verdicts to done after the final review step", () => {
    const board = createKanbanBoard({
      id: "board-review-1",
      workspaceId: "default",
      name: "Board",
      columns: [
        { id: "backlog", name: "Backlog", stage: "backlog", position: 0 },
        { id: "todo", name: "Todo", stage: "todo", position: 1 },
        { id: "dev", name: "Dev", stage: "dev", position: 2 },
        {
          id: "review",
          name: "Review",
          stage: "review",
          position: 3,
          automation: {
            enabled: true,
            steps: [
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "done", name: "Done", stage: "done", position: 4 },
        { id: "blocked", name: "Blocked", stage: "blocked", position: 5 },
      ],
    });

    const task = createTask({
      id: "task-review-1",
      title: "Approve final review",
      objective: "Converge review lane after Review Guard writes a verdict",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
    });
    task.assignedSpecialistId = "kanban-review-guard";
    task.assignedSpecialistName = "Review Guard";
    task.verificationVerdict = VerificationVerdict.APPROVED;

    expect(resolveReviewLaneConvergenceTarget(task, board.columns)).toBe("done");
  });

  it("sends not-approved verdicts back to dev", () => {
    const board = createKanbanBoard({
      id: "board-review-2",
      workspaceId: "default",
      name: "Board",
      columns: [
        { id: "dev", name: "Dev", stage: "dev", position: 0 },
        {
          id: "review",
          name: "Review",
          stage: "review",
          position: 1,
          automation: {
            enabled: true,
            steps: [
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "done", name: "Done", stage: "done", position: 2 },
      ],
    });

    const task = createTask({
      id: "task-review-2",
      title: "Fail review",
      objective: "Send back to dev when review guard rejects",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
    });
    task.assignedSpecialistId = "kanban-review-guard";
    task.assignedSpecialistName = "Review Guard";
    task.verificationVerdict = VerificationVerdict.NOT_APPROVED;

    expect(resolveReviewLaneConvergenceTarget(task, board.columns)).toBe("dev");
  });

  it("overrides LLM APPROVED verdict when pre-gate blockers exist", () => {
    const board = createKanbanBoard({
      id: "board-pregate",
      workspaceId: "default",
      name: "Board",
      columns: [
        { id: "dev", name: "Dev", stage: "dev", position: 0 },
        {
          id: "review",
          name: "Review",
          stage: "review",
          position: 1,
          automation: {
            enabled: true,
            steps: [
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "done", name: "Done", stage: "done", position: 2 },
      ],
    });

    const task = createTask({
      id: "task-pregate-1",
      title: "Pre-gate blocked",
      objective: "LLM approved but pre-gate found violations",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
    });
    task.assignedSpecialistId = "kanban-review-guard";
    task.assignedSpecialistName = "Review Guard";
    task.verificationVerdict = VerificationVerdict.APPROVED;
    task.lastSyncError = "[pre-gate-blocked] [C9] server/src/routes/stats.ts:118: res.send() used";

    // Even though LLM said APPROVED, pre-gate blocker forces back to dev
    expect(resolveReviewLaneConvergenceTarget(task, board.columns)).toBe("dev");
  });

  it("blocks via preGateBlockers field even when lastSyncError is cleared", () => {
    const board = createKanbanBoard({
      id: "board-pregate2",
      workspaceId: "default",
      name: "Board",
      columns: [
        { id: "dev", name: "Dev", stage: "dev", position: 0 },
        {
          id: "review",
          name: "Review",
          stage: "review",
          position: 1,
          automation: {
            enabled: true,
            steps: [
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "done", name: "Done", stage: "done", position: 2 },
      ],
    });

    const task = createTask({
      id: "task-pregate-2",
      title: "Persistent pre-gate blocker",
      objective: "preGateBlockers survives lastSyncError cleanup",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
    });
    task.assignedSpecialistId = "kanban-review-guard";
    task.assignedSpecialistName = "Review Guard";
    task.verificationVerdict = VerificationVerdict.APPROVED;
    // lastSyncError was cleared by session start, but preGateBlockers persists
    task.preGateBlockers = "[C10] server/src/routes/stats.ts:45: console.log found";

    expect(resolveReviewLaneConvergenceTarget(task, board.columns)).toBe("dev");
  });
});
