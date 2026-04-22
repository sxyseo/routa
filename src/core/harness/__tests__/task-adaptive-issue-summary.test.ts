/**
 * @vitest-environment node
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildTaskAdaptiveIssueSummary,
  formatTaskAdaptiveIssueSummaryMarkdown,
  TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER,
} from "../task-adaptive-issue-summary";

function ensureFile(filePath: string, content = ""): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeTranscript(
  filePath: string,
  cwd: string,
  sessionId: string,
  events: unknown[],
): void {
  ensureFile(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-04-22T01:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2026-04-22T01:00:00.000Z",
          cwd,
          source: "cli",
          model_provider: "openai",
        },
      }),
      ...events.map((event) => JSON.stringify(event)),
      "",
    ].join("\n"),
  );
}

function writeFeatureTreeIndex(
  repoRoot: string,
  features: Array<{
    id: string;
    name: string;
    sourceFiles: string[];
  }>,
): void {
  ensureFile(
    path.join(repoRoot, "docs/product-specs/feature-tree.index.json"),
    JSON.stringify({
      metadata: {
        features: features.map((feature) => ({
          id: feature.id,
          name: feature.name,
          group: "test",
          summary: `${feature.name} summary`,
          status: "active",
          pages: [],
          apis: [],
          sourceFiles: feature.sourceFiles,
          relatedFeatures: [],
          domainObjects: [],
        })),
      },
    }, null, 2),
  );
}

describe("task-adaptive-issue-summary", () => {
  const originalHome = process.env.HOME;
  const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  });

  it("builds a sanitized hotspot summary from reusable friction profiles", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-issue-summary-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    const focusFile = "src/app/feature-explorer/page.tsx";
    ensureFile(path.join(repoRoot, focusFile), "export default function Page() { return null; }\n");
    writeFeatureTreeIndex(repoRoot, [
      {
        id: "feature-explorer",
        name: "Feature Explorer",
        sourceFiles: [focusFile],
      },
    ]);

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-a.jsonl"),
      repoRoot,
      "session-a",
      [
        {
          timestamp: "2026-04-22T01:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Investigate feature explorer churn",
          },
        },
        {
          timestamp: "2026-04-22T01:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "pnpm vitest run src/app/feature-explorer/page.tsx"],
            stderr: "zsh:1: command not found: pnpm",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          timestamp: "2026-04-22T01:03:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: ` M ${focusFile}\n`,
            exit_code: 0,
          },
        },
      ],
    );

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-b.jsonl"),
      repoRoot,
      "session-b",
      [
        {
          timestamp: "2026-04-22T02:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Re-check feature explorer failures",
          },
        },
        {
          timestamp: "2026-04-22T02:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", `sed -n '1,200p' ${focusFile}`],
            stderr: "Operation not permitted",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          timestamp: "2026-04-22T02:03:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: ` M ${focusFile}\n`,
            exit_code: 0,
          },
        },
      ],
    );

    const summary = await buildTaskAdaptiveIssueSummary(repoRoot);
    const markdown = formatTaskAdaptiveIssueSummaryMarkdown(summary);

    expect(summary.source).toBe("refreshed");
    expect(summary.counts.featureProfiles).toBeGreaterThan(0);
    expect(summary.counts.fileProfiles).toBeGreaterThan(0);
    expect(summary.topFeatures[0]).toMatchObject({
      featureId: "feature-explorer",
      featureName: "Feature Explorer",
    });
    expect(summary.topFiles[0]).toMatchObject({
      filePath: focusFile,
      featureIds: ["feature-explorer"],
    });
    expect(summary.topFailureCategories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "missing_dependency" }),
      expect.objectContaining({ category: "permission_or_worktree" }),
    ]));
    expect(markdown).toContain(TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER);
    expect(markdown).toContain("Feature Explorer (`feature-explorer`)");
    expect(markdown).toContain("missing_dependency");
    expect(markdown).not.toContain("session-a");
    expect(markdown).not.toContain("session-b");
    expect(markdown).not.toContain("Investigate feature explorer churn");
    expect(markdown).not.toContain("Re-check feature explorer failures");
    expect(markdown).not.toContain("/tmp/");
  });
});
