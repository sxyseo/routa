/**
 * AI-Enhanced Error Diagnostic
 *
 * Enhances rule-based TaskDiagnostic with LLM-generated root cause analysis.
 * Only triggered for `unknown_error` and `watchdog_recovery` categories where
 * rule-based diagnosis lacks precision.
 *
 * Uses Vercel AI SDK's generateText for a single-turn, no-tool-call invocation.
 * Falls back gracefully on any failure.
 */

import { generateText } from "ai";
import {
  resolveWorkspaceAgentConfig,
  createLanguageModel,
} from "../acp/workspace-agent/workspace-agent-config";
import type { TaskLaneSession } from "../models/task";
import type { TaskDiagnosticCategory } from "./task-diagnostic";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AiErrorDiagnosticInput {
  lastSyncError: string;
  taskTitle: string;
  columnId?: string;
  laneSessions: TaskLaneSession[];
  category: TaskDiagnosticCategory;
}

export interface AiErrorDiagnosticResult {
  rootCause: string;
  severity: "low" | "medium" | "high";
  actionHint: string;
}

// ── In-memory LRU cache ────────────────────────────────────────────────────

const cache = new Map<string, { result: AiErrorDiagnosticResult; expiresAt: number }>();
const CACHE_MAX = 50;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function getCached(key: string): AiErrorDiagnosticResult | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

function setCache(key: string, result: AiErrorDiagnosticResult): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Trigger logic ──────────────────────────────────────────────────────────

const AI_ENHANCED_CATEGORIES = new Set<TaskDiagnosticCategory>([
  "unknown_error",
  "watchdog_recovery",
]);

export function shouldEnhanceWithAi(category: TaskDiagnosticCategory): boolean {
  return AI_ENHANCED_CATEGORIES.has(category);
}

// ── Prompt builder ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert diagnostician for a kanban-driven development system.
Given an error message and execution context, produce a concise root cause analysis and action recommendation.
Output valid JSON only: { "rootCause": "...", "severity": "low|medium|high", "actionHint": "..." }
Constraints: rootCause ≤ 80 chars, actionHint ≤ 60 chars, respond in the same language as the error message.`;

function buildUserPrompt(input: AiErrorDiagnosticInput): string {
  const recentSessions = input.laneSessions.slice(-3);
  const sessionLines = recentSessions.map((s, i) => {
    const duration = s.startedAt && s.completedAt
      ? `${Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)}min`
      : "ongoing";
    return `  ${i + 1}. ${s.stepName ?? "unknown"} | status: ${s.status} | duration: ${duration}${s.recoveryReason ? ` | recovery: ${s.recoveryReason}` : ""}`;
  }).join("\n");

  return [
    `Task: ${input.taskTitle}`,
    `Column: ${input.columnId ?? "unknown"}`,
    `Error category: ${input.category}`,
    `Error text: ${input.lastSyncError}`,
    "",
    "Recent sessions:",
    sessionLines || "  (none)",
    "",
    'Output JSON: { "rootCause": "...", "severity": "low|medium|high", "actionHint": "..." }',
  ].join("\n");
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function enhanceDiagnosticWithAi(
  input: AiErrorDiagnosticInput,
): Promise<AiErrorDiagnosticResult | undefined> {
  const cacheKey = `${input.category}:${input.lastSyncError}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const config = resolveWorkspaceAgentConfig({
      maxSteps: 1,
      maxTokens: 256,
    });
    const model = await createLanguageModel(config);

    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(input),
      abortSignal: AbortSignal.timeout(15_000),
    });

    const parsed = extractJson(text);
    if (!parsed) return undefined;

    const severityRaw = String(parsed.severity ?? "medium");
    const result: AiErrorDiagnosticResult = {
      rootCause: String(parsed.rootCause ?? "").slice(0, 80),
      severity: (["low", "medium", "high"].includes(severityRaw) ? severityRaw : "medium") as AiErrorDiagnosticResult["severity"],
      actionHint: String(parsed.actionHint ?? "").slice(0, 60),
    };

    if (!result.rootCause) return undefined;

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.warn("[AiErrorDiagnostic] LLM enhancement failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractJson(text: string): Record<string, unknown> | undefined {
  // Try direct parse first
  try { return JSON.parse(text); } catch { /* continue */ }
  // Try extracting from markdown code block
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch { /* continue */ }
  }
  // Try finding first { ... } in text
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* ignore */ }
  }
  return undefined;
}
