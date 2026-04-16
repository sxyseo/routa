import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const system = {
  codebaseStore: {
    get: vi.fn(),
    listByWorkspace: vi.fn(),
  },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET } from "../route";

async function createTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "routa-spec-surface-index-"));
  await mkdir(path.join(repoRoot, "docs", "product-specs"), { recursive: true });
  return repoRoot;
}

describe("/api/spec/surface-index route", () => {
  it("reads the generated machine-readable surface index", async () => {
    const repoRoot = await createTempRepo();

    try {
      await writeFile(
        path.join(repoRoot, "docs", "product-specs", "feature-tree.index.json"),
        JSON.stringify({
          generatedAt: "2026-04-16T12:00:00.000Z",
          pages: [
            {
              route: "/workspace/:workspaceId/spec",
              title: "Workspace / Spec",
              description: "Dense issue relationship board",
              sourceFile: "src/app/workspace/[workspaceId]/spec/page.tsx",
            },
          ],
          apis: [
            {
              domain: "spec",
              method: "GET",
              path: "/api/spec/issues",
              operationId: "listSpecIssues",
              summary: "List local issue specs",
            },
          ],
        }),
      );

      const response = await GET(new NextRequest(
        `http://localhost/api/spec/surface-index?repoPath=${encodeURIComponent(repoRoot)}`,
      ));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.repoRoot).toBe(repoRoot);
      expect(payload.warnings).toEqual([]);
      expect(payload.pages).toHaveLength(1);
      expect(payload.apis).toHaveLength(1);
      expect(payload.pages[0]).toMatchObject({
        route: "/workspace/:workspaceId/spec",
        title: "Workspace / Spec",
      });
      expect(payload.apis[0]).toMatchObject({
        domain: "spec",
        path: "/api/spec/issues",
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns an empty index with warnings when the generated file is missing", async () => {
    const repoRoot = await createTempRepo();

    try {
      const response = await GET(new NextRequest(
        `http://localhost/api/spec/surface-index?repoPath=${encodeURIComponent(repoRoot)}`,
      ));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.pages).toEqual([]);
      expect(payload.apis).toEqual([]);
      expect(payload.warnings[0]).toContain("Feature surface index not found");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
