export type TaskCreationSource = "manual" | "agent" | "api";

export function normalizeTaskCreationSource(value: unknown): TaskCreationSource {
  if (value === "manual" || value === "agent") {
    return value;
  }
  return "api";
}

export function shouldCreateGitHubIssueOnTaskCreate(params: {
  createGitHubIssue: boolean;
  creationSource: TaskCreationSource;
}): boolean {
  return params.createGitHubIssue && params.creationSource === "manual";
}
