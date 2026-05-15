import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { executeSplit } from "@/core/kanban/task-split-orchestrator";
import type { SubTaskDef, DependencyEdge, MergeStrategy } from "@/core/kanban/task-split-topology";

export const dynamic = "force-dynamic";

interface SplitBody {
  parentTaskId: string;
  subTasks: SubTaskDef[];
  dependencyEdges?: DependencyEdge[];
  mergeStrategy?: MergeStrategy;
  boardId?: string;
}

export async function POST(request: NextRequest) {
  let body: SplitBody;
  try {
    body = await request.json() as SplitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.parentTaskId || !Array.isArray(body.subTasks) || body.subTasks.length === 0) {
    return NextResponse.json(
      { error: "parentTaskId and non-empty subTasks array are required" },
      { status: 400 },
    );
  }

  const system = getRoutaSystem();

  // Load parent task
  const parentTask = await system.taskStore.get(body.parentTaskId);
  if (!parentTask) {
    return NextResponse.json(
      { error: `Parent task not found: ${body.parentTaskId}` },
      { status: 404 },
    );
  }

  try {
    const result = await executeSplit(
      parentTask,
      body.subTasks,
      body.dependencyEdges ?? [],
      { taskStore: system.taskStore, kanbanBoardStore: system.kanbanBoardStore },
      {
        mergeStrategy: body.mergeStrategy,
        boardId: body.boardId ?? parentTask.boardId,
      },
    );

    return NextResponse.json({
      parentTaskId: result.parentTaskId,
      childTaskIds: result.childTaskIds,
      mergeStrategy: result.plan.mergeStrategy,
      warnings: result.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
