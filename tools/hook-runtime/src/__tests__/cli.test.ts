import { afterEach, describe, expect, it, vi } from "vitest";

import { formatReviewPhaseLabel, handleCliError } from "../cli.js";

describe("handleCliError", () => {
  const originalOutputMode = process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;

  afterEach(() => {
    process.exitCode = undefined;
    if (originalOutputMode === undefined) {
      delete process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;
    } else {
      process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE = originalOutputMode;
    }
    vi.restoreAllMocks();
  });

  it("sets a non-zero exit code in human mode", () => {
    delete process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCliError(new Error("Review-trigger matched in a non-interactive push."), []);

    expect(stderr).toHaveBeenCalledWith("Review-trigger matched in a non-interactive push.");
    expect(process.exitCode).toBe(1);
  });

  it("sets a non-zero exit code in jsonl mode without writing to stderr", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCliError(new Error("blocked"), ["--jsonl"]);

    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("formatReviewPhaseLabel", () => {
  it("describes unavailable review state without flattening it to blocked", () => {
    expect(
      formatReviewPhaseLabel({
        allowed: false,
        base: "origin/main",
        bypassed: false,
        message: "review unavailable",
        status: "unavailable",
        triggers: [],
      }),
    ).toBe("unavailable");
  });

  it("marks bypassed unavailable review state explicitly", () => {
    expect(
      formatReviewPhaseLabel({
        allowed: true,
        base: "origin/main",
        bypassed: true,
        message: "review unavailable but bypassed",
        status: "unavailable",
        triggers: [],
      }),
    ).toBe("unavailable (bypassed)");
  });
});
