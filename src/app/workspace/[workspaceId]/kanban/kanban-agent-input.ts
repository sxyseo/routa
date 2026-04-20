export const AGENT_REFRESH_BURST_DELAYS_MS = [2_000, 10_000] as const;
export { buildKanbanTaskAgentPrompt } from "./i18n/kanban-task-agent";

export function scheduleKanbanRefreshBurst(onRefresh: () => void): () => void {
  const timerIds = AGENT_REFRESH_BURST_DELAYS_MS.map((delay) => window.setTimeout(() => {
    onRefresh();
  }, delay));

  return () => {
    for (const timerId of timerIds) {
      window.clearTimeout(timerId);
    }
  };
}
