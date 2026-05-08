import { NextRequest, NextResponse } from "next/server";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get("userId");
  const format = searchParams.get("format") ?? "csv";
  const fromDate = searchParams.get("fromDate");
  const toDate = searchParams.get("toDate");

  if (!userId) {
    return NextResponse.json(
      { error: "Missing required parameter: userId" },
      { status: 400 }
    );
  }

  const queryParams = new URLSearchParams({
    user_id: userId,
    format: format,
  });

  if (fromDate) {
    queryParams.set("from_date", fromDate);
  }
  if (toDate) {
    queryParams.set("to_date", toDate);
  }

  const basePath = resolveApiPath("/game/daily-signin");
  const path = `${basePath}/export?workspace_id=${workspaceId}&${queryParams.toString()}`;

  if (format === "json") {
    const response = await desktopAwareFetch(path, {
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    return NextResponse.json(data);
  }

  // For CSV, return as downloadable file
  const response = await desktopAwareFetch(path, {
    headers: { "Content-Type": "application/json" },
  });
  const csvData = await response.text();
  return new NextResponse(csvData, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="checkin_export_${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
