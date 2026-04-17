import { describe, expect, it } from "vitest";

import {
  buildFeatureSurfaceIndex,
  buildFeatureTree,
  normalizeFeatureMetadata,
  parsePageComment,
  readFeatureMetadataFromFeatureTree,
  renderMarkdown,
} from "../docs/feature-tree-generator";

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
    const metadata = normalizeFeatureMetadata({
      schemaVersion: 1,
      capabilityGroups: [{ id: "agent-execution", name: "Agent Execution" }],
      features: [{ id: "session-recovery", name: "Session Recovery", group: "agent-execution", pages: ["/"] }],
    });

    const markdown = renderMarkdown(tree, metadata);
    expect(markdown).toContain("node --import tsx scripts/docs/feature-tree-generator.ts --save");
    expect(markdown).toContain("| Home | `/` |  |");
    expect(markdown).toContain("| GET | `/api/agents` | List agents |");
    expect(markdown).toContain("feature_metadata:");
    expect(markdown).toContain("schema_version: 1");
    expect(markdown).toContain("Hand-edit only `feature_metadata` in this frontmatter block.");
    expect(markdown).toContain("Feature metadata: `feature_metadata` frontmatter in this file");
  });

  it("builds a machine-readable surface index for runtime consumers", () => {
    const metadata = normalizeFeatureMetadata({
      schemaVersion: 1,
      capabilityGroups: [{ id: "workspace-coordination", name: "Workspace Coordination" }],
      features: [{ id: "workspace-overview", name: "Workspace Overview", group: "workspace-coordination" }],
    });
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
      metadata,
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
    expect(index.metadata).toEqual(metadata);
    expect(index.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it("normalizes feature metadata into a stable shape", () => {
    const metadata = normalizeFeatureMetadata({
      schemaVersion: 2,
      capabilityGroups: [
        {
          id: "kanban-automation",
          name: "Kanban Automation",
          description: "Task flow",
        },
      ],
      features: [
        {
          id: "kanban-workflow",
          name: "Kanban Workflow",
          group: "kanban-automation",
          pages: ["/workspace/:workspaceId/kanban", "  "],
          apis: ["GET /api/kanban/boards"],
          domainObjects: ["task", "workflow"],
        },
      ],
    });

    expect(metadata).toEqual({
      schemaVersion: 2,
      capabilityGroups: [
        {
          id: "kanban-automation",
          name: "Kanban Automation",
          description: "Task flow",
        },
      ],
      features: [
        {
          id: "kanban-workflow",
          name: "Kanban Workflow",
          group: "kanban-automation",
          pages: ["/workspace/:workspaceId/kanban"],
          apis: ["GET /api/kanban/boards"],
          domainObjects: ["task", "workflow"],
        },
      ],
    });
  });

  it("reads feature metadata from FEATURE_TREE frontmatter", () => {
    const metadata = readFeatureMetadataFromFeatureTree(`---
status: generated
feature_metadata:
  schema_version: 1
  capability_groups:
    - id: agent-execution
      name: Agent Execution
  features:
    - id: session-recovery
      name: Session Recovery
      group: agent-execution
      domain_objects:
        - session
---

# Title
`);

    expect(metadata).toEqual({
      schemaVersion: 1,
      capabilityGroups: [{ id: "agent-execution", name: "Agent Execution" }],
      features: [
        {
          id: "session-recovery",
          name: "Session Recovery",
          group: "agent-execution",
          domainObjects: ["session"],
        },
      ],
    });
  });
});
