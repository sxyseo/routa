/**
 * Test Helper - Reusable testing utilities for Routa.js
 *
 * Provides test data builders and mock dependency injectors.
 *
 * Usage:
 * import { createTestTask, createMockDependency, asyncTestUtils } from "@/test/test-helper";
 */

import { vi, expect } from "vitest";
import { TaskStatus, TaskPriority } from "@/core/models/task";
import { KanbanColumnStage, KanbanDeliveryRules, KanbanContractRules } from "@/core/models/kanban";
import { AgentRole, AgentStatus } from "@/core/models/agent";
import { ArtifactType } from "@/core/models/artifact";

export function generateTestId(prefix = "test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface TestTaskData {
  id: string;
  title: string;
  objective: string;
  scope: string;
  status: TaskStatus;
  priority: TaskPriority;
  workspaceId: string;
  columnId: KanbanColumnStage;
  acceptanceCriteria: string[];
  verificationCommands: string[];
  testCases: string[];
  verificationPlan: string;
  dependenciesDeclared: string[];
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  storyReadiness: {
    ready: boolean;
    missing: string[];
    requiredTaskFields: string[];
    checks: {
      scope: boolean;
      acceptanceCriteria: boolean;
      verificationCommands: boolean;
      testCases: boolean;
      verificationPlan: boolean;
      dependenciesDeclared: boolean;
    };
  };
}

export interface TestTaskOptions {
  id?: string;
  title?: string;
  objective?: string;
  scope?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  workspaceId?: string;
  columnId?: KanbanColumnStage;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  verificationPlan?: string;
  dependenciesDeclared?: string[];
  assignedTo?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createTestTask(options: TestTaskOptions = {}): TestTaskData {
  const now = new Date();
  const {
    id = generateTestId("task"),
    title = "Test Task",
    objective = "Test objective for unit testing",
    scope = "Test scope defining the work boundaries",
    status = TaskStatus.PENDING,
    priority = TaskPriority.MEDIUM,
    workspaceId = "test-workspace-1",
    columnId = "backlog" as KanbanColumnStage,
    acceptanceCriteria = ["AC1: Test acceptance criteria"],
    verificationCommands = ["echo 'verified'"],
    testCases = ["Test case 1"],
    verificationPlan = "Verify by running test commands",
    dependenciesDeclared = [],
    assignedTo,
    createdAt = now,
    updatedAt = now,
  } = options;

  return {
    id,
    title,
    objective,
    scope,
    status,
    priority,
    workspaceId,
    columnId,
    acceptanceCriteria,
    verificationCommands,
    testCases,
    verificationPlan,
    dependenciesDeclared,
    assignedTo,
    createdAt,
    updatedAt,
    storyReadiness: {
      ready: true,
      missing: [],
      requiredTaskFields: [],
      checks: {
        scope: true,
        acceptanceCriteria: acceptanceCriteria.length > 0,
        verificationCommands: verificationCommands.length > 0,
        testCases: testCases.length > 0,
        verificationPlan: !!verificationPlan,
        dependenciesDeclared: true,
      },
    },
  };
}

export interface TestAgentData {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  workspaceId: string;
  parentId?: string;
  modelTier: string;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface TestAgentOptions {
  id?: string;
  name?: string;
  role?: AgentRole;
  status?: AgentStatus;
  workspaceId?: string;
  parentId?: string;
  modelTier?: string;
  createdAt?: Date;
  lastActiveAt?: Date;
}

export function createTestAgent(options: TestAgentOptions = {}): TestAgentData {
  const now = new Date();
  const {
    id = generateTestId("agent"),
    name = "Test Agent",
    role = "CRAFTER" as AgentRole,
    status = "idle" as AgentStatus,
    workspaceId = "test-workspace-1",
    parentId,
    modelTier = "SMART",
    createdAt = now,
    lastActiveAt = now,
  } = options;

  return {
    id,
    name,
    role,
    status,
    workspaceId,
    parentId,
    modelTier,
    createdAt,
    lastActiveAt,
  };
}

export interface TestKanbanColumnData {
  id: string;
  name: string;
  position: number;
  automation?: {
    enabled: boolean;
    steps: unknown[];
    autoAdvanceOnSuccess: boolean;
    deliveryRules: KanbanDeliveryRules;
    contractRules: KanbanContractRules;
    requiredArtifacts: string[];
  };
}

export interface TestKanbanColumnOptions {
  id?: string;
  name?: string;
  position?: number;
  automationEnabled?: boolean;
  deliveryRules?: KanbanDeliveryRules;
  contractRules?: KanbanContractRules;
}

export function createTestKanbanColumn(options: TestKanbanColumnOptions = {}): TestKanbanColumnData {
  const {
    id = generateTestId("column"),
    name = "Backlog",
    position = 0,
    automationEnabled = false,
    deliveryRules = {},
    contractRules = {},
  } = options;

  return {
    id,
    name,
    position,
    automation: automationEnabled
      ? {
          enabled: true,
          steps: [],
          autoAdvanceOnSuccess: false,
          deliveryRules,
          contractRules,
          requiredArtifacts: [],
        }
      : undefined,
  };
}

export interface TestArtifactData {
  id: string;
  type: ArtifactType;
  taskId: string;
  agentId: string;
  content: string;
  context: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface TestArtifactOptions {
  id?: string;
  type?: ArtifactType;
  taskId?: string;
  agentId?: string;
  content?: string;
  context?: string;
  createdAt?: Date;
}

export function createTestArtifact(options: TestArtifactOptions = {}): TestArtifactData {
  const now = new Date();
  const {
    id = generateTestId("artifact"),
    type = "screenshot" as ArtifactType,
    taskId = generateTestId("task"),
    agentId = generateTestId("agent"),
    content = "test content",
    context = "Test context",
    createdAt = now,
  } = options;

  return {
    id,
    type,
    taskId,
    agentId,
    content,
    context,
    createdAt,
    metadata: {},
  };
}

export function createMockFn<T extends (...args: never[]) => unknown>(
  implementation?: T
): ReturnType<typeof vi.fn> {
  return vi.fn(implementation);
}

export interface MockDependencyConfig<T> {
  implementation?: T;
  callThrough?: boolean;
}

export function createMockDependency<T>(config: MockDependencyConfig<T> = {}): {
  mock: T;
  reset: () => void;
  verifyCalled: (times?: number) => void;
  verifyCalledWith: (...args: never[]) => void;
} {
  const mockFn = vi.fn(config.implementation);

  return {
    mock: mockFn as unknown as T,
    reset: () => mockFn.mockClear(),
    verifyCalled: (times?: number) => {
      if (times !== undefined) {
        expect(mockFn).toHaveBeenCalledTimes(times);
      } else {
        expect(mockFn).toHaveBeenCalled();
      }
    },
    verifyCalledWith: (...args: never[]) => {
      expect(mockFn).toHaveBeenCalledWith(...args);
    },
  };
}

export async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 1000,
  intervalMs = 50
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return condition();
}

export function createFakeAsyncFn<T extends (...args: never[]) => unknown>(
  fn: T,
  delayMs = 100
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return async (...args: Parameters<T>) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fn(...args);
  };
}

export const asyncTestUtils = {
  createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  } {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return { promise, resolve: resolve!, reject: reject! };
  },

  nextTick(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  },

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

export interface TestWorkspaceData {
  id: string;
  title: string;
  branch: string;
  repoPath: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestWorkspaceOptions {
  id?: string;
  title?: string;
  branch?: string;
  repoPath?: string;
}

export function createTestWorkspace(options: TestWorkspaceOptions = {}): TestWorkspaceData {
  const {
    id = generateTestId("workspace"),
    title = "Test Workspace",
    branch = "main",
    repoPath = "/test/repo",
  } = options;

  return {
    id,
    title,
    branch,
    repoPath,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export interface TestNoteData {
  id: string;
  title: string;
  content: string;
  type: "spec" | "task" | "general";
  workspaceId: string;
  sessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestNoteOptions {
  id?: string;
  title?: string;
  content?: string;
  type?: "spec" | "task" | "general";
  workspaceId?: string;
  sessionId?: string;
}

export function createTestNote(options: TestNoteOptions = {}): TestNoteData {
  const {
    id = generateTestId("note"),
    title = "Test Note",
    content = "Test content",
    type = "general" as const,
    workspaceId = "test-workspace-1",
    sessionId,
  } = options;

  return {
    id,
    title,
    content,
    type,
    workspaceId,
    sessionId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export const snapshotUtils = {
  matchesSnapshot(actual: unknown, expected: unknown): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
  },

  snapshotKey(...parts: (string | number)[]): string {
    return parts.join(":");
  },
};

export interface TestBoardData {
  id: string;
  name: string;
  workspaceId: string;
  columns: TestKanbanColumnData[];
  createdAt: Date;
  updatedAt: Date;
}

export function createTestBoard(options: {
  id?: string;
  name?: string;
  workspaceId?: string;
  columnCount?: number;
}): TestBoardData {
  const {
    id = generateTestId("board"),
    name = "Test Board",
    workspaceId = "test-workspace-1",
    columnCount = 3,
  } = options;

  const columns = Array.from({ length: columnCount }, (_, i) =>
    createTestKanbanColumn({
      id: generateTestId("column"),
      name: ["Backlog", "In Progress", "Done"][i] || `Column ${i}`,
      position: i,
    })
  );

  return {
    id,
    name,
    workspaceId,
    columns,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}