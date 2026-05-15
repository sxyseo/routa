/**
 * GET /api/system-jobs
 *
 * Returns all registered system background jobs with their current
 * status and recent execution history.
 */

import { NextResponse } from "next/server";
import { getSystemJobStatuses } from "@/core/scheduling/system-heartbeat-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = getSystemJobStatuses();
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("[API] Failed to get system job statuses:", error);
    return NextResponse.json(
      { error: "Failed to retrieve system job statuses" },
      { status: 500 },
    );
  }
}
