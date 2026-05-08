/**
 * Graph Refiner — LLM-driven dependency inference for Backlog tasks.
 *
 * Analyzes a set of tasks, asks the LLM to infer hidden dependencies,
 * then validates and writes the results using the graph-analysis engine.
 */

import { generateText } from "ai";
import { resolveWorkspaceAgentConfig, createLanguageModel } from "../acp/workspace-agent/workspace-agent-config";
import { v4 as uuidv4 } from "uuid";
import type { Task, TaskCommentEntry } from "../models/task";
import { updateDependencyRelations } from "./dependency-gate";
import { buildTaskGraph, buildDeclaredEdges, validateDependencyGraph, type TaskGraphNode } from "./graph-analysis";
import { getKanbanConfig } from "./kanban-config";

// ─── Types ──────────────────────────────────────────────────────────────

export interface RefinerInferredDep {
  taskId: string;
  dependsOn: string[];
  reason: string;
}

export interface RefinerRunResult {
  inferredCount: number;
  skippedCycles: number;
  errors: string[];
}

// ─── Prompt Builder ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a dependency graph analyst for a kanban development board.
Given a list of tasks in the Backlog, infer hidden dependency relationships between them.

Rules:
1. Only infer dependencies where Task B genuinely blocks Task A (A needs B's output).
2. Consider file paths, scope overlaps, and logical sequencing.
3. Respect already-declared dependencies — do not remove them.
4. If tasks are truly independent, do NOT force dependencies.
5. Output valid JSON only: { "inferred": [{ "taskId": "...", "dependsOn": ["..."], "reason": "..." }] }
6. Keep reason ≤ 60 chars.
7. Respond in English.`;

function buildRefinerUserPrompt(tasks: Task[], nodes: TaskGraphNode[]): string {
  const taskLines = tasks.map((t, i) => {
    const node = nodes[i];
    const deps = node?.declaredDependencies.length
      ? ` | declaredDeps: [${node.declaredDependencies.join(", ")}]`
      : "";
    const scope = t.scope ? ` | scope: ${t.scope}` : "";
    const files = (node?.estimatedFilePaths?.length)
      ? ` | files: [${node.estimatedFilePaths.join(", ")}]`
      : "";
    return `${i + 1}. [${t.id}] ${t.title}${scope}${deps}${files}\n   Objective: ${t.objective ?? "N/A"}`;
  }).join("\n\n");

  const taskIds = tasks.map((t) => t.id);
  return [
    `Analyze these ${tasks.length} Backlog tasks and infer dependencies:\n`,
    taskLines,
    "",
    `Valid task IDs: [${taskIds.join(", ")}]`,
    'Output JSON: { "inferred": [{ "taskId": "...", "dependsOn": ["..."], "reason": "..." }] }',
  ].join("\n");
}

// ─── Response Parser ────────────────────────────────────────────────────

function extractJson(text: string): Record<string, unknown> | undefined {
  try { return JSON.parse(text); } catch { /* continue */ }
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1]!); } catch { /* continue */ }
  }
  // Try finding first { ... } block
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* continue */ }
  }
  return undefined;
}

export function parseRefinerResponse(
  response: string,
  validTaskIds: Set<string>,
): RefinerInferredDep[] {
  const parsed = extractJson(response);
  if (!parsed || !Array.isArray(parsed.inferred)) return [];

  return (parsed.inferred as Array<Record<string, unknown>>)
    .filter((entry) => {
      const taskId = String(entry.taskId ?? "");
      if (!validTaskIds.has(taskId)) return false;
      const dependsOn = Array.isArray(entry.dependsOn) ? entry.dependsOn : [];
      return dependsOn.every((id: unknown) => validTaskIds.has(String(id)));
    })
    .map((entry) => ({
      taskId: String(entry.taskId!),
      dependsOn: (Array.isArray(entry.dependsOn) ? entry.dependsOn as unknown[] : [])
        .map((id) => String(id)),
      reason: String(entry.reason ?? "").slice(0, 60),
    }));
}

// ─── Main Refiner Logic ─────────────────────────────────────────────────

export async function runGraphRefiner(
  tasks: Task[],
  taskStore: {
    get(id: string): Promise<Task | undefined | null>;
    save(task: Task): Promise<void>;
  },
): Promise<RefinerRunResult> {
  const config = getKanbanConfig();
  const maxTasks = config.graphRefinerMaxTasks;

  const backlogTasks = tasks.slice(0, maxTasks);
  if (backlogTasks.length < config.graphRefinerMinTasks) {
    return { inferredCount: 0, skippedCycles: 0, errors: ["Not enough tasks for refiner"] };
  }

  const nodes = buildTaskGraph(backlogTasks);
  const validTaskIds = new Set(backlogTasks.map((t) => t.id));

  // LLM inference
  let inferred: RefinerInferredDep[];
  try {
    const agentConfig = resolveWorkspaceAgentConfig({
      maxSteps: 1,
      maxTokens: 2048,
    });
    const model = await createLanguageModel(agentConfig);

    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildRefinerUserPrompt(backlogTasks, nodes),
      abortSignal: AbortSignal.timeout(60_000),
    });

    inferred = parseRefinerResponse(text, validTaskIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { inferredCount: 0, skippedCycles: 0, errors: [`LLM call failed: ${msg}`] };
  }

  if (inferred.length === 0) {
    return { inferredCount: 0, skippedCycles: 0, errors: [] };
  }

  // Merge declared + inferred dependencies, then validate for cycles
  const mergedEdges = buildDeclaredEdges(nodes);
  const inferredEdges = inferred.flatMap((dep) =>
    dep.dependsOn.map((fromId) => [fromId, dep.taskId] as [string, string]),
  );
  const allEdges = [...mergedEdges, ...inferredEdges];

  const validationErrors = validateDependencyGraph(nodes, allEdges);
  if (validationErrors.length > 0) {
    return { inferredCount: 0, skippedCycles: 1, errors: validationErrors };
  }

  // Write merged dependencies to tasks.
  // Use get-then-save with fresh read after updateDependencyRelations to avoid TOCTOU.
  let writtenCount = 0;
  const errors: string[] = [];

  for (const dep of inferred) {
    try {
      const task = await taskStore.get(dep.taskId);
      if (!task) continue;

      const existing = new Set(task.dependencies ?? []);
      const newDeps = dep.dependsOn.filter((id) => !existing.has(id));
      if (newDeps.length === 0) continue;

      const mergedDeps = [...task.dependencies, ...newDeps];

      // Update bidirectional relations first (modifies dependency tasks)
      await updateDependencyRelations(task.id, mergedDeps, taskStore);

      // Re-read to get the latest version after concurrent modifications
      const freshTask = await taskStore.get(dep.taskId);
      if (!freshTask) continue;

      freshTask.dependencies = mergedDeps;
      freshTask.updatedAt = new Date();

      const comment: TaskCommentEntry = {
        id: uuidv4(),
        source: "graph-refiner",
        body: `Inferred dependencies: ${newDeps.join(", ")}. Reason: ${dep.reason}`,
        createdAt: new Date().toISOString(),
      };
      if (!freshTask.comments) freshTask.comments = [];
      freshTask.comments.push(comment);

      await taskStore.save(freshTask);
      writtenCount++;
    } catch (err) {
      errors.push(`Failed to update task ${dep.taskId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { inferredCount: writtenCount, skippedCycles: 0, errors };
}
