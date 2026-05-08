"use client";

import { Gift, CheckCircle2 } from "lucide-react";

interface CheckInButtonProps {
  isSignedIn: boolean;
  isLoading: boolean;
  onClick: () => void;
}

export function CheckInButton({
  isSignedIn,
  isLoading,
  onClick,
}: CheckInButtonProps) {
  if (isSignedIn) {
    return (
      <button
        disabled
        className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 rounded-lg font-medium cursor-not-allowed flex items-center gap-2 transition-colors"
        title="今日已签到"
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
      className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md hover:shadow-lg"
      title="点击签到获取奖励"
    >
      {isLoading ? (
        <>
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
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