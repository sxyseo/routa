import { NextRequest, NextResponse } from "next/server";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";

/**
 * GET /api/ab/events/workspaces/{workspaceId}/ab/experiments/{experimentId}/events
 *
 * Get all events for an experiment with optional time period filter.
 * AC2: Events include timestamp, userId, experimentId, variantId, eventName, eventValue.
 * AC4: Supports period filter (today, 7d, 30d, all).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; experimentId: string }> },
) {
  const { workspaceId, experimentId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const period = searchParams.get("period") ?? "all";
  const path = resolveApiPath(
    `/ab/events/workspaces/${workspaceId}/ab/experiments/${experimentId}/events?period=${period}`
  );
  const response = await desktopAwareFetch(path, {
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json();
  return NextResponse.json(data);
}
