import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRoutaSystem } from "@/core/routa-system";
import { createKanbanBoard } from "@/core/models/kanban";
import { ensureDefaultBoard } from "@/core/kanban/boards";
import { getKanbanAutoProvider } from "@/core/kanban/board-auto-provider";
import { getKanbanSessionConcurrencyLimit } from "@/core/kanban/board-session-limits";
import { getKanbanDevSessionSupervision } from "@/core/kanban/board-session-supervision";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { getKanbanSessionQueue } from "@/core/kanban/workflow-orchestrator-singleton";
import type { KanbanBoard, KanbanDevSessionSupervision } from "@/core/models/kanban";

export const dynamic = "force-dynamic";

// ─── Request-level cache for GET /api/kanban/boards ───
// Deduplicates concurrent requests and caches for 3 seconds to reduce
// pressure on the 360 MB SQLite database from UI polling loops.
const BOARDS_CACHE_TTL_MS = 3_000;
const boardsCache = new Map<string, { ts: number; promise: Promise<NextResponse> }>();

function getCachedBoards(
  workspaceId: string,
  load: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const cached = boardsCache.get(workspaceId);
  if (cached && Date.now() - cached.ts < BOARDS_CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = load();
  boardsCache.set(workspaceId, { ts: Date.now(), promise });
  if (boardsCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of boardsCache) {
      if (now - v.ts >= BOARDS_CACHE_TTL_MS) boardsCache.delete(k);
    }
  }
  return promise;
}

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeBoard(
  board: KanbanBoard,
  extras?: {
    autoProviderId?: string | null;
    sessionConcurrencyLimit?: number;
    devSessionSupervision?: KanbanDevSessionSupervision;
    queue?: unknown;
  },
) {
  return {
    ...board,
    githubToken: undefined,
    githubTokenConfigured: Boolean(board.githubToken?.trim()),
    autoProviderId: extras?.autoProviderId,
    sessionConcurrencyLimit: extras?.sessionConcurrencyLimit,
    devSessionSupervision: extras?.devSessionSupervision,
    queue: extras?.queue,
  };
}

export async function GET(request: NextRequest) {
  const workspaceId = requireWorkspaceId(request.nextUrl.searchParams.get("workspaceId"));
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  return getCachedBoards(workspaceId, () => loadBoards(workspaceId));
}

async function loadBoards(workspaceId: string): Promise<NextResponse> {
  const system = getRoutaSystem();
  await ensureDefaultBoard(system, workspaceId);
  const boards = await system.kanbanBoardStore.listByWorkspace(workspaceId);
  const workspace = await system.workspaceStore.get(workspaceId);
  const tasks = await system.taskStore.listByWorkspace(workspaceId);
  const queue = getKanbanSessionQueue(system);

  return NextResponse.json({
    boards: await Promise.all(boards.map(async (board) => sanitizeBoard(board, {
      autoProviderId: getKanbanAutoProvider(workspace?.metadata, board.id),
      sessionConcurrencyLimit: getKanbanSessionConcurrencyLimit(workspace?.metadata, board.id),
      devSessionSupervision: getKanbanDevSessionSupervision(workspace?.metadata, board.id),
      queue: await queue.getBoardSnapshot(board.id, tasks),
    }))),
  });
}

export async function POST(request: NextRequest) {
  let body: { workspaceId?: string; name?: string; columns?: ReturnType<typeof createKanbanBoard>["columns"]; isDefault?: boolean };
  try {
    body = await request.json() as { workspaceId?: string; name?: string; columns?: ReturnType<typeof createKanbanBoard>["columns"]; isDefault?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const board = createKanbanBoard({
    id: uuidv4(),
    workspaceId,
    name: body.name.trim(),
    isDefault: body.isDefault ?? false,
    columns: body.columns,
  });
  await system.kanbanBoardStore.save(board);
  if (board.isDefault) {
    await system.kanbanBoardStore.setDefault(workspaceId, board.id);
  }
  boardsCache.delete(workspaceId);
  getKanbanEventBroadcaster().notify({
    workspaceId,
    entity: "board",
    action: "created",
    resourceId: board.id,
    source: "user",
  });
  return NextResponse.json({ board: sanitizeBoard(board) }, { status: 201 });
}
