export type McpServerProfile = "coordination" | "kanban-planning";

const KANBAN_PLANNING_TOOL_NAMES = [
  "create_card",
  "decompose_tasks",
  "search_cards",
  "list_cards_by_column",
  "update_card",
  "move_card",
] as const;

export function resolveMcpServerProfile(value?: string): McpServerProfile | undefined {
  if (value === "coordination" || value === "kanban-planning") {
    return value;
  }
  return undefined;
}

export function getMcpProfileToolAllowlist(profile?: McpServerProfile): ReadonlySet<string> | undefined {
  if (profile === "kanban-planning") {
    return new Set(KANBAN_PLANNING_TOOL_NAMES);
  }
  return undefined;
}

export function getMcpServerName(profile?: McpServerProfile): string {
  return profile === "kanban-planning" ? "kanban-planning-mcp" : "routa-mcp";
}
