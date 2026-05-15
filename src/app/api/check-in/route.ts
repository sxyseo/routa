import { NextRequest, NextResponse } from "next/server";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";

export interface CheckInRequest {
  workspaceId: string;
  userId: string;
}

export interface CheckInResponse {
  success: boolean;
  signin?: {
    id: string;
    workspaceId: string;
    userId: string;
    signinDate: string;
    signinAt: number;
    status: string;
    isConsecutive: boolean;
    consecutiveDays: number;
    rewardItemId?: string;
    rewardAmount: number;
  };
  stats?: {
    workspaceId: string;
    userId: string;
    totalDays: number;
    currentStreak: number;
    longestStreak: number;
    monthlyDays: number;
    adClaimCount: number;
    lastSigninDate?: string;
    lastSigninAt?: number;
  };
  reward?: {
    name: string;
    rewardType: string;
    amount: number;
    iconUrl?: string;
  };
  milestoneReward?: {
    id: string;
    workspaceId: string;
    thresholdDays: number;
    name: string;
    rewardType: string;
    itemId: string;
    amount: number;
    iconUrl?: string;
    isClaimed: boolean;
    status: string;
  };
  error?: string;
}

export async function POST(request: NextRequest) {
  const body: CheckInRequest = await request.json();

  if (!body.workspaceId) {
    return NextResponse.json(
      { error: "Missing required parameter: workspaceId" },
      { status: 400 }
    );
  }

  const path = resolveApiPath("/game/daily-signin/signin");
  const response = await desktopAwareFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: body.workspaceId,
      user_id: body.userId,
    }),
  });

  const data: CheckInResponse = await response.json();
  return NextResponse.json(data, { status: response.status });
}
