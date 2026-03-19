import {
  getKanbanAutomationSteps,
  type KanbanAutomationStep,
  type KanbanColumnAutomation,
} from "../models/kanban";

export interface AutomationSpecialistSummary {
  name?: string;
  role?: string;
  defaultProvider?: string;
}

export type AutomationSpecialistResolver = (
  specialistId: string,
  locale?: string,
) => AutomationSpecialistSummary | undefined;

type TaskAutomationFields = {
  columnId?: string;
  assignedProvider?: string;
  assignedRole?: string;
  assignedSpecialistId?: string;
  assignedSpecialistName?: string;
};

type ColumnAutomationFields = {
  id: string;
  automation?: KanbanColumnAutomation;
};

export interface EffectiveTaskAutomation {
  canRun: boolean;
  source: "card" | "lane" | "none";
  laneAutomation?: KanbanColumnAutomation;
  steps: KanbanAutomationStep[];
  stepIndex?: number;
  step?: KanbanAutomationStep;
  providerId?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
}

export function resolveKanbanAutomationStep(
  step: KanbanAutomationStep | undefined,
  resolveSpecialist?: AutomationSpecialistResolver,
): KanbanAutomationStep | undefined {
  if (!step) return undefined;
  const specialist = step.specialistId
    ? resolveSpecialist?.(step.specialistId, step.specialistLocale)
    : undefined;

  return {
    ...step,
    providerId: step.providerId ?? specialist?.defaultProvider,
    role: step.role ?? specialist?.role,
    specialistName: step.specialistName ?? specialist?.name,
  };
}

export function resolveEffectiveTaskAutomation(
  task: TaskAutomationFields,
  boardColumns: ColumnAutomationFields[] = [],
  resolveSpecialist?: AutomationSpecialistResolver,
): EffectiveTaskAutomation {
  const currentColumnId = task.columnId ?? "backlog";
  const laneAutomation = boardColumns.find((column) => column.id === currentColumnId)?.automation;
  const enabledLaneAutomation = laneAutomation?.enabled ? laneAutomation : undefined;
  const hasCardOverride = Boolean(
    task.assignedProvider
      || task.assignedRole
      || task.assignedSpecialistId
      || task.assignedSpecialistName,
  );
  const canRun = hasCardOverride || Boolean(enabledLaneAutomation);
  const rawSteps = hasCardOverride
    ? [{
      id: "card-override",
      providerId: task.assignedProvider,
      role: task.assignedRole,
      specialistId: task.assignedSpecialistId,
      specialistName: task.assignedSpecialistName,
    }]
    : getKanbanAutomationSteps(enabledLaneAutomation);
  const steps = rawSteps
    .map((step) => resolveKanbanAutomationStep(step, resolveSpecialist))
    .filter((step): step is KanbanAutomationStep => Boolean(step));
  const step = steps[0];

  return {
    canRun,
    source: hasCardOverride ? "card" : enabledLaneAutomation ? "lane" : "none",
    laneAutomation: enabledLaneAutomation,
    steps,
    stepIndex: step ? 0 : undefined,
    step,
    providerId: task.assignedProvider ?? step?.providerId,
    role: task.assignedRole ?? step?.role ?? (canRun ? "DEVELOPER" : undefined),
    specialistId: task.assignedSpecialistId ?? step?.specialistId,
    specialistName: task.assignedSpecialistName ?? step?.specialistName,
  };
}
