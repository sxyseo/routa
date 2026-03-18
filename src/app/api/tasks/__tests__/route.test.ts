import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus, type Task } from "@/core/models/task";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";

const taskStore = {
  listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
  listByAssignee: vi.fn<(_: string) => Promise<Task[]>>(),
  listByStatus: vi.fn<(_: string, __: TaskStatus) => Promise<Task[]>>(),
};

const artifactStore = new InMemoryArtifactStore();

const system = {
  taskStore,
  artifactStore,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET } from "../route";

describe("/api/tasks GET", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    taskStore.listByWorkspace.mockResolvedValue([
      createTask({
        id: "task-1",
        title: "Artifact summary",
        objective: "Return artifact counts with task list data.",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "dev",
        status: TaskStatus.IN_PROGRESS,
      }),
    ]);
    taskStore.listByAssignee.mockResolvedValue([]);
    taskStore.listByStatus.mockResolvedValue([]);
    await artifactStore.deleteByTask("task-1");
  });

  it("returns artifact summary counts with listed tasks", async () => {
    await artifactStore.saveArtifact(createArtifact({
      id: "artifact-1",
      type: "screenshot",
      taskId: "task-1",
      workspaceId: "workspace-1",
      status: "provided",
    }));
    await artifactStore.saveArtifact(createArtifact({
      id: "artifact-2",
      type: "logs",
      taskId: "task-1",
      workspaceId: "workspace-1",
      status: "provided",
    }));

    const response = await GET(new NextRequest("http://localhost/api/tasks?workspaceId=workspace-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.listByWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({
      id: "task-1",
      artifactSummary: {
        total: 2,
        byType: {
          screenshot: 1,
          logs: 1,
        },
      },
    });
  });
});
