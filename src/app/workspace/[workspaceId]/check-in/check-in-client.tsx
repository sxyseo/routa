"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, Calendar, TrendingUp, Award, CheckCircle2, BarChart3, List } from "lucide-react";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { CheckInStatsPage } from "./stats-page";
import { CheckInHistoryList } from "./history-list";

interface CheckInStatus {
  workspaceId: string;
  userId: string;
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  monthlyDays: number;
  adClaimCount: number;
  lastSigninDate?: string;
  lastSigninAt?: number;
}

interface CheckInResponse {
  success: boolean;
  signin?: {
    id: string;
    workspaceId: string;
    userId: string;
    signinDate: string;
    signinAt: number;
    status: string;
    isConsecutive: boolean;
    consecutiveDays: number;
    rewardItemId?: string;
    rewardAmount: number;
  };
  stats?: CheckInStatus;
  reward?: {
    name: string;
    rewardType: string;
    amount: number;
    iconUrl?: string;
  };
  milestoneReward?: {
    id: string;
    name: string;
    amount: number;
  };
  error?: string;
}

interface CheckInClientProps {
  workspaceId: string;
}

type TabType = "checkin" | "stats" | "history";

export function CheckInClient({ workspaceId }: CheckInClientProps) {
  const workspacesHook = useWorkspaces();
  const workspace = workspacesHook.workspaces.find((w) => w.id === workspaceId) ?? null;

  const [activeTab, setActiveTab] = useState<TabType>("checkin");
  const [status, setStatus] = useState<CheckInStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkInResult, setCheckInResult] = useState<CheckInResponse | null>(null);

  // Get user ID from workspace metadata or use a default
  const userId = workspace?.metadata?.userId ?? "default-user";

  // Check if already signed in today
  const isSignedInToday = status?.lastSigninDate === new Date().toISOString().split("T")[0];

  // Fetch check-in status on mount
  useEffect(() => {
    if (!workspaceId) return;

    const fetchStatus = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/check-in/status?workspaceId=${workspaceId}&userId=${userId}`
        );
        if (response.ok) {
          const data: CheckInStatus = await response.json();
          setStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch check-in status:", err);
        setError("Failed to load check-in status");
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [workspaceId, userId]);

  const handleCheckIn = useCallback(async () => {
    if (!workspaceId || checkingIn) return;

    setCheckingIn(true);
    setError(null);
    setCheckInResult(null);

    try {
      const response = await fetch("/api/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, userId }),
      });

      const data: CheckInResponse = await response.json();
      setCheckInResult(data);

      if (data.success && data.stats) {
        setStatus(data.stats);
      }

      if (!data.success && data.error) {
        setError(data.error);
      }
    } catch (err) {
      console.error("Check-in failed:", err);
      setError("签到失败，请稍后重试");
    } finally {
      setCheckingIn(false);
    }
  }, [workspaceId, userId, checkingIn]);

  const tabs = [
    { id: "checkin" as const, label: "签到", icon: Gift },
    { id: "stats" as const, label: "统计", icon: BarChart3 },
    { id: "history" as const, label: "历史", icon: List },
  ];

  const renderContent = () => {
    if (loading && !status) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      );
    }

    if (activeTab === "stats") {
      return <CheckInStatsPage workspaceId={workspaceId} />;
    }

    if (activeTab === "history") {
      return <CheckInHistoryList workspaceId={workspaceId} />;
    }

    return (
      <div className="space-y-6">
        {/* Check-in Button Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mb-4">
              <Gift className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              每日签到
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {isSignedInToday ? "今日已签到" : "完成签到获取奖励"}
            </p>

            <CheckInButton
              isSignedIn={isSignedInToday}
              isLoading={checkingIn}
              onClick={handleCheckIn}
            />

            {checkInResult?.success && checkInResult.reward && (
              <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">
                    获得 {checkInResult.reward.name} × {checkInResult.reward.amount}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            签到记录
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<Calendar className="w-5 h-5 text-blue-500" />}
              label="累计签到"
              value={status?.totalDays ?? 0}
              suffix="天"
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5 text-green-500" />}
              label="连续签到"
              value={status?.currentStreak ?? 0}
              suffix="天"
            />
            <StatCard
              icon={<Award className="w-5 h-5 text-purple-500" />}
              label="最长连续"
              value={status?.longestStreak ?? 0}
              suffix="天"
            />
            <StatCard
              icon={<Calendar className="w-5 h-5 text-orange-500" />}
              label="本月签到"
              value={status?.monthlyDays ?? 0}
              suffix="天"
            />
          </div>
        </div>

        {/* Last Sign-in Info */}
        {status?.lastSigninDate && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              上次签到：{status.lastSigninDate}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        每日签到
      </h1>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {renderContent()}
    </div>
  );
}

interface CheckInButtonProps {
  isSignedIn: boolean;
  isLoading: boolean;
  onClick: () => void;
}

function CheckInButton({ isSignedIn, isLoading, onClick }: CheckInButtonProps) {
  if (isSignedIn) {
    return (
      <button
        disabled
        className="px-8 py-3 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg font-medium cursor-not-allowed flex items-center gap-2"
      >
        <CheckCircle2 className="w-5 h-5" />
        已签到
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
    >
      {isLoading ? (
        <>
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
          签到中...
        </>
      ) : (
        <>
          <Gift className="w-5 h-5" />
          立即签到
        </>
      )}
    </button>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix: string;
}

function StatCard({ icon, label, value, suffix }: StatCardProps) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">
        {value}
        <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
          {suffix}
        </span>
      </div>
    </div>
  );
}
