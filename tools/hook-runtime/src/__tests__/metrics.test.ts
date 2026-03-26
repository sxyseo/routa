import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadHookMetrics", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    vi.resetModules();
  });

  it("returns a clear message when fitness manifest is missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "hook-metric-missing-"));
    process.chdir(tempDir);
    vi.resetModules();

    const { loadHookMetrics } = await import("../metrics.js");

    await expect(loadHookMetrics(["eslint_pass"])).rejects.toThrow(
      'Cannot find fitness manifest at "docs/fitness/manifest.yaml"',
    );

    await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps explicit metric-not-found messaging", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "hook-metric-missing-metric-"));
    const docsDir = path.join(tempDir, "docs", "fitness");
    await mkdir(docsDir, { recursive: true });
    await writeFile(path.join(docsDir, "manifest.yaml"), "evidence_files:\n  - docs/fitness/sample.md\n", "utf-8");
    await writeFile(path.join(docsDir, "sample.md"), "---\nmetrics:\n  - name: existing_metric\n    command: echo ok\n    hard_gate: true\n---\nplaceholder\n", "utf-8");

    process.chdir(tempDir);
    vi.resetModules();
    const { loadHookMetrics } = await import("../metrics.js");

    await expect(loadHookMetrics(["missing_metric"])).rejects.toThrow(
      'Unable to find fitness metric "missing_metric" in docs/fitness manifest files.',
    );

    await rm(tempDir, { recursive: true, force: true });
  });
});
