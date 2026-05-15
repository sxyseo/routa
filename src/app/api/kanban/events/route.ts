import { NextRequest } from "next/server";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { monitorSSEConnection } from "@/core/http/api-route-observability";

export const dynamic = "force-dynamic";

const SSE_MAX_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes
const encoder = new TextEncoder();

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "*";
  const broadcaster = getKanbanEventBroadcaster();
  let connectionId: string | null = null;
  let maxTimeoutId: ReturnType<typeof setTimeout> | null = null;

  function cleanup() {
    if (maxTimeoutId) {
      clearTimeout(maxTimeoutId);
      maxTimeoutId = null;
    }
    if (connectionId) {
      broadcaster.detach(connectionId);
      connectionId = null;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      connectionId = broadcaster.attach(workspaceId, controller);

      maxTimeoutId = setTimeout(() => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "reconnect", reason: "max_timeout", timestamp: new Date().toISOString() })}\n\n`,
            ),
          );
        } catch { /* stream already closed */ }
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      }, SSE_MAX_TIMEOUT_MS);

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
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
