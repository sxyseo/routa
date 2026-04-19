"use client";

import { useCallback, useEffect, useRef } from "react";
import { getDesktopApiBaseUrl } from "../utils/diagnostics";
import { resolveApiPath } from "../config/backend";

const FITNESS_INVALIDATE_THROTTLE_MS = 750;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_JITTER_MS = 500;

interface UseKanbanEventsOptions {
  workspaceId: string;
  onInvalidate: () => void;
}

export function useKanbanEvents({ workspaceId, onInvalidate }: UseKanbanEventsOptions): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const fitnessInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFitnessInvalidateAtRef = useRef(0);
  const tearingDownRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const onInvalidateRef = useRef(onInvalidate);
  const connectSseRef = useRef<() => void>(() => {});

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const base = getDesktopApiBaseUrl();
    const es = new EventSource(
      resolveApiPath(`api/kanban/events?workspaceId=${encodeURIComponent(workspaceId)}`, base),
    );
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (data.type === "connected") {
          // Reset reconnect backoff on successful connection
          reconnectAttemptRef.current = 0;
          if (hasConnectedOnceRef.current) {
            // Reconnected after a disconnect — do a full sync
            onInvalidateRef.current();
          } else {
            hasConnectedOnceRef.current = true;
          }
          return;
        }
        if (data.type === "kanban:changed") {
          onInvalidateRef.current();
          return;
        }
        if (data.type === "fitness:changed") {
          const now = Date.now();
          const elapsed = now - lastFitnessInvalidateAtRef.current;
          if (elapsed >= FITNESS_INVALIDATE_THROTTLE_MS) {
            lastFitnessInvalidateAtRef.current = now;
            onInvalidateRef.current();
            return;
          }
          if (fitnessInvalidateTimerRef.current) {
            return;
          }
          fitnessInvalidateTimerRef.current = setTimeout(() => {
            fitnessInvalidateTimerRef.current = null;
            lastFitnessInvalidateAtRef.current = Date.now();
            onInvalidateRef.current();
          }, FITNESS_INVALIDATE_THROTTLE_MS - elapsed);
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    es.onerror = () => {
      if (tearingDownRef.current) {
        es.close();
        eventSourceRef.current = null;
        return;
      }

      es.close();
      eventSourceRef.current = null;

      // Don't schedule reconnect while page is hidden — visibilitychange will handle it
      if (document.visibilityState === "hidden") return;

      // Exponential backoff with jitter: 1s → 2s → 4s → 8s → 16s → 30s max
      const attempt = reconnectAttemptRef.current;
      const baseDelay = Math.min(
        RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
        RECONNECT_MAX_DELAY_MS,
      );
      const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS);
      const delay = baseDelay + jitter;
      reconnectAttemptRef.current = attempt + 1;

      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => connectSseRef.current(), delay);
    };
  }, [clearReconnectTimer, workspaceId]);

  useEffect(() => {
    connectSseRef.current = connectSSE;
  }, [connectSSE]);

  useEffect(() => {
    if (workspaceId === "__placeholder__") return;

    tearingDownRef.current = false;
    hasConnectedOnceRef.current = false;
    reconnectAttemptRef.current = 0;
    lastFitnessInvalidateAtRef.current = 0;
    connectSSE();

    // Reconnect SSE when page becomes visible after sleep/tab-switch
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // If there's no active connection, reconnect
      if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
        reconnectAttemptRef.current = 0;
        connectSSE();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      tearingDownRef.current = true;
      hasConnectedOnceRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (fitnessInvalidateTimerRef.current) {
        clearTimeout(fitnessInvalidateTimerRef.current);
        fitnessInvalidateTimerRef.current = null;
      }
      clearReconnectTimer();
    };
  }, [clearReconnectTimer, connectSSE, workspaceId]);
}
