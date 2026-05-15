/**
 * Task Split Topology
 *
 * Provides topological sorting and file conflict pre-detection for
 * task splitting operations. Ensures sub-task execution order respects
 * dependency constraints and warns about potential merge conflicts.
 */

// ─── Sub-task definition for planning ──────────────────────────────────

export interface SubTaskDef {
  /** Temporary reference ID used in dependencyEdges (resolved to real ID on creation) */
  ref: string;
  title: string;
  objective: string;
  scope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  /** File paths this sub-task is expected to modify — used for conflict pre-detection */
  estimatedFilePaths?: string[];
  /** Execution order priority (assigned after topological sort) */
  topoOrder?: number;
}

// ─── Dependency edge: [fromRef, toRef] means "from" must complete before "to" ──

export type DependencyEdge = [string, string];

// ─── Topological sort ──────────────────────────────────────────────────

/**
 * Topological sort of sub-tasks based on dependency edges (Kahn's algorithm).
 *
 * Returns an ordered array where each task appears after all its dependencies.
 * Throws if a circular dependency is detected.
 */
export function topologicalSort(
  tasks: SubTaskDef[],
  edges: DependencyEdge[],
): SubTaskDef[] {
  const taskMap = new Map(tasks.map((t) => [t.ref, t]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.ref, 0);
    adjacency.set(t.ref, []);
  }

  for (const [from, to] of edges) {
    if (!taskMap.has(from) || !taskMap.has(to)) {
      throw new Error(
        `[SplitTopology] Dependency edge references unknown task: ${from} → ${to}`,
      );
    }
    adjacency.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [ref, deg] of inDegree) {
    if (deg === 0) queue.push(ref);
  }

  const sorted: SubTaskDef[] = [];
  while (queue.length > 0) {
    const ref = queue.shift()!;
    const task = taskMap.get(ref)!;
    task.topoOrder = sorted.length;
    sorted.push(task);

    for (const next of adjacency.get(ref) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (sorted.length !== tasks.length) {
    const remaining = tasks
      .filter((t) => !sorted.some((s) => s.ref === t.ref))
      .map((t) => t.ref);
    throw new Error(
      `[SplitTopology] Circular dependency detected among: ${remaining.join(", ")}`,
    );
  }

  return sorted;
}

// ─── File conflict pre-detection ───────────────────────────────────────

export interface FileConflictWarning {
  path: string;
  taskRefs: string[];
}

/**
 * Detect file paths that would be modified by multiple parallel sub-tasks.
 * Returns warnings (not errors) — conflicts may be resolvable at merge time.
 */
export function detectFileConflicts(
  tasks: SubTaskDef[],
): FileConflictWarning[] {
  const pathOwners = new Map<string, string[]>();

  for (const t of tasks) {
    for (const p of t.estimatedFilePaths ?? []) {
      const normalized = p.toLowerCase().replace(/\\/g, "/");
      const owners = pathOwners.get(normalized) ?? [];
      owners.push(t.ref);
      pathOwners.set(normalized, owners);
    }
  }

  return [...pathOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([path, owners]) => ({ path, taskRefs: owners }));
}

// ─── Merge strategy ────────────────────────────────────────────────────

export type MergeStrategy =
  | "cascade"          // Serial: A → B → C, each based on previous branch
  | "fan_in"           // Parallel: all based on main, merged back to parent
  | "cascade_fan_in";  // Mixed: serial chains + final fan-in

/**
 * Determine the merge strategy from a set of sub-tasks and their edges.
 *
 * - No edges → parallel (fan_in)
 * - All tasks in a single chain → serial (cascade)
 * - Mixed → cascade_fan_in
 */
export function inferMergeStrategy(
  tasks: SubTaskDef[],
  edges: DependencyEdge[],
): MergeStrategy {
  if (edges.length === 0) return "fan_in";

  // Build a simple graph to check if it's a single chain
  const outDegree = new Map(tasks.map((t) => [t.ref, 0]));
  const inDegMap = new Map(tasks.map((t) => [t.ref, 0]));

  for (const [from, to] of edges) {
    outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
    inDegMap.set(to, (inDegMap.get(to) ?? 0) + 1);
  }

  // Single chain: every node has at most 1 in-edge and 1 out-edge
  const isChain = tasks.every(
    (t) => (inDegMap.get(t.ref) ?? 0) <= 1 && (outDegree.get(t.ref) ?? 0) <= 1,
  );
  // Chain must have exactly one source (0 in-degree) and one sink (0 out-degree)
  const sources = tasks.filter((t) => (inDegMap.get(t.ref) ?? 0) === 0);
  const sinks = tasks.filter((t) => (outDegree.get(t.ref) ?? 0) === 0);
  const isSingleChain = isChain && sources.length === 1 && sinks.length === 1;

  if (isSingleChain) return "cascade";
  return "cascade_fan_in";
}

/**
 * Validate that a split plan is well-formed.
 * Returns an array of error messages (empty if valid).
 */
export function validateSplitPlan(
  tasks: SubTaskDef[],
  edges: DependencyEdge[],
): string[] {
  const errors: string[] = [];
  const refs = new Set(tasks.map((t) => t.ref));

  // Check for duplicate refs
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.ref)) {
      errors.push(`Duplicate sub-task ref: ${t.ref}`);
    }
    seen.add(t.ref);
  }

  // Check edges reference valid refs
  for (const [from, to] of edges) {
    if (!refs.has(from)) errors.push(`Edge references unknown ref: ${from}`);
    if (!refs.has(to)) errors.push(`Edge references unknown ref: ${to}`);
    if (from === to) errors.push(`Self-dependency detected: ${from}`);
  }

  // Check for cycles (via topological sort)
  try {
    topologicalSort(tasks, edges);
  } catch (err) {
    errors.push(
      err instanceof Error ? err.message : "Circular dependency detected",
    );
  }

  return errors;
}
