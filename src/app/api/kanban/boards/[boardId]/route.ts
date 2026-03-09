import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import type { KanbanColumn } from "@/core/models/kanban";

export const dynamic = "force-dynamic";

interface PatchBoardBody {
  name?: string;
  columns?: KanbanColumn[];
  isDefault?: boolean;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;
  const system = getRoutaSystem();
  const board = await system.kanbanBoardStore.get(boardId);

  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  return NextResponse.json({ board });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;

  let body: PatchBoardBody;
  try {
    body = await request.json() as PatchBoardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const existing = await system.kanbanBoardStore.get(boardId);

  if (!existing) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  // Update board fields
  const updated = {
    ...existing,
    name: body.name?.trim() ?? existing.name,
    columns: body.columns ?? existing.columns,
    isDefault: body.isDefault ?? existing.isDefault,
    updatedAt: new Date(),
  };

  await system.kanbanBoardStore.save(updated);

  // If setting as default, update other boards
  if (body.isDefault && !existing.isDefault) {
    await system.kanbanBoardStore.setDefault(existing.workspaceId, boardId);
  }

  return NextResponse.json({ board: updated });
}

