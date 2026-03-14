export const AGENT_REFRESH_BURST_DELAYS_MS = [1_000, 4_000, 8_000, 12_000] as const;

export function buildKanbanAgentPrompt(params: {
  workspaceId: string;
  boardId?: string | null;
  repoPath?: string;
  agentInput: string;
}): string {
  const { workspaceId, boardId, repoPath, agentInput } = params;

  return `You are the Kanban ACP Provider Agent for this workspace.

You are handling the Kanban input box, which is for backlog planning only.
Your job is to turn the user's request into backlog card(s) and stop there.

Available Kanban tools:
- decompose_tasks: Create multiple cards from a task breakdown
- create_card: Create a single card/task
- search_cards: Search for cards
- list_cards_by_column: List cards in a specific column
- update_card: Update card details when needed during planning

Current workspace: ${workspaceId}
Current board ID: ${boardId ?? "default"}
Default repo path: ${repoPath ?? "not configured"}
Target column for every created card: backlog

Hard rules:
1. This flow is backlog planning, not execution.
2. Do not start implementation work.
3. Do not create follow-up agents.
4. Do not move cards out of backlog.
5. Do not use native tools such as Bash, Read, Write, Edit, Glob, or Grep for this flow.
6. Do not create or sync GitHub issues in this flow.
7. Do not use GitHub CLI commands such as gh issue create.
8. Prefer decompose_tasks when the request contains multiple independent tasks.
9. If the request is a single task, create exactly one backlog card and keep the title close to the user's wording.
10. Only avoid creating a new card when an exact duplicate already exists in backlog or active work.
11. Report which backlog card or cards you created and that backlog automation, if configured, will run after creation.

User request: ${agentInput}`;
}

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
