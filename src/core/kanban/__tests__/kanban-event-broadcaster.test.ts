import { describe, expect, it } from "vitest";
import { KanbanEventBroadcaster } from "../kanban-event-broadcaster";

function createController() {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  const controller = {
    enqueue(value: Uint8Array) {
      chunks.push(decoder.decode(value));
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, chunks };
}

describe("KanbanEventBroadcaster", () => {
  it("broadcasts only to subscribers in the matching workspace", () => {
    const broadcaster = new KanbanEventBroadcaster();
    const workspaceA = createController();
    const workspaceB = createController();

    broadcaster.attach("workspace-a", workspaceA.controller);
    broadcaster.attach("workspace-b", workspaceB.controller);

    broadcaster.notify({
      workspaceId: "workspace-a",
      entity: "task",
      action: "moved",
      resourceId: "task-1",
      source: "agent",
    });

    expect(workspaceA.chunks.some((chunk) => chunk.includes("\"workspaceId\":\"workspace-a\""))).toBe(true);
    expect(workspaceA.chunks.some((chunk) => chunk.includes("\"action\":\"moved\""))).toBe(true);
    expect(workspaceB.chunks.some((chunk) => chunk.includes("\"action\":\"moved\""))).toBe(false);
  });

  it("broadcasts kanban:archived events to matching workspace", () => {
    const broadcaster = new KanbanEventBroadcaster();
    const workspaceA = createController();
    const workspaceB = createController();

    broadcaster.attach("workspace-a", workspaceA.controller);
    broadcaster.attach("workspace-b", workspaceB.controller);

    broadcaster.notifyArchived({
      cardId: "card-1",
      newStage: "archived",
      workspaceId: "workspace-a",
    });

    expect(workspaceA.chunks.some((chunk) => chunk.includes("\"type\":\"kanban:archived\""))).toBe(true);
    expect(workspaceA.chunks.some((chunk) => chunk.includes("\"cardId\":\"card-1\""))).toBe(true);
    expect(workspaceA.chunks.some((chunk) => chunk.includes("\"newStage\":\"archived\""))).toBe(true);
    expect(workspaceB.chunks.some((chunk) => chunk.includes("\"kanban:archived\""))).toBe(false);
  });

  it("sends kanban:archived with timestamp but no full card data", () => {
    const broadcaster = new KanbanEventBroadcaster();
    const workspace = createController();

    broadcaster.attach("ws-1", workspace.controller);

    broadcaster.notifyArchived({
      cardId: "card-1",
      newStage: "archived",
      workspaceId: "ws-1",
    });

    const payload = JSON.parse(workspace.chunks[1].replace("data: ", "").trim());
    expect(payload.type).toBe("kanban:archived");
    expect(payload.cardId).toBe("card-1");
    expect(payload.newStage).toBe("archived");
    expect(payload.workspaceId).toBe("ws-1");
    expect(payload.timestamp).toBeDefined();
    // Should NOT contain full card data
    expect(payload.title).toBeUndefined();
    expect(payload.description).toBeUndefined();
    expect(payload.entity).toBeUndefined();
  });
});
