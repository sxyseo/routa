import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRoutaSystem } from "@/core/routa-system";
import { createKanbanBoard } from "@/core/models/kanban";
import { ensureDefaultBoard } from "@/core/kanban/boards";
import { getKanbanAutoProvider } from "@/core/kanban/board-auto-provider";
import { getKanbanSessionConcurrencyLimit } from "@/core/kanban/board-session-limits";
import { getKanbanDevSessionSupervision } from "@/core/kanban/board-session-supervision";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { reviveMissingEntryAutomations } from "@/core/kanban/restart-recovery";
import { getKanbanSessionQueue } from "@/core/kanban/workflow-orchestrator-singleton";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getAcpProcessManager } from "@/core/acp/processer";
import type { KanbanBoard, KanbanDevSessionSupervision } from "@/core/models/kanban";

export const dynamic = "force-dynamic";

const REVIVE_COOLDOWN_MS = 30_000;
const lastReviveByWorkspace = new Map<string, number>();

function cleanupReviveTimestamps(): void {
  if (lastReviveByWorkspace.size <= 50) return;
  const cutoff = Date.now() - REVIVE_COOLDOWN_MS * 2;
  for (const [key, ts] of lastReviveByWorkspace) {
    if (ts < cutoff) lastReviveByWorkspace.delete(key);
  }
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

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function GET(request: NextRequest) {
  const workspaceId = requireWorkspaceId(request.nextUrl.searchParams.get("workspaceId"));
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const system = getRoutaSystem();
  await ensureDefaultBoard(system, workspaceId);
  const boards = await system.kanbanBoardStore.listByWorkspace(workspaceId);
  const workspace = await system.workspaceStore.get(workspaceId);
  const queue = getKanbanSessionQueue(system);
  const sessionStore = getHttpSessionStore();
  const processManager = getAcpProcessManager();

  // Fire-and-forget: start hydration but don't block the boards response.
  // The revive logic on the next request (or SSE tick) will pick up any
  // recovered automations once hydration completes.
  const hydrationDone = sessionStore.hydrateFromDb();

  // Only run revive if hydration is already done (subsequent requests).
  // Skip on first request to avoid blocking 30+ seconds.
  // Cooldown prevents revive-induced SSE events from causing feedback loops.
  const lastRevive = lastReviveByWorkspace.get(workspaceId) ?? 0;
  const reviveAllowed = sessionStore.isHydrated() && Date.now() - lastRevive >= REVIVE_COOLDOWN_MS;
  cleanupReviveTimestamps();
  if (reviveAllowed) {
    lastReviveByWorkspace.set(workspaceId, Date.now());
    await Promise.all(boards.map((board) => reviveMissingEntryAutomations(system, workspaceId, board.id, {
      sessionStore,
      processManager,
    })));
  } else if (!sessionStore.isHydrated()) {
    void hydrationDone.then(() => {
      lastReviveByWorkspace.set(workspaceId, Date.now());
      for (const board of boards) {
        void reviveMissingEntryAutomations(system, workspaceId, board.id, {
          sessionStore,
          processManager,
        });
      }
    });
  }
  return NextResponse.json({
    boards: await Promise.all(boards.map(async (board) => sanitizeBoard(board, {
      autoProviderId: getKanbanAutoProvider(workspace?.metadata, board.id),
      sessionConcurrencyLimit: getKanbanSessionConcurrencyLimit(workspace?.metadata, board.id),
      devSessionSupervision: getKanbanDevSessionSupervision(workspace?.metadata, board.id),
      queue: await queue.getBoardSnapshot(board.id),
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
  getKanbanEventBroadcaster().notify({
    workspaceId,
    entity: "board",
    action: "created",
    resourceId: board.id,
    source: "user",
  });
  return NextResponse.json({ board: sanitizeBoard(board) }, { status: 201 });
}
