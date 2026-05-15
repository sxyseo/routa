/**
 * Graph Analysis — algorithmic analysis of task dependency graphs.
 *
 * Provides topological sorting, critical path, parallel group detection,
 * file conflict detection, and completeness analysis for a set of tasks.
 * Pure functions, no LLM dependency. Reuses patterns from task-split-topology.ts.
 */

import type { Task } from "../models/task";
import type { FileConflictWarning } from "./task-split-topology";

// ─── Types ──────────────────────────────────────────────────────────────

export interface TaskGraphNode {
  taskId: string;
  title: string;
  objective: string;
  scope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  estimatedFilePaths?: string[];
  declaredDependencies: string[];
}

/** [fromId, toId] meaning "from" must complete before "to" */
export type TaskDependencyEdge = [string, string];

export interface CompletenessIssue {
  taskId: string;
  taskTitle: string;
  missing: string[];
}

export interface GraphAnalysisResult {
  topologicalOrder: string[];
  criticalPath: string[];
  parallelGroups: string[][];
  fileConflicts: FileConflictWarning[];
  completenessIssues: CompletenessIssue[];
  errors: string[];
}

// ─── Adapter ────────────────────────────────────────────────────────────

export function buildTaskGraph(tasks: Task[]): TaskGraphNode[] {
  return tasks.map((t) => ({
    taskId: t.id,
    title: t.title,
    objective: t.objective,
    scope: t.scope,
    acceptanceCriteria: t.acceptanceCriteria,
    verificationCommands: t.verificationCommands,
    testCases: t.testCases,
    estimatedFilePaths: (t as Task & { estimatedFilePaths?: string[] }).estimatedFilePaths,
    declaredDependencies: t.dependencies ?? [],
  }));
}

/** Build dependency edges from declared dependencies on all nodes. */
export function buildDeclaredEdges(nodes: TaskGraphNode[]): TaskDependencyEdge[] {
  const nodeIds = new Set(nodes.map((n) => n.taskId));
  const edges: TaskDependencyEdge[] = [];
  for (const node of nodes) {
    for (const depId of node.declaredDependencies) {
      if (nodeIds.has(depId)) {
        edges.push([depId, node.taskId]);
      }
    }
  }
  return edges;
}

// ─── Topological Sort (Kahn's algorithm) ────────────────────────────────

/**
 * Topological sort of task IDs based on dependency edges.
 * Returns ordered IDs where each task appears after all its dependencies.
 * Returns { order, hasCycle } — does not throw on cycle.
 */
export function topologicalSortTasks(
  nodes: TaskGraphNode[],
  edges: TaskDependencyEdge[],
): { order: string[]; hasCycle: boolean } {
  const nodeIds = new Set(nodes.map((n) => n.taskId));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const [from, to] of edges) {
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    adjacency.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  return { order: sorted, hasCycle: sorted.length !== nodeIds.size };
}

// ─── Critical Path (CPM) ────────────────────────────────────────────────

/**
 * Find the critical path — the longest chain in the dependency graph.
 * Uses dynamic programming on the topological order.
 * All edge weights are 1 (each task takes one unit of time).
 */
export function computeCriticalPath(
  nodes: TaskGraphNode[],
  edges: TaskDependencyEdge[],
): string[] {
  if (nodes.length === 0) return [];

  const nodeIds = new Set(nodes.map((n) => n.taskId));

  // Build reverse adjacency: taskId -> tasks that depend on it
  const forward = new Map<string, string[]>();
  // Build in-adjacency: taskId -> tasks it depends on
  const backward = new Map<string, string[]>();
  for (const id of nodeIds) {
    forward.set(id, []);
    backward.set(id, []);
  }
  for (const [from, to] of edges) {
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    forward.get(from)!.push(to);
    backward.get(to)!.push(from);
  }

  // Topological order
  const { order, hasCycle } = topologicalSortTasks(nodes, edges);
  if (hasCycle || order.length === 0) return [];

  // Forward pass: compute longest distance to each node
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const id of nodeIds) {
    dist.set(id, 0);
    prev.set(id, null);
  }

  for (const id of order) {
    const currentDist = dist.get(id) ?? 0;
    for (const next of forward.get(id) ?? []) {
      const newDist = currentDist + 1;
      if (newDist > (dist.get(next) ?? 0)) {
        dist.set(next, newDist);
        prev.set(next, id);
      }
    }
  }

  // Find the node with the maximum distance
  let endId = order[0];
  let maxDist = 0;
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endId = id;
    }
  }

  // Trace back from end to start
  const path: string[] = [];
  let current: string | null = endId;
  while (current !== null) {
    path.unshift(current);
    current = prev.get(current) ?? null;
  }

  return path;
}

// ─── Parallel Groups ────────────────────────────────────────────────────

/**
 * Identify groups of tasks that can run in parallel.
 * Two tasks can run in parallel if there is no path between them
 * in either direction in the dependency graph.
 */
export function computeParallelGroups(
  nodes: TaskGraphNode[],
  edges: TaskDependencyEdge[],
): string[][] {
  if (nodes.length === 0) return [];

  const nodeIds = new Set(nodes.map((n) => n.taskId));
  const { order } = topologicalSortTasks(nodes, edges);

  // Group tasks by their earliest possible level (max depth of dependency chain + 1).
  // Tasks at the same level have no path between them and can run in parallel.
  const levels = new Map<string, number>();
  for (const id of order) {
    let maxDepLevel = -1;
    for (const [from, to] of edges) {
      if (to === id && levels.has(from)) {
        maxDepLevel = Math.max(maxDepLevel, levels.get(from)!);
      }
    }
    levels.set(id, maxDepLevel + 1);
  }

  const levelGroups = new Map<number, string[]>();
  for (const [id, level] of levels) {
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level)!.push(id);
  }

  const sortedLevels = [...levelGroups.entries()].sort((a, b) => a[0] - b[0]);
  return sortedLevels.map(([, groupIds]) => groupIds);
}

// ─── File Conflict Detection ────────────────────────────────────────────

/**
 * Detect file paths referenced by multiple tasks.
 * Reuses the pattern from task-split-topology.ts:detectFileConflicts.
 */
export function detectTaskFileConflicts(
  nodes: TaskGraphNode[],
): FileConflictWarning[] {
  const pathOwners = new Map<string, string[]>();

  for (const n of nodes) {
    for (const p of n.estimatedFilePaths ?? []) {
      const normalized = p.toLowerCase().replace(/\\/g, "/");
      const owners = pathOwners.get(normalized) ?? [];
      owners.push(n.taskId);
      pathOwners.set(normalized, owners);
    }
  }

  return [...pathOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([path, owners]) => ({ path, taskRefs: owners }));
}

// ─── Completeness Analysis ──────────────────────────────────────────────

export function analyzeTaskCompleteness(tasks: Task[]): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];

  for (const t of tasks) {
    const missing: string[] = [];
    if (!t.scope?.trim()) missing.push("scope");
    if (!t.acceptanceCriteria?.length) missing.push("acceptanceCriteria");
    if (!t.verificationCommands?.length) missing.push("verificationCommands");
    if (missing.length > 0) {
      issues.push({ taskId: t.id, taskTitle: t.title, missing });
    }
  }

  return issues;
}

// ─── Graph Validation ───────────────────────────────────────────────────

/**
 * Validate the dependency graph structure.
 * Returns error messages (empty if valid).
 */
export function validateDependencyGraph(
  nodes: TaskGraphNode[],
  edges: TaskDependencyEdge[],
): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.taskId));

  // Check edges reference valid IDs
  for (const [from, to] of edges) {
    if (!nodeIds.has(from)) errors.push(`Edge references unknown task: ${from}`);
    if (!nodeIds.has(to)) errors.push(`Edge references unknown task: ${to}`);
    if (from === to) errors.push(`Self-dependency: ${from}`);
  }

  // Check for cycles
  const { hasCycle, order } = topologicalSortTasks(nodes, edges);
  if (hasCycle) {
    const remaining = [...nodeIds].filter((id) => !order.includes(id));
    errors.push(`Circular dependency detected among: ${remaining.join(", ")}`);
  }

  return errors;
}

// ─── Full Analysis ──────────────────────────────────────────────────────

/**
 * Run the full graph analysis pipeline on a set of tasks.
 */
export function analyzeTaskGraph(tasks: Task[]): GraphAnalysisResult {
  const nodes = buildTaskGraph(tasks);
  const declaredEdges = buildDeclaredEdges(nodes);

  const validationErrors = validateDependencyGraph(nodes, declaredEdges);
  const { order: topologicalOrder, hasCycle } = topologicalSortTasks(nodes, declaredEdges);
  const criticalPath = hasCycle ? [] : computeCriticalPath(nodes, declaredEdges);
  const parallelGroups = hasCycle ? [] : computeParallelGroups(nodes, declaredEdges);
  const fileConflicts = detectTaskFileConflicts(nodes);
  const completenessIssues = analyzeTaskCompleteness(tasks);

  return {
    topologicalOrder,
    criticalPath,
    parallelGroups,
    fileConflicts,
    completenessIssues,
    errors: validationErrors,
  };
}
