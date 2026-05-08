import { NextRequest, NextResponse } from "next/server";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckInAnalyticsResponse {
  workspaceId: string;
  totalUsers: number;
  activeUsers: number;
  dailyCheckInRate: number;
  trend: {
    date: string;
    checkInCount: number;
    activeUsers: number;
  }[];
  milestoneDistribution: {
    streak: string;
    count: number;
  }[];
}

/**
 * GET /api/feature-explorer/checkin-stats
 *
 * Returns workspace-level check-in analytics for Feature Explorer integration.
 * This endpoint aggregates check-in data across all users in a workspace.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json(
      { error: "Missing required parameter: workspaceId" },
      { status: 400 }
    );
  }

  try {
    // Call the backend API to get aggregated check-in stats
    const basePath = resolveApiPath("/game/daily-signin");
    const response = await desktopAwareFetch(
      `${basePath}/analytics?workspace_id=${workspaceId}`,
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok) {
      // If analytics endpoint not available, return mock data for now
      // This allows the UI to render while the backend is being developed
      const mockData: CheckInAnalyticsResponse = {
        workspaceId,
        totalUsers: 0,
        activeUsers: 0,
        dailyCheckInRate: 0,
        trend: [],
        milestoneDistribution: [],
      };
      return NextResponse.json(mockData);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch check-in analytics:", error);
    // Return empty data on error to allow graceful degradation
    const mockData: CheckInAnalyticsResponse = {
      workspaceId,
      totalUsers: 0,
      activeUsers: 0,
      dailyCheckInRate: 0,
      trend: [],
      milestoneDistribution: [],
    };
    return NextResponse.json(mockData);
  }
}
