import { NextRequest, NextResponse } from "next/server";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";

export interface CheckInStatusResponse {
  workspaceId: string;
  userId: string;
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  monthlyDays: number;
  adClaimCount: number;
  lastSigninDate?: string;
  lastSigninAt?: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json(
      { error: "Missing required parameter: userId" },
      { status: 400 }
    );
  }

  const path = resolveApiPath("/game/daily-signin/status");
  const response = await desktopAwareFetch(
    `${path}?workspace_id=${workspaceId}&user_id=${userId}`,
    {
      headers: { "Content-Type": "application/json" },
    }
  );

  const data = await response.json();
  return NextResponse.json(data);
}