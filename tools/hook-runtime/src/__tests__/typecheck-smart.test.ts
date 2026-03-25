import { describe, expect, it } from "vitest";

import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { runTypecheckSmart } from "../typecheck-smart.js";

function writeFakeNpx(binDir: string, mode: "pass" | "stale" | "fail"): { restore: () => void } {
  const originalPath = process.env.PATH ?? "";
  const counterPath = path.join(binDir, "npx-call-count");
  const fakeNpx = path.join(binDir, "npx");
  const script = `#!/bin/sh
set -eu
count_file="${counterPath}"
count=$(cat "${counterPath}" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "${counterPath}"

if [ "$count" -eq 1 ]; then
  if [ "${mode}" = "stale" ]; then
    echo ".next/types/src/app/page.js: Cannot find module './src/app/page.js' or its corresponding type declarations." >&2
    exit 1
  fi
  if [ "${mode}" = "fail" ]; then
    echo "Type error: Something else" >&2
    exit 1
  fi
fi

exit 0
`;
  writeFileSync(fakeNpx, `${script}\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${originalPath}`;
  return {
    restore: () => {
      process.env.PATH = originalPath;
      rmSync(fakeNpx);
      rmSync(counterPath, { force: true });
    },
  };
}

function withTypecheckRepo<T>(mode: "pass" | "stale" | "fail", run: (repoRoot: string) => T): T {
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH ?? "";
  const repoRoot = mkdtempSync(path.join(tmpdir(), "routa-typecheck-"));
  const fakeBinDir = mkdtempSync(path.join(tmpdir(), "routa-typecheck-bin-"));

  process.chdir(repoRoot);
  const { restore } = writeFakeNpx(fakeBinDir, mode);

  try {
    return run(repoRoot);
  } finally {
    restore();
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
}

describe("runTypecheckSmart", () => {
  it("returns success when tsc passes on first run", () => {
    const result = withTypecheckRepo("pass", () => runTypecheckSmart());

    expect(result).toBe(0);
  });

  it("retries and succeeds after stale .next/types detection", () => {
    let repoRoot = "";
    const result = withTypecheckRepo("stale", (root) => {
      repoRoot = root;
      const nextDir = path.join(root, ".next", "types");
      mkdirSync(nextDir, { recursive: true });
      writeFileSync(path.join(nextDir, ".keep"), "");
      return runTypecheckSmart();
    });

    expect(result).toBe(0);
    expect(existsSync(path.join(repoRoot, ".next"))).toBe(false);
  });

  it("returns failure for non-stale typecheck errors", () => {
    const result = withTypecheckRepo("fail", () => runTypecheckSmart());

    expect(result).toBe(1);
  });
});
