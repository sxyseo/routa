import { NextRequest, NextResponse } from "next/server";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";

export interface CheckInStatsResponse {
  workspaceId: string;
  userId: string;
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  monthlyRate: number;
  monthlyDays: number;
  totalPoints: number;
  adClaimCount: number;
  lastSigninDate?: string;
  lastSigninAt?: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspaceId = searchParams.get("workspaceId");
  const userId = searchParams.get("userId");

  if (!workspaceId) {
    return NextResponse.json(
      { error: "Missing required parameter: workspaceId" },
      { status: 400 },
    );
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Missing required parameter: userId" },
      { status: 400 },
    );
  }

  const basePath = resolveApiPath("/game/daily-signin");
  const path = `${basePath}/stats?workspace_id=${workspaceId}&user_id=${userId}`;
  const response = await desktopAwareFetch(path, {
    headers: { "Content-Type": "application/json" },
  });

  const data = await response.json();
  return NextResponse.json(data as CheckInStatsResponse);
}
