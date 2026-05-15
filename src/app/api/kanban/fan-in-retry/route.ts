import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { executeFanInMerge, needsFanInMerge } from "@/core/kanban/fan-in-merge";
import { TaskStatus } from "@/core/models/task";

export const dynamic = "force-dynamic";

interface FanInRetryBody {
  parentTaskId: string;
}

export async function POST(request: NextRequest) {
  let body: FanInRetryBody;
  try {
    body = await request.json() as FanInRetryBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.parentTaskId) {
    return NextResponse.json(
      { error: "parentTaskId is required" },
      { status: 400 },
    );
  }

  const system = getRoutaSystem();

  const parentTask = await system.taskStore.get(body.parentTaskId);
  if (!parentTask) {
    return NextResponse.json(
      { error: `Task not found: ${body.parentTaskId}` },
      { status: 404 },
    );
  }

  if (!parentTask.splitPlan) {
    return NextResponse.json(
      { error: "Task has no splitPlan — not a split parent" },
      { status: 400 },
    );
  }

  if (!parentTask.lastSyncError?.startsWith("[Fan-In]")) {
    return NextResponse.json(
      { error: "Task does not have a fan-in conflict to retry" },
      { status: 400 },
    );
  }

  const { mergeStrategy, childTaskIds } = parentTask.splitPlan;

  if (!needsFanInMerge(mergeStrategy, childTaskIds.length)) {
    return NextResponse.json(
      { error: `Merge strategy "${mergeStrategy}" does not require fan-in` },
      { status: 400 },
    );
  }

  const result = await executeFanInMerge(parentTask, {
    taskStore: system.taskStore,
    worktreeStore: system.worktreeStore,
  });

  if (result.success) {
    parentTask.lastSyncError = undefined;
    parentTask.splitPlan.warnings = parentTask.splitPlan.warnings.filter(
      (w) => !w.startsWith("CONFLICT:"),
    );
    parentTask.updatedAt = new Date();
    await system.taskStore.save(parentTask);

    return NextResponse.json({
      success: true,
      mergedBranches: result.mergedBranches,
      message: "Fan-in merge completed. Parent task is ready to advance to review.",
    });
  }

  parentTask.lastSyncError =
    `[Fan-In] ${result.conflicts.length} conflict(s): ${result.conflicts.join(", ")}. Resolve and retry.`;
  parentTask.splitPlan.warnings = [
    ...parentTask.splitPlan.warnings.filter((w) => !w.startsWith("CONFLICT:")),
    ...result.conflicts.map((f) => `CONFLICT: ${f}`),
  ];
  parentTask.updatedAt = new Date();
  await system.taskStore.save(parentTask);

  return NextResponse.json({
    success: false,
    conflicts: result.conflicts,
    message: "Fan-in merge still has conflicts. Resolve them and retry.",
  }, { status: 409 });
}
