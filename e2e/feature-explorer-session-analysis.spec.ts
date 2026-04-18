import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const WORKSPACE_ID = "default";
const REPO_PATH = "/Users/phodal/ai/routa-js";
const FEATURE_ID = "kanban-workflow";
const FEATURE_URL = `/workspace/${WORKSPACE_ID}/feature-explorer?feature=${FEATURE_ID}&file=crates%2Frouta-server%2Fsrc%2Fapi%2Fkanban.rs`;
const EMPTY_FILE_URL = `/workspace/${WORKSPACE_ID}/feature-explorer?feature=${FEATURE_ID}&file=crates%2Frouta-server%2Fsrc%2Fapi%2Fhealth.rs`;

const capabilityGroups = [
  {
    id: "workflow",
    name: "Workflow",
    description: "Workflow surfaces",
  },
];

const features = [
  {
    id: FEATURE_ID,
    name: "Kanban Workflow",
    group: "workflow",
    summary: "Coordinate tasks through lane transitions, automation, and git-aware execution.",
    status: "shipped",
    sessionCount: 29,
    changedFiles: 50,
    updatedAt: "2026-04-15T08:00:00.000Z",
    sourceFileCount: 50,
    pageCount: 10,
    apiCount: 6,
  },
];

const surfaceIndex = {
  generatedAt: "2026-04-18T00:00:00.000Z",
  pages: [],
  apis: [],
  contractApis: [],
  nextjsApis: [],
  rustApis: [],
  metadata: null,
  repoRoot: REPO_PATH,
  warnings: [],
};

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function buildFeatureDetail() {
  return {
    id: FEATURE_ID,
    name: "Kanban Workflow",
    group: "workflow",
    summary: "Coordinate tasks through lane transitions, automation, and git-aware execution.",
    status: "shipped",
    pages: [],
    apis: [],
    sourceFiles: [
      "crates/routa-server/src/api/kanban.rs",
      "crates/routa-server/src/api/health.rs",
    ],
    relatedFeatures: ["session-recovery"],
    domainObjects: [],
    sessionCount: 29,
    changedFiles: 50,
    updatedAt: "2026-04-15T08:00:00.000Z",
    fileTree: [
      {
        id: "folder-crates",
        name: "crates",
        path: "crates",
        kind: "folder",
        children: [
          {
            id: "folder-routa-server",
            name: "routa-server",
            path: "crates/routa-server",
            kind: "folder",
            children: [
              {
                id: "folder-src",
                name: "src",
                path: "crates/routa-server/src",
                kind: "folder",
                children: [
                  {
                    id: "folder-api",
                    name: "api",
                    path: "crates/routa-server/src/api",
                    kind: "folder",
                    children: [
                      {
                        id: "file-kanban",
                        name: "kanban.rs",
                        path: "crates/routa-server/src/api/kanban.rs",
                        kind: "file",
                        children: [],
                      },
                      {
                        id: "file-health",
                        name: "health.rs",
                        path: "crates/routa-server/src/api/health.rs",
                        kind: "file",
                        children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    fileStats: {
      "crates/routa-server/src/api/kanban.rs": {
        changes: 6,
        sessions: 6,
        updatedAt: "2026-04-15T08:00:00.000Z",
      },
      "crates/routa-server/src/api/health.rs": {
        changes: 1,
        sessions: 0,
        updatedAt: "2026-04-10T08:00:00.000Z",
      },
    },
    fileSignals: {
      "crates/routa-server/src/api/kanban.rs": {
        sessions: [
          {
            provider: "codex",
            sessionId: "019d9193-952d-76c3-a31b-147becb9df3f",
            updatedAt: "2026-04-15T08:00:00.000Z",
            promptSnippet: "Analyze why this kanban flow kept expanding beyond the original scope.",
            promptHistory: [
              "Analyze why this kanban flow kept expanding beyond the original scope.",
              "Recommend which repo and file context should have been provided earlier.",
            ],
            toolNames: ["exec_command", "apply_patch"],
            changedFiles: [
              "fatal: Unable to create '/Users/phodal/ai/routa-js/.git/index.lock': Operation not permitted",
              "crates/routa-server/src/api/kanban.rs",
              "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
            ],
            resumeCommand: "codex resume 019d9193-952d-76c3-a31b-147becb9df3f",
          },
          {
            provider: "codex",
            sessionId: "019d9064-aea1-7203-ac2d-ed3d7ad304ec",
            updatedAt: "2026-04-15T07:30:00.000Z",
            promptSnippet: "Summarize what issue context was missing before implementation started.",
            promptHistory: [
              "Summarize what issue context was missing before implementation started.",
            ],
            toolNames: ["exec_command"],
            changedFiles: [
              "src/app/workspace/[workspaceId]/kanban/kanban-status-bar.tsx",
            ],
            resumeCommand: "codex resume 019d9064-aea1-7203-ac2d-ed3d7ad304ec",
          },
        ],
        toolHistory: ["exec_command", "apply_patch"],
        promptHistory: [
          "Analyze why this kanban flow kept expanding beyond the original scope.",
        ],
      },
    },
  };
}

async function installFeatureExplorerMocks(page: Page, onAcpRequest?: (body: unknown) => void) {
  await page.addInitScript(({ repoPath }) => {
    window.localStorage.setItem("routa.locale", "en");
    window.localStorage.setItem(
      "routa.repoSelection.featureExplorer.default",
      JSON.stringify({
        name: "routa-js",
        path: repoPath,
        branch: "main",
      }),
    );
  }, { repoPath: REPO_PATH });

  await page.route("**/api/workspaces?status=active", async (route) => {
    await route.fulfill(json({
      workspaces: [
        {
          id: WORKSPACE_ID,
          title: "Default Workspace",
          status: "active",
          metadata: {},
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
    }));
  });

  await page.route(`**/api/workspaces/${WORKSPACE_ID}/codebases`, async (route) => {
    await route.fulfill(json({
      codebases: [
        {
          id: "cb-routa-js",
          workspaceId: WORKSPACE_ID,
          repoPath: REPO_PATH,
          branch: "main",
          label: "routa-js",
          isDefault: true,
          sourceType: "local",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
    }));
  });

  await page.route("**/api/feature-explorer?**", async (route) => {
    await route.fulfill(json({
      capabilityGroups,
      features,
    }));
  });

  await page.route("**/api/spec/surface-index?**", async (route) => {
    await route.fulfill(json(surfaceIndex));
  });

  await page.route(`**/api/feature-explorer/${FEATURE_ID}?**`, async (route) => {
    await route.fulfill(json(buildFeatureDetail()));
  });

  if (onAcpRequest) {
    await page.route("**/api/acp", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }

      const body = route.request().postDataJSON();
      onAcpRequest(body);
      await route.fulfill(json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          sessionId: "analysis-session-1",
        },
      }));
    });
  }
}

test.describe("Feature Explorer session analysis", () => {
  test.use({ baseURL: BASE_URL });

  test("shows the analysis entry for a URL-selected file and filters noisy related files", async ({ page }) => {
    await installFeatureExplorerMocks(page);

    await page.goto(FEATURE_URL, { waitUntil: "domcontentloaded" });

    const openAnalysisButton = page.getByRole("button", { name: "Open analysis panel" });
    await expect(openAnalysisButton).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByText("019d9193-952d-76c3-a31b-147becb9df3f")).toBeVisible();
    await expect(page.getByText("src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx")).toBeVisible();
    await expect(page.getByText("Operation not permitted")).toHaveCount(0);
  });

  test("opens a right-side drawer and starts the specialist analysis session", async ({ page }) => {
    let acpRequestBody: unknown = null;
    await installFeatureExplorerMocks(page, (body) => {
      acpRequestBody = body;
    });

    await page.goto(FEATURE_URL, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Open analysis panel" }).click();

    const drawer = page.getByTestId("feature-explorer-session-analysis-drawer");
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(drawer).toContainText("kanban.rs");
    await expect(drawer).toContainText("Analyze selected sessions");

    const box = await drawer.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThanOrEqual((viewport?.width ?? 0) - 8);

    await page.getByRole("button", { name: "Analyze selected sessions" }).click();
    await page.waitForURL("**/workspace/default/sessions/analysis-session-1", { timeout: 15_000 });

    expect(acpRequestBody).toMatchObject({
      method: "session/new",
      params: {
        workspaceId: WORKSPACE_ID,
        cwd: REPO_PATH,
        branch: "main",
        role: "ROUTA",
        specialistId: "file-session-analyst",
        specialistLocale: "en",
        name: "File session analysis · kanban.rs",
      },
    });
  });

  test("keeps the analysis entry disabled when the selected file has no session evidence", async ({ page }) => {
    await installFeatureExplorerMocks(page);

    await page.goto(EMPTY_FILE_URL, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("No matching sessions yet")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Open analysis panel" })).toBeDisabled();
    await expect(
      page.getByText("Select at least one file with session evidence to start an analysis session."),
    ).toBeVisible();
  });
});
