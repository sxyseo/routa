import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mergeSpecialistDefinitions,
  getLocaleOverlayDirs,
  loadSpecialistsFromDirectory,
  loadBundledSpecialists,
} from "../specialist-file-loader";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specialist-loader-"));
  tempDirs.push(dir);
  return dir;
}

function writeSpecialist(filePath: string, name: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `---
name: "${name}"
description: "${name} description"
role: "DEVELOPER"
---

${name} body
`,
    "utf8"
  );
}

function writeYamlSpecialist(filePath: string, id: string, name: string, prompt: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `id: "${id}"
name: "${name}"
description: "${name} description"
role: "DEVELOPER"
model_tier: "smart"
system_prompt: |
  ${prompt}
`,
    "utf8"
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("specialist-file-loader", () => {
  it("loads markdown specialists recursively while skipping locale directories in the base scan", () => {
    const rootDir = createTempDir();
    writeSpecialist(path.join(rootDir, "core", "developer.md"), "Developer");
    writeSpecialist(path.join(rootDir, "team", "qa.md"), "QA");
    writeSpecialist(path.join(rootDir, "zh-CN", "developer.md"), "开发者");
    writeSpecialist(path.join(rootDir, "locales", "zh-CN", "qa.md"), "测试");

    const loaded = loadSpecialistsFromDirectory(rootDir, "bundled");

    expect(loaded.map((entry) => entry.id).sort()).toEqual(["developer", "qa"]);
    expect(loaded.every((entry) => entry.locale === undefined)).toBe(true);
  });

  it("loads locale overlays from both new and legacy directory layouts", () => {
    const rootDir = createTempDir();
    const newLocaleDir = path.join(rootDir, "locales", "zh-CN");
    const legacyLocaleDir = path.join(rootDir, "zh-CN");
    writeSpecialist(path.join(newLocaleDir, "core", "developer.md"), "开发者");
    writeSpecialist(path.join(legacyLocaleDir, "review", "gate.md"), "验证者");

    expect(getLocaleOverlayDirs(rootDir, "zh-CN").sort()).toEqual(
      [legacyLocaleDir, newLocaleDir].sort()
    );

    const loaded = getLocaleOverlayDirs(rootDir, "zh-CN").flatMap((dirPath) =>
      loadSpecialistsFromDirectory(dirPath, "bundled", "zh-CN")
    );

    expect(loaded.map((entry) => `${entry.id}:${entry.locale}`).sort()).toEqual([
      "developer:zh-CN",
      "gate:zh-CN",
    ]);
  });

  it("uses the new locale overlay path for bundled specialist directories", () => {
    const repoRoot = createTempDir();
    const previousCwd = process.cwd();

    try {
      process.chdir(repoRoot);
      writeSpecialist(
        path.join(repoRoot, "resources", "specialists", "locales", "zh-CN", "developer.md"),
        "开发者"
      );

      const loaded = loadBundledSpecialists("zh-CN");
      expect(loaded.map((entry) => entry.id)).toEqual(["developer"]);
      expect(loaded[0]?.locale).toBe("zh-CN");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("prefers yaml runtime definitions over legacy markdown files for the same id", () => {
    const rootDir = createTempDir();
    writeSpecialist(path.join(rootDir, "developer.md"), "Developer Markdown");
    writeYamlSpecialist(path.join(rootDir, "developer.yaml"), "developer", "Developer YAML", "yaml prompt");

    const loaded = loadSpecialistsFromDirectory(rootDir, "bundled");

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.frontmatter.name).toBe("Developer YAML");
    expect(loaded[0]?.behaviorPrompt).toBe("yaml prompt");
  });

  it("warns and keeps the last specialist when duplicate ids are merged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rootDir = createTempDir();
    const first = path.join(rootDir, "legacy", "developer.md");
    const second = path.join(rootDir, "locales", "zh-CN", "developer.md");

    writeSpecialist(first, "Developer Old");
    writeSpecialist(second, "Developer New");

    const merged = mergeSpecialistDefinitions(
      [
        {
          id: "developer",
          filePath: first,
          frontmatter: { name: "Developer Old", description: "old" },
          behaviorPrompt: "old",
          rawContent: "old",
          source: "bundled",
          locale: "zh-CN",
        },
        {
          id: "developer",
          filePath: second,
          frontmatter: { name: "Developer New", description: "new" },
          behaviorPrompt: "new",
          rawContent: "new",
          source: "bundled",
          locale: "zh-CN",
        },
      ],
      "test merge"
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.frontmatter.name).toBe("Developer New");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate specialist id "developer" in test merge')
    );
    warn.mockRestore();
  });

  it("keeps bundled locale overlays in taxonomy paths and aligned with runtime specialists", () => {
    const bundledRoot = path.join(process.cwd(), "resources", "specialists");
    const runtimeIds = loadSpecialistsFromDirectory(bundledRoot, "bundled")
      .map((entry) => entry.id)
      .sort();
    const englishOverlayIds = loadSpecialistsFromDirectory(
      path.join(bundledRoot, "locales", "en"),
      "bundled",
      "en"
    )
      .map((entry) => entry.id)
      .sort();
    const chineseOverlayIds = loadSpecialistsFromDirectory(
      path.join(bundledRoot, "locales", "zh-CN"),
      "bundled",
      "zh-CN"
    )
      .map((entry) => entry.id)
      .sort();

    expect(fs.existsSync(path.join(bundledRoot, "zh-CN"))).toBe(false);
    expect(runtimeIds).toContain("view-git-change");
    expect(englishOverlayIds).toEqual(runtimeIds);
    expect(chineseOverlayIds.length).toBeGreaterThan(0);
    expect(chineseOverlayIds.every((id) => runtimeIds.includes(id))).toBe(true);
  });
});
