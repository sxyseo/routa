import { NextRequest, NextResponse } from "next/server";
import { getMetricsCollector } from "@/core/http/api-route-observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (process.env.ROUTA_PERF_DASHBOARD !== "1") {
    return NextResponse.json({ error: "Performance dashboard disabled. Set ROUTA_PERF_DASHBOARD=1 to enable." }, { status: 403 });
  }

  const collector = getMetricsCollector();
  const type = request.nextUrl.searchParams.get("type") ?? "overview";

  switch (type) {
    case "overview":
      return NextResponse.json({
        totalRequests: collector.totalRequests,
        activeSSEConnections: collector.totalSSEConnections,
        slowestRoutes: collector.getSlowestRoutes(10),
        recentSlowRequests: collector.getRecentSlowRequests(20),
      });
    case "sse":
      return NextResponse.json({
        activeConnections: collector.getActiveSSEConnections(),
        totalActive: collector.totalSSEConnections,
      });
    case "store":
      return NextResponse.json({
        summaries: collector.getStoreTimingSummaries(20),
      });
    case "db":
      return NextResponse.json({
        summaries: collector.getDbTimingSummaries(20),
      });
    default:
      return NextResponse.json({ error: "Invalid type. Use: overview, sse, store, db" }, { status: 400 });
  }
}

export async function DELETE() {
  if (process.env.ROUTA_PERF_DASHBOARD !== "1") {
    return NextResponse.json({ error: "Performance dashboard disabled." }, { status: 403 });
  }
  getMetricsCollector().clear();
  return NextResponse.json({ cleared: true });
}
