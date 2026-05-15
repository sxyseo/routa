/**
 * HistoryCompactor — Compresses and archives old session/trace data.
 *
 * Two strategies:
 * 1. Compress sessions >7 days: merge consecutive agent_message_chunk → agent_message
 * 2. Archive traces >30 days: keep only session_start, session_end, tool_call summaries
 */

import { eq, and, lt, asc, inArray } from "drizzle-orm";
import type { Database } from "../db/index";
import { sessionMessages, traces } from "../db/schema";

export interface CompactResult {
  compressedSessions: number;
  mergedChunks: number;
  archivedTraces: number;
  deletedTraces: number;
}

export class HistoryCompactor {
  constructor(private db: Database) {}

  /**
   * Run both compression and archival.
   */
  async compact(): Promise<CompactResult> {
    const [compress, archive] = await Promise.all([
      this.compressOldSessions(),
      this.archiveOldTraces(),
    ]);
    return {
      compressedSessions: compress.sessionsProcessed,
      mergedChunks: compress.chunksMerged,
      archivedTraces: archive.tracesKept,
      deletedTraces: archive.tracesDeleted,
    };
  }

  /**
   * Compress sessions older than 7 days:
   * Merge consecutive agent_message_chunk events into a single agent_message.
   */
  private async compressOldSessions(): Promise<{
    sessionsProcessed: number;
    chunksMerged: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    // Find session_messages with event_type = 'agent_message_chunk' older than cutoff
    // Limit to 5000 per run to avoid locking the DB for too long on first run
    const oldChunks = await this.db
      .select()
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.eventType, "agent_message_chunk"),
          lt(sessionMessages.createdAt, cutoff)
        )
      )
      .orderBy(
        asc(sessionMessages.sessionId),
        asc(sessionMessages.messageIndex)
      )
      .limit(5000);

    if (oldChunks.length === 0) {
      return { sessionsProcessed: 0, chunksMerged: 0 };
    }

    // Group consecutive chunks by sessionId
    const sessionGroups = new Map<
      string,
      (typeof oldChunks)[number][][]
    >();

    for (const chunk of oldChunks) {
      if (!sessionGroups.has(chunk.sessionId)) {
        sessionGroups.set(chunk.sessionId, [[]]);
      }
      const groups = sessionGroups.get(chunk.sessionId)!;
      const lastGroup = groups[groups.length - 1];

      if (
        lastGroup.length === 0 ||
        lastGroup[lastGroup.length - 1].messageIndex ===
          chunk.messageIndex - 1
      ) {
        lastGroup.push(chunk);
      } else {
        groups.push([chunk]);
      }
    }

    let chunksMerged = 0;

    for (const [, groups] of sessionGroups) {
      for (const group of groups) {
        if (group.length < 2) continue;

        // Merge payloads: concatenate text content from chunks
        const mergedContent = group
          .map((c) => {
            const p = c.payload as Record<string, unknown>;
            return (p.text as string) ?? (p.content as string) ?? "";
          })
          .join("");

        const first = group[0];
        const mergedPayload = {
          ...(first.payload as Record<string, unknown>),
          type: "agent_message",
          text: mergedContent,
          merged_from: group.length,
        };

        // Update first chunk to be the merged message
        await this.db
          .update(sessionMessages)
          .set({
            eventType: "agent_message",
            payload: mergedPayload,
          })
          .where(eq(sessionMessages.id, first.id));

        // Delete the rest
        const idsToDelete = group.slice(1).map((c) => c.id);
        if (idsToDelete.length > 0) {
          await this.db
            .delete(sessionMessages)
            .where(inArray(sessionMessages.id, idsToDelete));
        }

        chunksMerged += group.length;
      }
    }

    return {
      sessionsProcessed: sessionGroups.size,
      chunksMerged,
    };
  }

  /**
   * Archive traces older than 30 days:
   * Keep only session_start, session_end, and tool_call events.
   * Delete all other trace types (conversation details, file changes, etc.)
   */
  private async archiveOldTraces(): Promise<{
    tracesKept: number;
    tracesDeleted: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const keepEventTypes = [
      "session_start",
      "session_end",
      "tool_call",
    ];

    // Count traces to keep (summary events)
    const keptRows = await this.db
      .select({ id: traces.id })
      .from(traces)
      .where(
        and(
          lt(traces.timestamp, cutoff),
          inArray(traces.eventType, keepEventTypes)
        )
      );

    // Delete non-summary traces older than 30 days
    const toDelete = await this.db
      .select({ id: traces.id })
      .from(traces)
      .where(
        and(
          lt(traces.timestamp, cutoff),
          // NOT IN keepEventTypes — delete everything else
          // drizzle doesn't have notInArray, so we select and delete
        )
      );

    // Filter out the ones we want to keep
    const keepIds = new Set(keptRows.map((r) => r.id));
    const deleteIds = toDelete
      .filter((r) => !keepIds.has(r.id))
      .map((r) => r.id);

    let deletedCount = 0;
    // Batch delete in chunks of 500
    for (let i = 0; i < deleteIds.length; i += 500) {
      const batch = deleteIds.slice(i, i + 500);
      await this.db
        .delete(traces)
        .where(inArray(traces.id, batch));
      deletedCount += batch.length;
    }

    return {
      tracesKept: keptRows.length,
      tracesDeleted: deletedCount,
    };
  }
}
