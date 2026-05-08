"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Calendar, CheckCircle2, Clock } from "lucide-react";
import { useWorkspaces } from "@/client/hooks/use-workspaces";

interface CheckInRecord {
  id: string;
  signinDate: string;
  signinAt: number;
  status: string;
  isConsecutive: boolean;
  consecutiveDays: number;
  isMakeup: boolean;
  rewardAmount: number;
  rewardType?: string;
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface CheckInHistoryResponse {
  records: CheckInRecord[];
  pagination: PaginationInfo;
}

interface HistoryListProps {
  workspaceId: string;
}

export function CheckInHistoryList({ workspaceId }: HistoryListProps) {
  const workspacesHook = useWorkspaces();
  const workspace = workspacesHook.workspaces.find((w) => w.id === workspaceId) ?? null;

  const userId = workspace?.metadata?.userId ?? "default-user";

  const [history, setHistory] = useState<CheckInHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const fetchHistory = useCallback(async (month: string, page: number = 1) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/check-in/history?workspaceId=${workspaceId}&userId=${userId}&month=${month}&page=${page}&pageSize=30`
      );
      if (response.ok) {
        const data: CheckInHistoryResponse = await response.json();
        setHistory(data);
      } else {
        throw new Error("Failed to fetch history");
      }
    } catch (err) {
      console.error("Failed to fetch check-in history:", err);
      setError("加载签到历史失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, userId]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/check-in/history?workspaceId=${workspaceId}&userId=${userId}&month=${selectedMonth}&page=1&pageSize=30`,
          { signal: controller.signal }
        );
        if (response.ok) {
          const data: CheckInHistoryResponse = await response.json();
          setHistory(data);
        } else {
          throw new Error("Failed to fetch history");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Failed to fetch check-in history:", err);
        setError("加载签到历史失败");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [workspaceId, userId, selectedMonth]);

  const handlePrevMonth = () => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const date = new Date(year, month - 2, 1);
    setSelectedMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleNextMonth = () => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const date = new Date(year, month, 1);
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (selectedMonth < currentMonth) {
      setSelectedMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    }
  };

  const handlePageChange = (page: number) => {
    void fetchHistory(selectedMonth, page);
  };

  const handleExport = async () => {
    try {
      const response = await fetch(
        `/api/check-in/export?workspaceId=${workspaceId}&userId=${userId}&format=csv&fromDate=${selectedMonth}-01`
      );
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `checkin_history_${selectedMonth}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-");
    return `${year}年${month}月${day}日`;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const monthLabel = () => {
    const [year, month] = selectedMonth.split("-");
    return `${year}年${parseInt(month)}月`;
  };

  if (loading && !history) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error && !history) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          签到历史
        </h1>
        <button
          onClick={() => void handleExport()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600"
        >
          <Download className="w-4 h-4" />
          导出 CSV
        </button>
      </div>

      {/* Month Selector */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={handlePrevMonth}
          className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <Calendar className="w-5 h-5 text-gray-500" />
          <span className="text-lg font-semibold text-gray-900 dark:text-white">
            {monthLabel()}
          </span>
        </div>
        <button
          onClick={handleNextMonth}
          className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
      </div>

      {/* History Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  日期
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  签到时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  连续天数
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  获得积分
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {history?.records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                    <p>本月暂无签到记录</p>
                  </td>
                </tr>
              ) : (
                history?.records.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {formatDate(record.signinDate)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <Clock className="w-4 h-4" />
                        {formatTime(record.signinAt)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {record.isMakeup ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                          补签
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          正常
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900 dark:text-white">
                        {record.consecutiveDays} 天
                      </span>
                      {record.isConsecutive && (
                        <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                          🔥
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        +{record.rewardAmount}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {history && history.pagination.totalPages > 1 && (
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                共 {history.pagination.total} 条记录，第 {history.pagination.page} / {history.pagination.totalPages} 页
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(history.pagination.page - 1)}
                  disabled={history.pagination.page <= 1}
                  className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  上一页
                </button>
                <button
                  onClick={() => handlePageChange(history.pagination.page + 1)}
                  disabled={history.pagination.page >= history.pagination.totalPages}
                  className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
