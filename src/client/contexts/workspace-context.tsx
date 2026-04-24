"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { WorkspaceData } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

const WORKSPACE_CONTEXT_KEY = "routa.activeWorkspaceId";
const WORKSPACE_CHANGE_EVENT = "routa:workspace-changed";

// ─── External store for active workspace ID ────────────────────────────────

const _listeners = new Set<() => void>();

function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WORKSPACE_CONTEXT_KEY);
}

function getServerSnapshot(): string | null {
  return null;
}

function subscribeToWorkspace(onStoreChange: () => void): () => void {
  _listeners.add(onStoreChange);
  if (typeof window !== "undefined") {
    window.addEventListener(WORKSPACE_CHANGE_EVENT, onStoreChange);
    window.addEventListener("storage", onStoreChange);
  }
  return () => {
    _listeners.delete(onStoreChange);
    if (typeof window !== "undefined") {
      window.removeEventListener(WORKSPACE_CHANGE_EVENT, onStoreChange);
      window.removeEventListener("storage", onStoreChange);
    }
  };
}

function notifyListeners() {
  _listeners.forEach((l) => l());
}

export function setActiveWorkspaceIdGlobal(id: string | null) {
  if (typeof window !== "undefined") {
    if (id) {
      localStorage.setItem(WORKSPACE_CONTEXT_KEY, id);
    } else {
      localStorage.removeItem(WORKSPACE_CONTEXT_KEY);
    }
    window.dispatchEvent(new StorageEvent("storage", { key: WORKSPACE_CONTEXT_KEY, newValue: id }));
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGE_EVENT, { detail: { workspaceId: id } }));
  }
  notifyListeners();
}

// ─── Context ────────────────────────────────────────────────────────────────

interface WorkspaceContextValue {
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceData | null;
  setActiveWorkspaceId: (id: string | null) => void;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // Sync active ID from external store (localStorage + cross-tab sync)
  const activeWorkspaceId = useSyncExternalStore(subscribeToWorkspace, getActiveWorkspaceId, getServerSnapshot);

  const [workspaces, setWorkspaces] = React.useState<WorkspaceData[]>([]);
  // loading=true initially; deferred to avoid setState-in-effect
  const loadingRef = useRef(true);
  const [, forceRender] = React.useState(0);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await desktopAwareFetch("/api/workspaces?status=active");
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data.workspaces ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  // Initial fetch - use queueMicrotask to defer setLoading so it doesn't
  // synchronously cascade in the same effect tick
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      await fetchWorkspaces();
      if (!cancelled) {
        loadingRef.current = false;
        forceRender((n) => n + 1);
      }
    });
    return () => { cancelled = true; };
  }, [fetchWorkspaces]);

  // Auto-select first workspace when list is loaded and nothing is selected
  useEffect(() => {
    if (!loadingRef.current && !activeWorkspaceId && workspaces.length > 0) {
      queueMicrotask(() => {
        setActiveWorkspaceIdGlobal(workspaces[0].id);
      });
    }
  }, [activeWorkspaceId, workspaces]);

  const setActiveWorkspaceId = useCallback((id: string | null) => {
    setActiveWorkspaceIdGlobal(id);
  }, []);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  return (
    <WorkspaceContext.Provider value={{
      activeWorkspaceId,
      activeWorkspace,
      setActiveWorkspaceId,
      refreshWorkspaces: fetchWorkspaces,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspaceContext must be used within WorkspaceProvider");
  }
  return ctx;
}