// Shared types for workspace dashboard components

export interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  workspaceId: string;
  provider?: string;
  role?: string;
  createdAt: string;
}

export interface TaskInfo {
  id: string;
  title: string;
  objective?: string;
  status: string;
  assignedTo?: string;
  sessionId?: string;
  createdAt: string;
}

export interface BackgroundTaskInfo {
  id: string;
  title: string;
  prompt: string;
  agentId: string;
  status: string;
  triggerSource?: string;
  priority?: string;
  resultSessionId?: string;
  errorMessage?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivity?: string;
  currentActivity?: string;
  toolCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TraceInfo {
  id: string;
  agentName?: string;
  agentRole?: string;
  action?: string;
  summary?: string;
  durationMs?: number;
  createdAt: string;
}
