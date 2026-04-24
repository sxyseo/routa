/**
 * Effort Band — Signal computation and band mapping
 *
 * Pure functions for computing an effort score from task structural signals
 * and mapping it to an effort band (XS/S/M/L/XL).
 *
 * Weights calibrated from real routa.db data (38 tasks, 2026-04-24).
 */

import type { EffortBand, EffortBandConfig, EffortBandWeights, EffortBandThresholds } from "./effort-band-config";
import { DEFAULT_EFFORT_BAND_WEIGHTS, DEFAULT_EFFORT_BAND_THRESHOLDS } from "./effort-band-config";

// ─── Input ─────────────────────────────────────────────────────────────

export interface EffortSignalInput {
  /** Tier 1: always available */
  acceptanceCriteriaCount: number;
  verificationCommandsCount: number;
  testCasesCount: number;
  dependenciesCount: number;
  /** Tier 2: canonical story (may be absent) */
  affectedAreasCount?: number;
  surfaceCoverageCount?: number;
  hasExternalDependencies?: boolean;
  /** Tier 3: split planning (may be absent) */
  estimatedFilePathsCount?: number;
}

export interface EffortBandResult {
  band: EffortBand;
  score: number;
  signals: EffortSignalInput;
}

// ─── Score computation ─────────────────────────────────────────────────

export function computeEffortScore(
  input: EffortSignalInput,
  weights: EffortBandWeights = DEFAULT_EFFORT_BAND_WEIGHTS,
): number {
  let score = 0;

  // Tier 1: always available
  score += weights.acceptanceCriteria * input.acceptanceCriteriaCount;
  score += weights.verificationCommands * input.verificationCommandsCount;
  score += weights.testCases * input.testCasesCount;
  score += weights.dependencies * input.dependenciesCount;

  // Tier 2: canonical story
  if (input.affectedAreasCount != null) {
    score += weights.affectedAreas * input.affectedAreasCount;
  }
  if (input.surfaceCoverageCount != null) {
    score += weights.surfaceCoverage * input.surfaceCoverageCount;
  }
  if (input.hasExternalDependencies) {
    score += weights.externalDependencyBonus;
  }

  // Tier 3: file paths
  if (input.estimatedFilePathsCount != null) {
    score += weights.estimatedFilePaths * input.estimatedFilePathsCount;
  }

  return score;
}

// ─── Band mapping ──────────────────────────────────────────────────────

export function mapScoreToBand(
  score: number,
  thresholds: EffortBandThresholds = DEFAULT_EFFORT_BAND_THRESHOLDS,
): EffortBand {
  if (score <= thresholds.XS_MAX) return "XS";
  if (score <= thresholds.S_MAX) return "S";
  if (score <= thresholds.M_MAX) return "M";
  if (score <= thresholds.L_MAX) return "L";
  return "XL";
}

// ─── Convenience ───────────────────────────────────────────────────────

export function computeEffortBand(
  input: EffortSignalInput,
  config?: { weights?: Partial<EffortBandWeights>; thresholds?: Partial<EffortBandThresholds> },
): EffortBandResult {
  const weights = { ...DEFAULT_EFFORT_BAND_WEIGHTS, ...config?.weights };
  const thresholds = { ...DEFAULT_EFFORT_BAND_THRESHOLDS, ...config?.thresholds };
  const score = computeEffortScore(input, weights);
  const band = mapScoreToBand(score, thresholds);
  return { band, score, signals: input };
}

// ─── Extract signals from task ─────────────────────────────────────────

/**
 * Extract effort signal input from a Task and optional canonical story parse result.
 */
export function extractEffortSignals(task: {
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  dependencies: string[];
}, storyData?: {
  affectedAreasCount?: number;
  surfaceCoverageCount?: number;
  hasExternalDependencies?: boolean;
}): EffortSignalInput {
  return {
    acceptanceCriteriaCount: task.acceptanceCriteria?.length ?? 0,
    verificationCommandsCount: task.verificationCommands?.length ?? 0,
    testCasesCount: task.testCases?.length ?? 0,
    dependenciesCount: task.dependencies.length,
    ...storyData,
  };
}
