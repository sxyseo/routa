/**
 * Notification Logs API
 *
 * GET /api/notifications/logs?workspaceId=xxx&limit=50  → returns logs (desc)
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "default";
  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10), 1),
    500,
  );

  try {
    const system = getRoutaSystem();
    const logs = await system.notificationStore.listLogs(workspaceId, limit);
    return NextResponse.json({ logs, total: logs.length });
  } catch (err) {
    console.error("[Notifications/Logs/GET] Error:", err);
    return NextResponse.json(
      { error: "Failed to get notification logs" },
      { status: 500 },
    );
  }
}
