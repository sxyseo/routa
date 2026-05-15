import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { monitorApiRoute } from "@/core/http/api-route-observability";
import { repairWorkspaceTasks, repairAllWorkspaces } from "@/core/kanban/task-repair";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return monitorApiRoute(request, "POST /api/kanban/repair", async () => {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const system = getRoutaSystem();

    const result = workspaceId
      ? await repairWorkspaceTasks(system, workspaceId)
      : await repairAllWorkspaces(system);

    return NextResponse.json(result);
  });
}
