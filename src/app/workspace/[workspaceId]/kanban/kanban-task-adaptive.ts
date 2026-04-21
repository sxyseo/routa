import type { AcpTaskAdaptiveHarnessOptions } from "@/client/acp-client";
import {
  buildKanbanTaskAdaptiveHarnessOptions as buildCoreKanbanTaskAdaptiveHarnessOptions,
} from "@/core/kanban/task-adaptive";
import type { TaskInfo } from "../types";

export function buildKanbanTaskAdaptiveHarnessOptions(
  promptLabel: string,
  options: {
    locale?: string;
    role?: string;
    taskType?: AcpTaskAdaptiveHarnessOptions["taskType"];
    task?: TaskInfo | null;
  },
): AcpTaskAdaptiveHarnessOptions {
  return buildCoreKanbanTaskAdaptiveHarnessOptions(promptLabel, options);
}
