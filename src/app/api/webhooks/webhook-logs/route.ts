/**
 * /api/webhooks/webhook-logs — Read-only API for webhook trigger audit logs.
 *
 * GET /api/webhooks/webhook-logs               → List recent logs (optionally ?configId=...&limit=N&platform=gitlab|github)
 *
 * Supports both GitHub and GitLab webhook logs.
 * Use ?platform=gitlab to fetch GitLab-specific logs, or omit to fetch GitHub logs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGitHubWebhookStore } from "@/core/webhooks/webhook-store-factory";
import { getGitLabWebhookStore } from "@/core/webhooks/gitlab-webhook-store-factory";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const configId = searchParams.get("configId") ?? undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
    const platform = searchParams.get("platform");

    if (platform === "gitlab") {
      const store = getGitLabWebhookStore();
      const logs = await store.listLogs(configId, limit);
      return NextResponse.json({ logs });
    }

    // Default: GitHub logs (backward compatible)
    const store = getGitHubWebhookStore();
    const logs = await store.listLogs(configId, limit);
    return NextResponse.json({ logs });
  } catch (err) {
    console.error("[WebhookLogs] GET error:", err);
    return NextResponse.json({ error: "Failed to load webhook logs", details: String(err) }, { status: 500 });
  }
}
