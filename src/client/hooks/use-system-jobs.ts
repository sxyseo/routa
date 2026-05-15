"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

export interface SystemJobRun {
  id: string;
  jobId: string;
  status: "running" | "success" | "error";
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface SystemJob {
  id: string;
  name: string;
  description: string;
  group: string;
  interval: string;
  lastStatus: "running" | "success" | "error" | "idle";
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  recentRuns: SystemJobRun[];
}

interface SystemJobsResponse {
  jobs: SystemJob[];
}

const POLL_INTERVAL_MS = 30_000;

export function useSystemJobs() {
  const [jobs, setJobs] = useState<SystemJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await desktopAwareFetch("/api/system-jobs");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: SystemJobsResponse = await res.json();
      setJobs(data.jobs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load system jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();

    intervalRef.current = setInterval(() => {
      void fetchJobs();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchJobs]);

  return { jobs, loading, error, refetch: fetchJobs };
}
