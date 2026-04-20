import { NextRequest } from "next/server";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { monitorSSEConnection } from "@/core/http/api-route-observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "*";
  const broadcaster = getKanbanEventBroadcaster();
  let connectionId: string | null = null;

  const stream = new ReadableStream({
    start(controller) {
      connectionId = broadcaster.attach(workspaceId, controller);
    },
    cancel() {
      if (connectionId) {
        broadcaster.detach(connectionId);
      }
    },
  });

  const monitoredStream = monitorSSEConnection(request, "/api/kanban/events", stream);
  return new Response(monitoredStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
