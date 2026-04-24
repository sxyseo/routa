/**
 * Effort Band Configuration
 *
 * Stores weight and threshold configuration per board using the same
 * boardMetadata pattern as KanbanDevSessionSupervision.
 *
 * Different boards can have different weights (e.g. frontend vs backend
 * projects have different complexity profiles).
 */

// ─── Types ─────────────────────────────────────────────────────────────

export type EffortBand = "XS" | "S" | "M" | "L" | "XL";

export interface EffortBandWeights {
  /** Acceptance criteria count (weakest predictor from real data) */
  acceptanceCriteria: number;
  /** Verification commands count */
  verificationCommands: number;
  /** Test cases count */
  testCases: number;
  /** Task dependency count */
  dependencies: number;
  /** Affected areas from canonical story (strongest predictor) */
  affectedAreas: number;
  /** Surface coverage "covered" count from canonical story */
  surfaceCoverage: number;
  /** Fixed bonus when task has external dependencies */
  externalDependencyBonus: number;
  /** Estimated file paths count (split planning only) */
  estimatedFilePaths: number;
}

export interface EffortBandThresholds {
  XS_MAX: number;
  S_MAX: number;
  M_MAX: number;
  L_MAX: number;
}

export interface EffortBandConfig {
  weights: EffortBandWeights;
  thresholds: EffortBandThresholds;
}

// ─── Defaults (calibrated from routa.db real data, 2026-04-24) ─────────

export const DEFAULT_EFFORT_BAND_WEIGHTS: EffortBandWeights = {
  acceptanceCriteria: 0.6,
  verificationCommands: 0.8,
  testCases: 0.5,
  dependencies: 1.0,
  affectedAreas: 2.0,
  surfaceCoverage: 1.5,
  externalDependencyBonus: 2.0,
  estimatedFilePaths: 0.3,
};

export const DEFAULT_EFFORT_BAND_THRESHOLDS: EffortBandThresholds = {
  XS_MAX: 2.0,
  S_MAX: 5.0,
  M_MAX: 8.0,
  L_MAX: 12.0,
};

export const DEFAULT_EFFORT_BAND_CONFIG: EffortBandConfig = {
  weights: { ...DEFAULT_EFFORT_BAND_WEIGHTS },
  thresholds: { ...DEFAULT_EFFORT_BAND_THRESHOLDS },
};

// ─── Metadata key ──────────────────────────────────────────────────────

function metadataKey(boardId: string): string {
  return `effortBandConfig:${boardId}`;
}

// ─── Get / Set ─────────────────────────────────────────────────────────

export function getEffortBandConfig(
  metadata: Record<string, string> | undefined,
  boardId: string,
): EffortBandConfig {
  const raw = metadata?.[metadataKey(boardId)];
  if (!raw) return structuredClone(DEFAULT_EFFORT_BAND_CONFIG);
  try {
    const parsed = JSON.parse(raw) as Partial<EffortBandConfig>;
    return {
      weights: { ...DEFAULT_EFFORT_BAND_WEIGHTS, ...parsed.weights },
      thresholds: { ...DEFAULT_EFFORT_BAND_THRESHOLDS, ...parsed.thresholds },
    };
  } catch {
    return structuredClone(DEFAULT_EFFORT_BAND_CONFIG);
  }
}

export function setEffortBandConfig(
  metadata: Record<string, string> | undefined,
  boardId: string,
  config: { weights?: Partial<EffortBandWeights>; thresholds?: Partial<EffortBandThresholds> },
): Record<string, string> {
  const normalized: EffortBandConfig = {
    weights: { ...DEFAULT_EFFORT_BAND_WEIGHTS, ...config.weights },
    thresholds: { ...DEFAULT_EFFORT_BAND_THRESHOLDS, ...config.thresholds },
  };
  return {
    ...(metadata ?? {}),
    [metadataKey(boardId)]: JSON.stringify(normalized),
  };
}

export function getDefaultEffortBandConfig(): EffortBandConfig {
  return structuredClone(DEFAULT_EFFORT_BAND_CONFIG);
}
