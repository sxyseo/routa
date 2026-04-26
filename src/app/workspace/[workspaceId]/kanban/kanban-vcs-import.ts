/**
 * VCS-agnostic import utility functions for the Kanban board.
 *
 * Previously named `kanban-github-import.ts`; all types now resolve
 * through the IVCSProvider abstraction so the same functions work
 * for GitHub, GitLab, or any future VCS provider.
 */

import type { VCSIssueListItem, VCSPullRequestListItem } from "@/core/vcs";
import type { TaskInfo } from "../types";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

export type VCSImportItem = VCSIssueListItem | VCSPullRequestListItem;

/** @deprecated Use VCSImportItem instead. */
export type GitHubImportItem = VCSImportItem;

function summarizeImportedBody(body?: string): string | null {
  if (!body) return null;
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

export function buildMergedImportObjective(
  items: VCSImportItem[],
  labels: { heading: string; summary: string },
): string {
  const lines: string[] = [labels.heading];
  for (const item of items) {
    lines.push(`- #${item.number} ${item.title}`);
    lines.push(`  ${item.url}`);
    const summary = summarizeImportedBody(item.body);
    if (summary) {
      lines.push(`  ${labels.summary}: ${summary}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function collectMergedImportLabels(items: VCSImportItem[]): string[] {
  return Array.from(new Set(items.flatMap((item) => item.labels)));
}

export async function createImportedTask(
  payload: Record<string, unknown>,
  fallbackMessage: string,
): Promise<TaskInfo> {
  const response = await desktopAwareFetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : fallbackMessage);
  }
  return data.task as TaskInfo;
}

interface ImportVCSItemsOptions<TItem extends VCSImportItem> {
  workspaceId: string;
  boardId: string | null;
  codebaseId: string;
  items: TItem[];
  mergeAsSingleCard: boolean;
  mergedTitle: string;
  mergedObjectiveLabels: { heading: string; summary: string };
  mergeFallbackMessage: string;
  createItemPayload: (item: TItem) => Record<string, unknown>;
  createItemFallbackMessage: (item: TItem) => string;
}

export async function importVCSItems<TItem extends VCSImportItem>(
  options: ImportVCSItemsOptions<TItem>,
): Promise<TaskInfo[]> {
  const {
    workspaceId,
    boardId,
    codebaseId,
    items,
    mergeAsSingleCard,
    mergedTitle,
    mergedObjectiveLabels,
    mergeFallbackMessage,
    createItemPayload,
    createItemFallbackMessage,
  } = options;

  if (mergeAsSingleCard) {
    return [await createImportedTask({
      workspaceId,
      boardId,
      columnId: "backlog",
      title: mergedTitle,
      objective: buildMergedImportObjective(items, mergedObjectiveLabels),
      labels: collectMergedImportLabels(items),
      codebaseIds: [codebaseId],
    }, mergeFallbackMessage)];
  }

  return Promise.all(items.map((item) =>
    createImportedTask(createItemPayload(item), createItemFallbackMessage(item))
  ));
}

/** @deprecated Use importVCSItems instead. */
export const importGitHubItems = importVCSItems;
