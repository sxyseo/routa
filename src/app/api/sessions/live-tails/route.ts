/**
 * Batch Live Tail API — POST /api/sessions/live-tails
 *
 * Accepts an array of session IDs and returns the last meaningful text
 * (the "live tail") for each session.  Used by the kanban board to poll
 * running task sessions in a single HTTP round-trip instead of N individual
 * `/api/sessions/{id}/history` calls.
 *
 * The response is intentionally minimal — only session ID + tail text —
 * because the kanban cards only display a one-line preview of the latest
 * agent activity.  All data is served from the in-memory HttpSessionStore
 * with no DB or filesystem reads.
 */

import { NextRequest, NextResponse } from "next/server";
import { getHttpSessionStore, consolidateMessageHistory } from "@/core/acp/http-session-store";

export const dynamic = "force-dynamic";

interface LiveTailResult {
  sessionId: string;
  tail: string | null;
}

/**
 * Extract the last meaningful text from consolidated history.
 * Mirrors the logic of `extractSessionLiveTail` from kanban-tab-helpers
 * but operates server-side on the raw notification objects.
 */
function extractTail(history: unknown[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (!entry || typeof entry !== "object") continue;
    const update = (entry as { update?: unknown }).update;
    if (!update || typeof update !== "object") continue;
    const rec = update as Record<string, unknown>;
    const type = rec.sessionUpdate;
    if (type !== "agent_message" && type !== "agent_message_chunk" && type !== "user_message") continue;

    const text = extractText(rec.content);
    if (text) return text.replace(/\s+/g, " ").trim();
  }
  return null;
}

function extractText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!content || typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
  if (Array.isArray(record.content)) {
    const parts = (record.content as Array<unknown>)
      .map((item) => (typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text
        : ""))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("").trim() || null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  let body: { sessionIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionIds } = body;
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return NextResponse.json({ error: "sessionIds must be a non-empty array" }, { status: 400 });
  }

  if (sessionIds.length > 200) {
    return NextResponse.json({ error: "Too many session IDs (max 200)" }, { status: 400 });
  }

  const store = getHttpSessionStore();
  const results: LiveTailResult[] = [];

  // De-duplicate and validate
  const seen = new Set<string>();
  const validIds: string[] = [];
  for (const id of sessionIds) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    validIds.push(id);
  }

  // Check for runner-owned sessions — they need to be proxied individually
  // because their history lives on the runner, not in the local in-memory store.
  const runnerIds: string[] = [];
  const localIds: string[] = [];
  await store.hydrateFromDb();
  for (const sessionId of validIds) {
    const session = store.getSession(sessionId);
    if (session?.executionMode === "runner") {
      runnerIds.push(sessionId);
    } else {
      localIds.push(sessionId);
    }
  }

  // Process local sessions from in-memory store (fast path)
  for (const sessionId of localIds) {
    const raw = store.getHistory(sessionId);
    const consolidated = consolidateMessageHistory(raw);
    results.push({ sessionId, tail: extractTail(consolidated) });
  }

  // Runner sessions: try fetching from in-memory store (runner may have
  // forwarded data via SSE); otherwise leave tail as null.
  for (const sessionId of runnerIds) {
    const raw = store.getHistory(sessionId);
    if (raw.length > 0) {
      const consolidated = consolidateMessageHistory(raw);
      results.push({ sessionId, tail: extractTail(consolidated) });
    } else {
      results.push({ sessionId, tail: null });
    }
  }

  return NextResponse.json(
    { tails: results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
