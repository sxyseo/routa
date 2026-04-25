/**
 * Notification Test API
 *
 * POST /api/notifications/test?workspaceId=xxx  → sends a test email
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "default";

  try {
    const system = getRoutaSystem();
    const prefs = await system.notificationStore.getPreferences(workspaceId);

    if (!prefs || !prefs.enabled || !prefs.recipients.length) {
      return NextResponse.json(
        { error: "Notifications not configured or no recipients set" },
        { status: 400 },
      );
    }

    const result = await system.notificationListener.sendTestEmail(prefs);

    if (result.success) {
      return NextResponse.json({ success: true, message: "Test email sent" });
    } else {
      return NextResponse.json(
        { success: false, error: result.error ?? "Unknown error" },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("[Notifications/Test/POST] Error:", err);
    return NextResponse.json(
      { error: "Failed to send test notification" },
      { status: 500 },
    );
  }
}
