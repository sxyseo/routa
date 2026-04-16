import { describe, expect, it } from "vitest";

import { buildFeatureSurfaceIndex, buildFeatureTree, parsePageComment, renderMarkdown } from "../docs/feature-tree-generator";

describe("feature-tree-generator", () => {
  it("extracts title and condensed description from page comments", () => {
    const parsed = parsePageComment(`/**
 * Workspace / Kanban - /workspace/default/kanban
 * Shows the board.
 * Supports drag and drop.
 */`);

    expect(parsed.title).toBe("Workspace / Kanban");
    expect(parsed.description).toBe("Shows the board. Supports drag and drop.");
  });

  it("renders markdown with the TypeScript regeneration command", () => {
    const tree = buildFeatureTree(
      [{ route: "/", title: "Home", description: "", sourceFile: "src/app/page.tsx" }],
      { agents: [{ domain: "agents", path: "/api/agents", method: "GET", operationId: "listAgents", summary: "List agents" }] },
    );

    const markdown = renderMarkdown(tree);
    expect(markdown).toContain("node --import tsx scripts/docs/feature-tree-generator.ts --save");
    expect(markdown).toContain("| Home | `/` |  |");
    expect(markdown).toContain("| GET | `/api/agents` | List agents |");
  });

  it("builds a machine-readable surface index for runtime consumers", () => {
    const index = buildFeatureSurfaceIndex(
      [{ route: "/workspace/:workspaceId/spec", title: "Workspace / Spec", description: "Issue board", sourceFile: "src/app/workspace/[workspaceId]/spec/page.tsx" }],
      {
        spec: [
          {
            domain: "spec",
            path: "/api/spec/issues",
            method: "GET",
            operationId: "listSpecIssues",
            summary: "List local issue specs",
          },
        ],
      },
    );

    expect(index.pages).toEqual([
      {
        route: "/workspace/:workspaceId/spec",
        title: "Workspace / Spec",
        description: "Issue board",
        sourceFile: "src/app/workspace/[workspaceId]/spec/page.tsx",
      },
    ]);
    expect(index.apis[0]).toMatchObject({
      domain: "spec",
      path: "/api/spec/issues",
      method: "GET",
      operationId: "listSpecIssues",
    });
    expect(index.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });
});
