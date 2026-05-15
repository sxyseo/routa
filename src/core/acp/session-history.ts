import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { saveHistoryToDb } from "@/core/acp/session-db-persister";
import { SessionWriteBuffer } from "@/core/acp/session-write-buffer";

let writeBuffer: SessionWriteBuffer | null = null;

export function getSessionWriteBuffer(): SessionWriteBuffer {
  if (!writeBuffer) {
    writeBuffer = new SessionWriteBuffer({
      persistFn: saveHistoryToDb,
    });
  }
  return writeBuffer;
}

export async function persistSessionHistorySnapshot(
  sessionId: string,
  store: ReturnType<typeof getHttpSessionStore>,
): Promise<void> {
  // Flush the HttpSessionStore's internal write buffer first so that
  // incremental session_messages rows are committed before we do a
  // full snapshot replace below.  This prevents a race where the
  // snapshot overwrites data that the writeBuffer hasn't persisted yet.
  await store.flushWriteBuffer?.(sessionId);
  const buffer = getSessionWriteBuffer();
  buffer.replace(sessionId, store.getConsolidatedHistory(sessionId));
  await buffer.flush(sessionId);
}
