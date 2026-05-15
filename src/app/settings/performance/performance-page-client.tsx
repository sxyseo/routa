"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { normalizeWorkspaceQueryId } from "@/client/utils/workspace-id";
import { Activity, BarChart3, Database, Server, Trash2, Wifi } from "lucide-react";

interface RouteSummary {
  route: string;
  method: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorCount: number;
  lastSlowAt?: string;
}

interface SSEConnection {
  connId: string;
  route: string;
  workspaceId: string;
  connectedAt: string;
}

interface StoreTimingSummary {
  storeName: string;
  method: string;
  count: number;
  avgMs: number;
  maxMs: number;
}

interface DbTimingSummary {
  driver: string;
  operation: string;
  count: number;
  avgMs: number;
  maxMs: number;
}

interface SlowRequest {
  timestamp: string;
  route: string;
  method: string;
  pathname: string;
  durationMs: number;
  status: number;
}

interface OverviewData {
  totalRequests: number;
  activeSSEConnections: number;
  slowestRoutes: RouteSummary[];
  recentSlowRequests: SlowRequest[];
}

type Tab = "overview" | "sse" | "store" | "db";

export function PerformanceDashboard() {
  const { t: _t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = normalizeWorkspaceQueryId(searchParams.get("workspaceId"));

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [sseConnections, setSseConnections] = useState<SSEConnection[]>([]);
  const [storeTimings, setStoreTimings] = useState<StoreTimingSummary[]>([]);
  const [dbTimings, setDbTimings] = useState<DbTimingSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);

  const fetchData = useCallback(async (tab: Tab) => {
    try {
      const typeParam = tab === "overview" ? "overview" : tab;
      const res = await desktopAwareFetch(`/api/perf?type=${typeParam}`);
      if (res.status === 403) {
        setEnabled(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setError(null);

      switch (tab) {
        case "overview":
          setOverview(data);
          break;
        case "sse":
          setSseConnections(data.activeConnections ?? []);
          break;
        case "store":
          setStoreTimings(data.summaries ?? []);
          break;
        case "db":
          setDbTimings(data.summaries ?? []);
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    }
  }, []);

  useEffect(() => {
    void fetchData(activeTab);
    const interval = setInterval(() => void fetchData(activeTab), 5000);
    return () => clearInterval(interval);
  }, [activeTab, fetchData]);

  const handleClear = async () => {
    await desktopAwareFetch("/api/perf", { method: "DELETE" });
    void fetchData(activeTab);
  };

  const handleClose = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(workspaceId ? `/workspace/${workspaceId}/sessions` : "/");
  };

  if (!enabled) {
    return (
      <DesktopAppShell workspaceId={workspaceId}>
        <div className="flex h-full items-center justify-center">
          <div className="text-center space-y-3">
            <Activity className="h-10 w-10 mx-auto text-desktop-text-secondary" />
            <p className="text-sm text-desktop-text-secondary">
              性能监控未启用。请在 .env 中设置 <code className="bg-desktop-bg-active px-1.5 py-0.5 rounded text-xs">ROUTA_PERF_DASHBOARD=1</code> 后重启服务。
            </p>
            <button onClick={handleClose} className="text-sm text-desktop-accent hover:underline">
              返回
            </button>
          </div>
        </div>
      </DesktopAppShell>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "概览", icon: <BarChart3 className="h-4 w-4" /> },
    { id: "sse", label: "SSE 连接", icon: <Wifi className="h-4 w-4" /> },
    { id: "store", label: "Store 耗时", icon: <Server className="h-4 w-4" /> },
    { id: "db", label: "DB 查询", icon: <Database className="h-4 w-4" /> },
  ];

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceSwitcher={
        <div className="flex items-center gap-1.5 rounded-xl border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-primary">
          <Activity className="h-3 w-3 text-desktop-text-secondary" />
          <span>性能监控</span>
        </div>
      }
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-desktop-border px-4 py-2">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-desktop-bg-active text-desktop-accent"
                    : "text-desktop-text-secondary hover:bg-desktop-bg-active/70"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
            >
              <Trash2 className="h-3 w-3" />
              清除
            </button>
            <button
              onClick={handleClose}
              className="text-xs text-desktop-text-secondary hover:text-desktop-text-primary"
            >
              关闭
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {activeTab === "overview" && overview && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <StatCard label="总请求数" value={overview.totalRequests.toLocaleString()} />
                <StatCard label="慢请求数" value={overview.recentSlowRequests.length.toString()} />
                <StatCard label="SSE 连接" value={overview.activeSSEConnections.toString()} />
                <StatCard
                  label="错误率"
                  value={
                    overview.totalRequests > 0
                      ? `${((overview.slowestRoutes.reduce((a, r) => a + r.errorCount, 0) / overview.totalRequests) * 100).toFixed(1)}%`
                      : "0%"
                  }
                />
              </div>

              {overview.slowestRoutes.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-medium text-desktop-text-secondary">Top 慢接口</h3>
                  <div className="space-y-1">
                    {overview.slowestRoutes.map((r) => (
                      <RouteBar key={`${r.method} ${r.route}`} summary={r} />
                    ))}
                  </div>
                </div>
              )}

              {overview.recentSlowRequests.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-medium text-desktop-text-secondary">最近慢请求</h3>
                  <div className="rounded-lg border border-desktop-border text-xs">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-desktop-border text-desktop-text-secondary">
                          <th className="px-3 py-1.5 text-left">时间</th>
                          <th className="px-3 py-1.5 text-left">路由</th>
                          <th className="px-3 py-1.5 text-right">耗时</th>
                          <th className="px-3 py-1.5 text-right">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.recentSlowRequests.slice(0, 15).map((r, i) => (
                          <tr key={i} className="border-b border-desktop-border/50">
                            <td className="px-3 py-1.5 text-desktop-text-secondary">
                              {r.timestamp.split("T")[1]?.split(".")[0] ?? r.timestamp}
                            </td>
                            <td className="px-3 py-1.5 font-mono">{r.method} {r.pathname}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-amber-400">{r.durationMs.toFixed(0)}ms</td>
                            <td className="px-3 py-1.5 text-right">{r.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!overview.slowestRoutes.length && !overview.recentSlowRequests.length && (
                <div className="py-12 text-center text-sm text-desktop-text-secondary">
                  暂无数据。确保设置 ROUTA_API_TIMING_LOG_ALL=1 以记录所有请求。
                </div>
              )}
            </div>
          )}

          {activeTab === "sse" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-desktop-text-secondary">
                <Wifi className="h-3.5 w-3.5" />
                活跃 SSE 连接: {sseConnections.length}
              </div>
              {sseConnections.length > 0 ? (
                <div className="rounded-lg border border-desktop-border text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-desktop-border text-desktop-text-secondary">
                        <th className="px-3 py-1.5 text-left">路由</th>
                        <th className="px-3 py-1.5 text-left">工作空间</th>
                        <th className="px-3 py-1.5 text-left">连接时间</th>
                        <th className="px-3 py-1.5 text-left">存活</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sseConnections.map((c) => {
                        const aliveMs = Date.now() - new Date(c.connectedAt).getTime();
                        return (
                          <tr key={c.connId} className="border-b border-desktop-border/50">
                            <td className="px-3 py-1.5 font-mono">{c.route}</td>
                            <td className="px-3 py-1.5">{c.workspaceId}</td>
                            <td className="px-3 py-1.5 text-desktop-text-secondary">
                              {c.connectedAt.split("T")[1]?.split(".")[0] ?? c.connectedAt}
                            </td>
                            <td className="px-3 py-1.5">{formatDuration(aliveMs)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-desktop-text-secondary">
                  当前无活跃 SSE 连接
                </div>
              )}
            </div>
          )}

          {activeTab === "store" && (
            <div className="space-y-3">
              {storeTimings.length > 0 ? (
                <div className="rounded-lg border border-desktop-border text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-desktop-border text-desktop-text-secondary">
                        <th className="px-3 py-1.5 text-left">Store</th>
                        <th className="px-3 py-1.5 text-left">方法</th>
                        <th className="px-3 py-1.5 text-right">调用次数</th>
                        <th className="px-3 py-1.5 text-right">平均耗时</th>
                        <th className="px-3 py-1.5 text-right">最大耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storeTimings.map((s, i) => (
                        <tr key={i} className="border-b border-desktop-border/50">
                          <td className="px-3 py-1.5 font-mono">{s.storeName}</td>
                          <td className="px-3 py-1.5 font-mono">{s.method}</td>
                          <td className="px-3 py-1.5 text-right">{s.count}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{s.avgMs.toFixed(1)}ms</td>
                          <td className="px-3 py-1.5 text-right font-mono">{s.maxMs.toFixed(1)}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-desktop-text-secondary">
                  Store 计时未启用。设置 <code className="bg-desktop-bg-active px-1 py-0.5 rounded">ROUTA_STORE_TIMING=1</code>
                </div>
              )}
            </div>
          )}

          {activeTab === "db" && (
            <div className="space-y-3">
              {dbTimings.length > 0 ? (
                <div className="rounded-lg border border-desktop-border text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-desktop-border text-desktop-text-secondary">
                        <th className="px-3 py-1.5 text-left">驱动</th>
                        <th className="px-3 py-1.5 text-left">操作</th>
                        <th className="px-3 py-1.5 text-right">调用次数</th>
                        <th className="px-3 py-1.5 text-right">平均耗时</th>
                        <th className="px-3 py-1.5 text-right">最大耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbTimings.map((d, i) => (
                        <tr key={i} className="border-b border-desktop-border/50">
                          <td className="px-3 py-1.5 font-mono">{d.driver}</td>
                          <td className="px-3 py-1.5 font-mono">{d.operation}</td>
                          <td className="px-3 py-1.5 text-right">{d.count}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{d.avgMs.toFixed(1)}ms</td>
                          <td className="px-3 py-1.5 text-right font-mono">{d.maxMs.toFixed(1)}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-desktop-text-secondary">
                  DB 计时未启用。设置 <code className="bg-desktop-bg-active px-1 py-0.5 rounded">ROUTA_DB_TIMING=1</code>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DesktopAppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-desktop-border bg-desktop-bg-secondary px-3 py-2">
      <div className="text-[10px] text-desktop-text-secondary">{label}</div>
      <div className="text-lg font-semibold text-desktop-text-primary">{value}</div>
    </div>
  );
}

function RouteBar({ summary }: { summary: RouteSummary }) {
  const maxAvg = Math.max(summary.avgMs, 1);
  const barWidth = Math.min((maxAvg / 2000) * 100, 100);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-desktop-border/50 px-3 py-1.5 text-xs">
      <div className="w-48 shrink-0 truncate font-mono text-desktop-text-primary">
        {summary.method} {summary.route}
      </div>
      <div className="flex-1">
        <div className="h-4 rounded bg-desktop-bg-active overflow-hidden">
          <div
            className="h-full rounded bg-amber-500/60"
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
      <div className="shrink-0 font-mono text-right" style={{ minWidth: "5rem" }}>
        <span className="text-amber-400">{summary.avgMs.toFixed(0)}ms</span>
        <span className="text-desktop-text-secondary ml-1">avg</span>
      </div>
      <div className="shrink-0 font-mono text-right" style={{ minWidth: "4rem" }}>
        <span className="text-desktop-text-secondary">{summary.p95Ms.toFixed(0)}ms</span>
        <span className="text-desktop-text-secondary ml-1">p95</span>
      </div>
      <div className="shrink-0 text-right" style={{ minWidth: "3rem" }}>
        <span className="text-desktop-text-secondary">{summary.count}x</span>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}
