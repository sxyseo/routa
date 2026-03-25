import { describe, expect, it, vi } from "vitest";

import type { HookMetric } from "../metrics.js";

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../process.js", async () => {
  const actual = await vi.importActual<typeof import("../process.js")>("../process.js");
  return {
    ...actual,
    runCommand: runCommandMock,
  };
});

import { runMetric } from "../fitness.js";

function buildMetric(overrides: Partial<HookMetric> = {}): HookMetric {
  return {
    command: "fake-command",
    hardGate: true,
    name: "rust_test_pass",
    pattern: "test result: ok",
    sourceFile: "docs/fitness/unit-test.md",
    ...overrides,
  };
}

describe("runMetric", () => {
  it("fails when the command exits non-zero even if the pattern appears in output", async () => {
    runCommandMock.mockResolvedValueOnce({
      command: "fake-command",
      durationMs: 10,
      exitCode: 1,
      output: "test result: ok\nerror: later failure",
    });

    const result = await runMetric(buildMetric());

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("passes only when the command exits zero and the pattern matches", async () => {
    runCommandMock.mockResolvedValueOnce({
      command: "fake-command",
      durationMs: 10,
      exitCode: 0,
      output: "test result: ok",
    });

    const result = await runMetric(buildMetric());

    expect(result.passed).toBe(true);
  });
});
