"use client";

import { useState, useEffect, useCallback } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";

export interface WorkspaceData {
  id: string;
  title: string;
  status: "active" | "archived";
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CodebaseData {
  id: string;
  workspaceId: string;
  repoPath: string;
  branch?: string;
  label?: string;
  isDefault: boolean;
  sourceType?: "local" | "github" | "gitlab";
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UseWorkspacesReturn {
  workspaces: WorkspaceData[];
  loading: boolean;
  fetchWorkspaces: () => Promise<void>;
  createWorkspace: (title: string) => Promise<WorkspaceData | null>;
  archiveWorkspace: (id: string) => Promise<void>;
  updateWorkspace: (id: string, patch: { title: string }) => Promise<WorkspaceData | null>;
  deleteWorkspace: (id: string) => Promise<boolean>;
}

export function useWorkspaces(): UseWorkspacesReturn {
  const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([]);
  // Start with loading=true since we fetch on mount
  const [loading, setLoading] = useState(true);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await desktopAwareFetch("/api/workspaces?status=active");
      if (!res.ok) return;
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const createWorkspace = useCallback(async (title: string): Promise<WorkspaceData | null> => {
    const res = await desktopAwareFetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    await fetchWorkspaces();
    return data.workspace ?? null;
  }, [fetchWorkspaces]);

  const archiveWorkspace = useCallback(async (id: string): Promise<void> => {
    await desktopAwareFetch(`/api/workspaces/${id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    await fetchWorkspaces();
  }, [fetchWorkspaces]);

  const updateWorkspace = useCallback(async (id: string, patch: { title: string }): Promise<WorkspaceData | null> => {
    const res = await desktopAwareFetch(`/api/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Optimistically update local state
    const updated = data.workspace as WorkspaceData | undefined;
    if (updated) {
      setWorkspaces((prev) => prev.map((w) => (w.id === id ? updated : w)));
    }
    return updated ?? null;
  }, []);

  const deleteWorkspace = useCallback(async (id: string): Promise<boolean> => {
    const res = await desktopAwareFetch(`/api/workspaces/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) return false;
    setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    return true;
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  return { workspaces, loading, fetchWorkspaces, createWorkspace, archiveWorkspace, updateWorkspace, deleteWorkspace };
}

export function useCodebases(workspaceId: string): {
  codebases: CodebaseData[];
  fetchCodebases: () => Promise<void>;
} {
  const [codebases, setCodebases] = useState<CodebaseData[]>([]);

  const fetchCodebases = useCallback(async () => {
    // Skip if workspaceId is missing or is a placeholder (static export mode)
    if (!workspaceId || workspaceId === "__placeholder__") return;
    try {
      const res = await desktopAwareFetch(`/api/workspaces/${workspaceId}/codebases`);
      if (!res.ok) return;
      const data = await res.json();
      setCodebases(data.codebases ?? []);
    } catch {
      // Network failure (e.g. SSE reconnect during navigation) — ignore silently
    }
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void fetchCodebases();
      }
    });
    return () => {
      active = false;
    };
  }, [fetchCodebases]);

  return { codebases, fetchCodebases };
}
