import { describe, expect, it } from "vitest";

import { buildFeatureTree, parsePageComment, renderMarkdown } from "../docs/feature-tree-generator";

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
      [{ route: "/", title: "Home", description: "" }],
      { agents: [{ path: "/api/agents", method: "GET", operationId: "listAgents", summary: "List agents" }] },
    );

    const markdown = renderMarkdown(tree);
    expect(markdown).toContain("node --import tsx scripts/docs/feature-tree-generator.ts --save");
    expect(markdown).toContain("| Home | `/` |  |");
    expect(markdown).toContain("| GET | `/api/agents` | List agents |");
  });
});
