import { describe, it, expect } from "vitest";
import {
  computeEffortScore,
  mapScoreToBand,
  computeEffortBand,
  extractEffortSignals,
  type EffortSignalInput,
} from "../effort-band";
import {
  getEffortBandConfig,
  setEffortBandConfig,
  getDefaultEffortBandConfig,
  DEFAULT_EFFORT_BAND_WEIGHTS,
  DEFAULT_EFFORT_BAND_THRESHOLDS,
  type EffortBandWeights,
  type EffortBandThresholds,
} from "../effort-band-config";

// ─── computeEffortScore ────────────────────────────────────────────────

describe("computeEffortScore", () => {
  it("returns 0 for all-zero inputs", () => {
    const input: EffortSignalInput = {
      acceptanceCriteriaCount: 0,
      verificationCommandsCount: 0,
      testCasesCount: 0,
      dependenciesCount: 0,
    };
    expect(computeEffortScore(input)).toBe(0);
  });

  it("uses Tier 1 signals only when Tier 2/3 are absent", () => {
    const input: EffortSignalInput = {
      acceptanceCriteriaCount: 2,
      verificationCommandsCount: 1,
      testCasesCount: 1,
      dependenciesCount: 0,
    };
    const score = computeEffortScore(input);
    // 2*0.6 + 1*0.8 + 1*0.5 + 0*1.0 = 2.5
    expect(score).toBeCloseTo(2.5);
  });

  it("adds Tier 2 canonical story signals when present", () => {
    const input: EffortSignalInput = {
      acceptanceCriteriaCount: 2,
      verificationCommandsCount: 1,
      testCasesCount: 1,
      dependenciesCount: 0,
      affectedAreasCount: 3,
      surfaceCoverageCount: 2,
      hasExternalDependencies: true,
    };
    const score = computeEffortScore(input);
    // Tier1: 2.5 + Tier2: 3*2.0 + 2*1.5 + 2.0 = 2.5 + 6.0 + 3.0 + 2.0 = 13.5
    expect(score).toBeCloseTo(13.5);
  });

  it("adds Tier 3 file path signal when present", () => {
    const base: EffortSignalInput = {
      acceptanceCriteriaCount: 1,
      verificationCommandsCount: 0,
      testCasesCount: 0,
      dependenciesCount: 0,
    };
    const withFiles: EffortSignalInput = { ...base, estimatedFilePathsCount: 10 };
    const diff = computeEffortScore(withFiles) - computeEffortScore(base);
    expect(diff).toBeCloseTo(10 * 0.3);
  });

  it("computes a realistic task: simple API endpoint", () => {
    const input: EffortSignalInput = {
      acceptanceCriteriaCount: 2,
      verificationCommandsCount: 1,
      testCasesCount: 1,
      dependenciesCount: 0,
    };
    const score = computeEffortScore(input);
    expect(score).toBeCloseTo(2.5); // S band
  });

  it("computes a realistic task: cross-module feature", () => {
    const input: EffortSignalInput = {
      acceptanceCriteriaCount: 5,
      verificationCommandsCount: 2,
      testCasesCount: 5,
      dependenciesCount: 0,
      affectedAreasCount: 3,
      surfaceCoverageCount: 3,
      hasExternalDependencies: false,
    };
    const score = computeEffortScore(input);
    // 5*0.6 + 2*0.8 + 5*0.5 + 3*2.0 + 3*1.5 = 3.0 + 1.6 + 2.5 + 6.0 + 4.5 = 17.6
    expect(score).toBeCloseTo(17.6); // XL band
  });
});

// ─── mapScoreToBand ────────────────────────────────────────────────────

describe("mapScoreToBand", () => {
  it("maps 0 to XS", () => {
    expect(mapScoreToBand(0)).toBe("XS");
  });

  it("maps boundary values correctly", () => {
    expect(mapScoreToBand(0.1)).toBe("XS");
    expect(mapScoreToBand(2.0)).toBe("XS");
    expect(mapScoreToBand(2.01)).toBe("S");
    expect(mapScoreToBand(5.0)).toBe("S");
    expect(mapScoreToBand(5.01)).toBe("M");
    expect(mapScoreToBand(8.0)).toBe("M");
    expect(mapScoreToBand(8.01)).toBe("L");
    expect(mapScoreToBand(12.0)).toBe("L");
    expect(mapScoreToBand(12.01)).toBe("XL");
    expect(mapScoreToBand(100)).toBe("XL");
  });

  it("respects custom thresholds", () => {
    const custom = { XS_MAX: 1, S_MAX: 3, M_MAX: 5, L_MAX: 7 };
    expect(mapScoreToBand(1, custom)).toBe("XS");
    expect(mapScoreToBand(2, custom)).toBe("S");
    expect(mapScoreToBand(4, custom)).toBe("M");
    expect(mapScoreToBand(6, custom)).toBe("L");
    expect(mapScoreToBand(8, custom)).toBe("XL");
  });
});

// ─── computeEffortBand ─────────────────────────────────────────────────

describe("computeEffortBand", () => {
  it("returns band, score, and signals", () => {
    const input: EffortSignalInput = {
      acceptanceCriteriaCount: 1,
      verificationCommandsCount: 0,
      testCasesCount: 0,
      dependenciesCount: 0,
    };
    const result = computeEffortBand(input);
    expect(result.band).toBe("XS");
    expect(result.score).toBeCloseTo(0.6);
    expect(result.signals).toBe(input);
  });

  it("accepts custom config overrides", () => {
    const input: EffortSignalInput = {
      acceptanceCriteriaCount: 1,
      verificationCommandsCount: 0,
      testCasesCount: 0,
      dependenciesCount: 0,
    };
    const result = computeEffortBand(input, {
      weights: { acceptanceCriteria: 5.0 } as Partial<EffortBandWeights>,
    });
    expect(result.score).toBeCloseTo(5.0);
    expect(result.band).toBe("S");
  });
});

// ─── extractEffortSignals ──────────────────────────────────────────────

describe("extractEffortSignals", () => {
  it("extracts counts from task fields", () => {
    const task = {
      acceptanceCriteria: ["a", "b", "c"],
      verificationCommands: ["v1"],
      testCases: ["t1", "t2"],
      dependencies: ["dep1"],
    };
    const signals = extractEffortSignals(task);
    expect(signals.acceptanceCriteriaCount).toBe(3);
    expect(signals.verificationCommandsCount).toBe(1);
    expect(signals.testCasesCount).toBe(2);
    expect(signals.dependenciesCount).toBe(1);
  });

  it("handles undefined optional fields", () => {
    const task = {
      acceptanceCriteria: undefined,
      verificationCommands: undefined,
      testCases: undefined,
      dependencies: [],
    };
    const signals = extractEffortSignals(task);
    expect(signals.acceptanceCriteriaCount).toBe(0);
    expect(signals.verificationCommandsCount).toBe(0);
    expect(signals.testCasesCount).toBe(0);
  });

  it("merges story signals when provided", () => {
    const task = {
      acceptanceCriteria: ["a"],
      verificationCommands: [],
      testCases: [],
      dependencies: [],
    };
    const signals = extractEffortSignals(task, {
      affectedAreasCount: 3,
      surfaceCoverageCount: 2,
      hasExternalDependencies: true,
    });
    expect(signals.affectedAreasCount).toBe(3);
    expect(signals.surfaceCoverageCount).toBe(2);
    expect(signals.hasExternalDependencies).toBe(true);
  });
});

// ─── EffortBandConfig get/set ──────────────────────────────────────────

describe("EffortBandConfig", () => {
  it("returns defaults when no metadata", () => {
    const config = getEffortBandConfig(undefined, "board-1");
    expect(config.weights.acceptanceCriteria).toBe(0.6);
    expect(config.thresholds.XS_MAX).toBe(2.0);
  });

  it("returns defaults when board not found", () => {
    const config = getEffortBandConfig({ otherKey: "val" }, "board-1");
    expect(config.weights.acceptanceCriteria).toBe(0.6);
  });

  it("round-trips through set/get", () => {
    const metadata = setEffortBandConfig({}, "board-1", {
      weights: { acceptanceCriteria: 1.2 } as Partial<EffortBandWeights>,
      thresholds: { S_MAX: 8.0 } as Partial<EffortBandThresholds>,
    });
    const config = getEffortBandConfig(metadata, "board-1");
    expect(config.weights.acceptanceCriteria).toBe(1.2);
    expect(config.thresholds.S_MAX).toBe(8.0);
    // Other fields remain default
    expect(config.weights.verificationCommands).toBe(DEFAULT_EFFORT_BAND_WEIGHTS.verificationCommands);
    expect(config.thresholds.XS_MAX).toBe(DEFAULT_EFFORT_BAND_THRESHOLDS.XS_MAX);
  });

  it("preserves existing metadata keys", () => {
    const existing = { otherConfig: "preserve-me" };
    const updated = setEffortBandConfig(existing, "board-1", {
      weights: { dependencies: 2.0 } as Partial<EffortBandWeights>,
    });
    expect(updated.otherConfig).toBe("preserve-me");
    expect(updated["effortBandConfig:board-1"]).toBeDefined();
  });

  it("getDefaultEffortBandConfig returns independent copy", () => {
    const a = getDefaultEffortBandConfig();
    const b = getDefaultEffortBandConfig();
    a.weights.acceptanceCriteria = 99;
    expect(b.weights.acceptanceCriteria).toBe(0.6);
  });

  it("handles corrupted JSON gracefully", () => {
    const metadata = { "effortBandConfig:board-1": "{invalid json" };
    const config = getEffortBandConfig(metadata, "board-1");
    expect(config.weights.acceptanceCriteria).toBe(0.6);
  });
});
