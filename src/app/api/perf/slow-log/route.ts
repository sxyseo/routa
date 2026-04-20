import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getProjectStorageDir } from "@/core/storage/folder-slug";

export const dynamic = "force-dynamic";

const LOG_FILE_NAME = "slow-api-requests.jsonl";

export async function GET(request: NextRequest) {
  if (process.env.ROUTA_PERF_DASHBOARD !== "1") {
    return NextResponse.json({ error: "Performance dashboard disabled." }, { status: 403 });
  }

  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? "50"), 200);
  const runtimeDir = path.join(getProjectStorageDir(process.cwd()), "runtime");
  const filePath = path.join(runtimeDir, LOG_FILE_NAME);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const records = lines.slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    return NextResponse.json({ records, total: lines.length });
  } catch {
    return NextResponse.json({ records: [], total: 0 });
  }
}
