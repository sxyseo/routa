"use client";

import type { SessionInfo, TaskInfo } from "../types";

export interface KanbanSpecialistOption {
  id: string;
  name: string;
  role: string;
}

export function getSpecialistName(
  specialistId: string | undefined,
  specialistName: string | undefined,
  specialists: KanbanSpecialistOption[],
): string {
  if (!specialistId && !specialistName) return "None";
  return specialists.find((specialist) => specialist.id === specialistId)?.name ?? specialistName ?? specialistId ?? "None";
}

export function formatSessionTimestamp(value: string | undefined): string {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString();
}

export function getOrderedSessionIds(task: TaskInfo): string[] {
  const laneSessions = task.laneSessions ?? [];
  return laneSessions.length > 0
    ? laneSessions.map((entry) => entry.sessionId)
    : Array.from(new Set([
        ...(task.sessionIds ?? []),
        ...(task.triggerSessionId ? [task.triggerSessionId] : []),
      ]));
}

export function buildSessionDisplayLabel(
  sessionId: string,
  index: number,
  sessionMap: Map<string, SessionInfo>,
): string {
  const session = sessionMap.get(sessionId);
  const name = session?.name?.trim();
  if (name) return name;
  const provider = session?.provider?.trim();
  if (provider) return provider;
  return `Run ${index + 1}`;
}

export function getLaneSessionStepLabel(
  session: { stepIndex?: number; stepName?: string } | undefined,
): string | null {
  if (!session) return null;
  const stepName = session.stepName?.trim();
  if (stepName) return stepName;
  if (typeof session.stepIndex === "number") return `Step ${session.stepIndex + 1}`;
  return null;
}
