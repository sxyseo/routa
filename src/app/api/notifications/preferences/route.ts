/**
 * Notification Preferences API
 *
 * GET  /api/notifications/preferences?workspaceId=xxx  → returns preferences
 * PUT  /api/notifications/preferences                  → upsert preferences
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

// GET /api/notifications/preferences?workspaceId=xxx
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "default";

  try {
    const system = getRoutaSystem();
    const prefs = await system.notificationStore.getPreferences(workspaceId);

    if (!prefs) {
      // Return defaults
      return NextResponse.json({
        workspaceId,
        enabled: false,
        senderEmail: "",
        recipients: [],
        enabledEvents: [],
        throttleSeconds: 300,
      });
    }

    return NextResponse.json(prefs);
  } catch (err) {
    console.error("[Notifications/Prefs/GET] Error:", err);
    return NextResponse.json(
      { error: "Failed to get notification preferences" },
      { status: 500 },
    );
  }
}

// PUT /api/notifications/preferences
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const workspaceId = body.workspaceId ?? "default";

    if (!Array.isArray(body.recipients)) {
      return NextResponse.json({ error: "recipients must be an array" }, { status: 400 });
    }
    if (!Array.isArray(body.enabledEvents)) {
      return NextResponse.json({ error: "enabledEvents must be an array" }, { status: 400 });
    }

    const system = getRoutaSystem();
    const now = new Date();

    await system.notificationStore.upsertPreferences({
      workspaceId,
      enabled: Boolean(body.enabled),
      senderEmail: String(body.senderEmail ?? ""),
      recipients: body.recipients.map(String),
      enabledEvents: body.enabledEvents,
      throttleSeconds: typeof body.throttleSeconds === "number" ? body.throttleSeconds : 300,
      createdAt: now,
      updatedAt: now,
    });

    const updated = await system.notificationStore.getPreferences(workspaceId);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[Notifications/Prefs/PUT] Error:", err);
    return NextResponse.json(
      { error: "Failed to update notification preferences" },
      { status: 500 },
    );
  }
}
