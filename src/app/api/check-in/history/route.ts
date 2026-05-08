import { NextRequest, NextResponse } from "next/server";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";

export interface CheckInRecord {
  id: string;
  signinDate: string;
  signinAt: number;
  status: string;
  isConsecutive: boolean;
  consecutiveDays: number;
  isMakeup: boolean;
  rewardAmount: number;
  rewardType?: string;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CheckInHistoryResponse {
  records: CheckInRecord[];
  pagination: PaginationInfo;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get("userId");
  const month = searchParams.get("month");
  const page = searchParams.get("page") ?? "1";
  const pageSize = searchParams.get("pageSize") ?? "30";

  if (!userId) {
    return NextResponse.json(
      { error: "Missing required parameter: userId" },
      { status: 400 }
    );
  }

  const queryParams = new URLSearchParams({
    user_id: userId,
    page: page,
    page_size: pageSize,
  });

  if (month) {
    queryParams.set("month", month);
  }

  const basePath = resolveApiPath("/game/daily-signin");
  const path = `${basePath}/history?workspace_id=${workspaceId}&${queryParams.toString()}`;
  const response = await desktopAwareFetch(path, {
    headers: { "Content-Type": "application/json" },
  });

  const data = await response.json();
  return NextResponse.json(data);
}
