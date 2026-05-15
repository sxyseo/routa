"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar, TrendingUp, Award, Download, RefreshCw } from "lucide-react";
import { useWorkspaces } from "@/client/hooks/use-workspaces";

interface CheckInStats {
  workspaceId: string;
  userId: string;
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  monthlyRate: number;
  monthlyDays: number;
  totalPoints: number;
  adClaimCount: number;
  lastSigninDate?: string;
  lastSigninAt?: number;
}

interface StatsPageProps {
  workspaceId: string;
}

export function CheckInStatsPage({ workspaceId }: StatsPageProps) {
  const workspacesHook = useWorkspaces();
  const workspace = workspacesHook.workspaces.find((w) => w.id === workspaceId) ?? null;

  const userId = workspace?.metadata?.userId ?? "default-user";

  const [stats, setStats] = useState<CheckInStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(
        `/api/check-in/stats?workspaceId=${workspaceId}&userId=${userId}`
      );
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      } else {
        throw new Error("Failed to fetch stats");
      }
    } catch (err) {
      console.error("Failed to fetch check-in stats:", err);
      setError("加载签到统计数据失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId, userId]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/check-in/stats?workspaceId=${workspaceId}&userId=${userId}`,
          { signal: controller.signal }
        );
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        } else {
          throw new Error("Failed to fetch stats");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Failed to fetch check-in stats:", err);
        setError("加载签到统计数据失败");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [workspaceId, userId]);

  const handleExport = async () => {
    try {
      const response = await fetch(
        `/api/check-in/export?workspaceId=${workspaceId}&userId=${userId}&format=csv`
      );
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `checkin_export_${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          签到统计
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchStats(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600"
          >
            <Download className="w-4 h-4" />
            导出数据
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Calendar className="w-6 h-6 text-blue-500" />}
          label="累计签到"
          value={stats?.totalDays ?? 0}
          suffix="天"
          description="总签到天数"
        />
        <StatCard
          icon={<TrendingUp className="w-6 h-6 text-green-500" />}
          label="当前连续"
          value={stats?.currentStreak ?? 0}
          suffix="天"
          description="连续签到天数"
          highlight={!!(stats?.currentStreak && stats.currentStreak >= 7)}
        />
        <StatCard
          icon={<Award className="w-6 h-6 text-purple-500" />}
          label="最长连续"
          value={stats?.longestStreak ?? 0}
          suffix="天"
          description="历史最长连续"
        />
        <StatCard
          icon={<Calendar className="w-6 h-6 text-orange-500" />}
          label="本月签到率"
          value={Math.round((stats?.monthlyRate ?? 0) * 100)}
          suffix="%"
          description={`${currentMonth} 签到率`}
        />
      </div>

      {/* Detailed Stats */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          详细数据
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              本月签到天数
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats?.monthlyDays ?? 0}
              <span className="text-sm font-normal text-gray-500 ml-1">天</span>
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              累计获得积分
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats?.totalPoints ?? 0}
              <span className="text-sm font-normal text-gray-500 ml-1">分</span>
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              广告补签次数
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats?.adClaimCount ?? 0}
              <span className="text-sm font-normal text-gray-500 ml-1">次</span>
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              最后签到日期
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats?.lastSigninDate ?? "-"}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Info */}
      {stats && stats.currentStreak > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <TrendingUp className="w-8 h-8 text-white" />
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                当前连续签到
              </div>
              <div className="text-3xl font-bold text-gray-900 dark:text-white">
                {stats.currentStreak} 天
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                再签到 {7 - (stats.currentStreak % 7)} 天可获得更多奖励
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  suffix?: string;
  description?: string;
  highlight?: boolean;
}

function StatCard({ icon, label, value, suffix, description, highlight }: StatCardProps) {
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border p-6 ${
        highlight
          ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">{icon}</div>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <div className="text-3xl font-bold text-gray-900 dark:text-white">
        {value}
        {suffix && <span className="text-lg font-normal text-gray-500 ml-1">{suffix}</span>}
      </div>
      {description && (
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{description}</div>
      )}
    </div>
  );
}
