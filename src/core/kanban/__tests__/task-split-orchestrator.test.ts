import { describe, it, expect, beforeEach } from "vitest";
import { executeSplit } from "../task-split-orchestrator";
import { InMemoryTaskStore } from "../../store/task-store";
import { createTask, TaskStatus } from "../../models/task";
import type { SubTaskDef } from "../task-split-topology";

describe("task-split-orchestrator", () => {
  let taskStore: InMemoryTaskStore;
  let parentTask: ReturnType<typeof createTask>;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    parentTask = createTask({
      id: "parent-1",
      title: "Parent Task",
      objective: "Do the big thing",
      workspaceId: "ws-1",
      boardId: "board-1",
      status: TaskStatus.PENDING,
      codebaseIds: ["cb-1"],
      labels: ["feature"],
    });
  });

  it("creates sub-tasks with parentTaskId and dependencies", async () => {
    await taskStore.save(parentTask);

    const subTasks: SubTaskDef[] = [
      { ref: "a", title: "Step A", objective: "First" },
      { ref: "b", title: "Step B", objective: "Second" },
      { ref: "c", title: "Step C", objective: "Third" },
    ];
    const edges: Array<[string, string]> = [["a", "b"], ["b", "c"]];

    const result = await executeSplit(parentTask, subTasks, edges, { taskStore });

    expect(result.childTaskIds).toHaveLength(3);
    expect(result.parentTaskId).toBe("parent-1");
    expect(result.plan.mergeStrategy).toBe("cascade");

    // Verify child A has no dependencies
    const childA = await taskStore.get(result.childTaskIds[0]);
    expect(childA?.parentTaskId).toBe("parent-1");
    expect(childA?.dependencies).toHaveLength(0);
    expect(childA?.codebaseIds).toEqual(["cb-1"]);

    // Verify child B depends on A
    const childB = await taskStore.get(result.childTaskIds[1]);
    expect(childB?.dependencies).toContain(result.childTaskIds[0]);

    // Verify child C depends on B
    const childC = await taskStore.get(result.childTaskIds[2]);
    expect(childC?.dependencies).toContain(result.childTaskIds[1]);
  });

  it("creates parallel sub-tasks with fan_in strategy", async () => {
    await taskStore.save(parentTask);

    const subTasks: SubTaskDef[] = [
      { ref: "a", title: "Task A", objective: "" },
      { ref: "b", title: "Task B", objective: "" },
    ];

    const result = await executeSplit(parentTask, subTasks, [], { taskStore });

    expect(result.plan.mergeStrategy).toBe("fan_in");
    expect(result.childTaskIds).toHaveLength(2);

    const childA = await taskStore.get(result.childTaskIds[0]);
    const childB = await taskStore.get(result.childTaskIds[1]);
    expect(childA?.dependencies).toHaveLength(0);
    expect(childB?.dependencies).toHaveLength(0);
  });

  it("rejects splitting non-splittable tasks", async () => {
    parentTask.status = TaskStatus.COMPLETED;
    await taskStore.save(parentTask);

    const subTasks: SubTaskDef[] = [
      { ref: "a", title: "A", objective: "" },
    ];

    await expect(
      executeSplit(parentTask, subTasks, [], { taskStore }),
    ).rejects.toThrow("cannot be split");
  });

  it("detects circular dependencies", async () => {
    await taskStore.save(parentTask);

    const subTasks: SubTaskDef[] = [
      { ref: "a", title: "A", objective: "" },
      { ref: "b", title: "B", objective: "" },
    ];
    const edges: Array<[string, string]> = [["a", "b"], ["b", "a"]];

    await expect(
      executeSplit(parentTask, subTasks, edges, { taskStore }),
    ).rejects.toThrow("Circular dependency");
  });

  it("reports file conflict warnings", async () => {
    await taskStore.save(parentTask);

    const subTasks: SubTaskDef[] = [
      { ref: "a", title: "A", objective: "", estimatedFilePaths: ["src/foo.ts"] },
      { ref: "b", title: "B", objective: "", estimatedFilePaths: ["src/foo.ts"] },
    ];

    const result = await executeSplit(parentTask, subTasks, [], { taskStore });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("src/foo.ts");
  });

  it("maintains bidirectional blocking relations", async () => {
    await taskStore.save(parentTask);

    const subTasks: SubTaskDef[] = [
      { ref: "a", title: "A", objective: "" },
      { ref: "b", title: "B", objective: "" },
    ];
    const edges: Array<[string, string]> = [["a", "b"]];

    const result = await executeSplit(parentTask, subTasks, edges, { taskStore });

    const childA = await taskStore.get(result.childTaskIds[0]);
    expect(childA?.blocking).toContain(result.childTaskIds[1]);
  });
});
