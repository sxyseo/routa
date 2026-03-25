import { describe, expect, it } from "vitest";

import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { runSubmoduleRefsCheck } from "../check-submodule-refs.js";

function writeFakeGit(binDir: string, mode: "pass" | "fetch-fail"): { restore: () => void } {
  const originalPath = process.env.PATH ?? "";
  const counterPath = path.join(binDir, "git-call-count");
  const fakeGit = path.join(binDir, "git");
  const script = `#!/bin/sh
set -eu
counter_file="${counterPath}"
count=$(cat "${counterPath}" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "${counterPath}"

if [ "$count" -eq 1 ]; then
  echo "submodule.entrix.path tools/entrix"
  exit 0
fi

if [ "$count" -eq 2 ]; then
  echo "https://github.com/phodal/entrix.git"
  exit 0
fi

if [ "$count" -eq 3 ]; then
  echo "160000 commit12345 tools/entrix"
  exit 0
fi

if [ "$count" -eq 4 ]; then
  echo "Initialized empty Git repository in /tmp/routa-submodule-test"
  exit 0
fi

if [ "$count" -eq 5 ]; then
  if [ "${mode}" = "fetch-fail" ]; then
    echo "fatal: repository not found" >&2
    exit 128
  fi
  echo "From https://github.com/phodal/entrix.git"
  exit 0
fi

exit 0
`;
  writeFileSync(fakeGit, `${script}\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${originalPath}`;
  return {
    restore: () => {
      process.env.PATH = originalPath;
      rmSync(fakeGit);
      rmSync(counterPath, { force: true });
    },
  };
}

async function withSubmoduleRepo<T>(mode: "pass" | "fetch-fail", run: (repoRoot: string) => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH ?? "";
  const repoRoot = mkdtempSync(path.join(tmpdir(), "routa-submodule-"));
  const fakeBinDir = mkdtempSync(path.join(tmpdir(), "routa-submodule-bin-"));
  process.chdir(repoRoot);

  const { restore } = writeFakeGit(fakeBinDir, mode);

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

describe("runSubmoduleRefsCheck", () => {
  it("passes when .gitmodules is absent", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "routa-submodule-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(repoRoot);
      const passed = await runSubmoduleRefsCheck();
      expect(passed).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("passes when submodule refs are reachable", async () => {
    const result = await withSubmoduleRepo("pass", async (repoRoot) => {
      writeFileSync(
        path.join(repoRoot, ".gitmodules"),
        [
          "[submodule \"entrix\"]",
          "\tpath = tools/entrix",
          "\turl = https://github.com/phodal/entrix.git",
        "",
        ].join("\n"),
      );
      return runSubmoduleRefsCheck();
    });

    expect(result).toBe(true);
  });

  it("fails when submodule refs are not reachable", async () => {
    const result = await withSubmoduleRepo("fetch-fail", async (repoRoot) => {
      writeFileSync(
        path.join(repoRoot, ".gitmodules"),
        [
          "[submodule \"entrix\"]",
          "\tpath = tools/entrix",
          "\turl = https://github.com/phodal/entrix.git",
          "",
        ].join("\n"),
      );
      return runSubmoduleRefsCheck();
    });

    expect(result).toBe(false);
  });
});
