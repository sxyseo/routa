import { NextRequest, NextResponse } from "next/server";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";

/**
 * POST /api/ab/events/workspaces/{workspaceId}/ab/events
 *
 * Record an AB experiment event.
 * AC1: Events carry userId and variantId.
 * AC2: Events are persisted with full metadata.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const body = await request.json();
  const path = resolveApiPath(`/ab/events/workspaces/${workspaceId}/ab/events`);
  const response = await desktopAwareFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return NextResponse.json(data);
}
