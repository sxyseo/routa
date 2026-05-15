import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { startWorkflowOrchestrator } from "@/core/kanban/workflow-orchestrator-singleton";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { archiveDoneTasks } from "@/core/kanban/archive-task";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;
  const system = getRoutaSystem();

  startWorkflowOrchestrator(system);

  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  let body: { taskIds?: string[] } = {};
  try {
    body = await request.json() as { taskIds?: string[] };
  } catch {
    // empty body is fine — will archive all done tasks
  }

  const result = await archiveDoneTasks(system, board, body.taskIds);

  getKanbanEventBroadcaster().notify({
    workspaceId: board.workspaceId,
    entity: "task",
    action: "updated",
    resourceId: boardId,
    source: "user",
  });

  return NextResponse.json(result);
}
