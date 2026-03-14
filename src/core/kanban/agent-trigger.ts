import { v4 as uuidv4 } from "uuid";
import type { Task } from "../models/task";

export function getInternalApiOrigin(): string {
  const configuredOrigin = process.env.ROUTA_INTERNAL_API_ORIGIN
    ?? process.env.ROUTA_BASE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }

  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function buildTaskPrompt(task: Task): string {
  const labels = task.labels.length > 0 ? `Labels: ${task.labels.join(", ")}` : "Labels: none";
  const isBacklogPlanning = (task.columnId ?? "backlog") === "backlog";
  const availableTools = isBacklogPlanning
    ? [
        `- **update_card**: Update this card's title, description, priority, or labels. Use cardId: "${task.id}"`,
        "- **search_cards**: Search the board for duplicates or related work before creating more tasks",
        "- **create_card**: Create exactly one follow-up backlog card if the current card must be refined into a single user story",
        "- **decompose_tasks**: Create multiple backlog cards when the current card clearly contains multiple independent stories",
        "- **create_note**: Create notes for planning or refinement context",
      ]
    : [
        `- **update_card**: Update this card's title, description, priority, or labels. Use cardId: "${task.id}"`,
        "- **move_card**: Move this card to a different column (e.g., 'in-progress', 'done')",
        "- **report_to_parent**: Report completion status to the parent agent when done",
        "- **create_note**: Create notes for documentation or progress tracking",
      ];
  const instructions = isBacklogPlanning
    ? [
        "1. Treat backlog as planning and refinement, not implementation",
        "2. Clarify or decompose the work into backlog-ready stories when needed",
        "3. Keep the original card in backlog unless the workflow explicitly requires another backlog card",
        "4. Do not move the card out of backlog from this planning step",
        "5. Do not use native tools such as Bash, Read, Write, Edit, Glob, or Grep in backlog planning",
        "6. Do not use GitHub CLI commands such as gh issue create",
        "7. Do not start implementation work in this column",
        "8. Report what backlog story or stories were created or refined",
      ]
    : [
        "1. Start implementation work immediately",
        "2. Use `update_card` to track progress in the card description",
        "3. Use `move_card` to move the card to 'in-progress' when starting",
        "4. Keep changes focused on this task",
        "5. When complete, use `move_card` to move to 'done' and `report_to_parent` to report completion",
      ];

  return [
    `You are assigned to Kanban task: ${task.title}`,
    "",
    "## Context",
    "",
    "**IMPORTANT**: You are working in Kanban context. Use MCP tools (update_card, move_card, etc.) to manage this card.",
    "Do NOT create or sync GitHub issues during backlog planning.",
    "Do NOT use `gh issue create` or other GitHub CLI commands — those are for GitHub issue context only.",
    "",
    "## Task Details",
    "",
    `**Card ID:** ${task.id}`,
    `**Priority:** ${task.priority ?? "medium"}`,
    labels,
    task.githubUrl ? `**GitHub Issue:** ${task.githubUrl}` : "**GitHub Issue:** local-only",
    "",
    "## Objective",
    "",
    task.objective,
    "",
    "## Available MCP Tools",
    "",
    "You have access to the following MCP tools for task management:",
    "",
    ...availableTools,
    "",
    "## Instructions",
    "",
    ...instructions,
  ].join("\n");
}

export async function triggerAssignedTaskAgent(params: {
  origin: string;
  workspaceId: string;
  cwd: string;
  branch?: string;
  task: Task;
}): Promise<{ sessionId?: string; error?: string }> {
  const { origin, workspaceId, cwd, branch, task } = params;
  const provider = task.assignedProvider ?? "opencode";
  const role = task.assignedRole ?? "CRAFTER";

  const newSessionResponse = await fetch(`${origin}/api/acp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "session/new",
      params: {
        cwd,
        branch,
        provider,
        role,
        workspaceId,
        specialistId: task.assignedSpecialistId,
        name: `${task.title} · ${provider}`,
      },
    }),
  });

  const newSessionBody = await newSessionResponse.json() as { result?: { sessionId?: string }; error?: { message?: string } };
  const sessionId = newSessionBody.result?.sessionId;
  if (!newSessionResponse.ok || !sessionId) {
    return { error: newSessionBody.error?.message ?? "Failed to create ACP session." };
  }

  void fetch(`${origin}/api/acp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "session/prompt",
      params: {
        sessionId,
        workspaceId,
        provider,
        cwd,
        prompt: [{ type: "text", text: buildTaskPrompt(task) }],
      },
    }),
  }).catch((error) => {
    console.error("[kanban] Failed to auto-prompt ACP task session:", error);
  });

  return { sessionId };
}
