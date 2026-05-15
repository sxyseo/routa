export interface KanbanWorktreeNaming {
  shortTaskId: string;
  branch: string;
  label: string;
}

/**
 * Build a deterministic branch name for a kanban task.
 *
 * When a title is provided, generates a human-readable slug-based name:
 *   `issue/<slug>-<shortId>`
 *
 * Falls back to a longer ID-based name when no title is available:
 *   `issue/<12-char-id>`
 */
export function buildKanbanWorktreeNaming(
  taskId: string,
  options?: { title?: string },
): KanbanWorktreeNaming {
  const normalizedTaskId = taskId.trim();
  const shortTaskId = normalizedTaskId.slice(0, 8) || "task";

  const title = options?.title?.trim();
  if (title) {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    if (slug.length >= 3) {
      return {
        shortTaskId,
        branch: `issue/${slug}-${shortTaskId}`,
        label: slug,
      };
    }
  }

  // Fallback: ID-based with 12 chars to lower collision probability
  return {
    shortTaskId,
    branch: `issue/${normalizedTaskId.slice(0, 12) || shortTaskId}`,
    label: shortTaskId,
  };
}
