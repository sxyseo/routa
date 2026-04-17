export type ExplorerScope = "changed" | "related" | "all";
export type FileNodeKind = "folder" | "file";
export type InspectorTab = "context" | "screenshot" | "api";

export interface ChangeMetric {
  plus: number;
  minus: number;
  sessions: number;
  updatedAt: string;
  author: "agent" | "human" | "mixed";
  dirty?: boolean;
}

export interface ScreenshotCase {
  id: string;
  title: string;
  route: string;
  viewport: string;
  updatedAt: string;
  note: string;
  status: "baseline" | "needs-review" | "passed";
}

export interface ApiPreset {
  id: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  description: string;
  body?: string;
  expectedStatus: number;
  responseExample: string;
}

export interface FileNode {
  id: string;
  name: string;
  path: string;
  kind: FileNodeKind;
  scope: ExplorerScope;
  metric?: ChangeMetric;
  why?: string;
  recentChanges?: string[];
  relatedPaths?: string[];
  openGaps?: string[];
  children?: FileNode[];
}

export interface FeatureDefinition {
  id: string;
  name: string;
  sessionCount: number;
  changedFiles: number;
  updatedAt: string;
  summary: string;
  files: FileNode[];
  screenshots: ScreenshotCase[];
  apis: ApiPreset[];
}

const featureDefinitions: FeatureDefinition[] = [
  {
    id: "session-recovery",
    name: "Session Recovery",
    sessionCount: 12,
    changedFiles: 8,
    updatedAt: "2h ago",
    summary: "Recover previous work by feature-scoped context and selected files.",
    files: [
      {
        id: "src",
        name: "src",
        path: "src",
        kind: "folder",
        scope: "changed",
        children: [
          {
            id: "src-app",
            name: "app",
            path: "src/app",
            kind: "folder",
            scope: "changed",
            children: [
              {
                id: "src-app-sessions",
                name: "sessions",
                path: "src/app/sessions",
                kind: "folder",
                scope: "changed",
                children: [
                  {
                    id: "page-tsx",
                    name: "page.tsx",
                    path: "src/app/sessions/page.tsx",
                    kind: "file",
                    scope: "changed",
                    metric: { plus: 84, minus: 21, sessions: 3, updatedAt: "2h ago", author: "agent" },
                    why: "Session Recovery 的主入口页面，负责会话列表展示、筛选与恢复入口。",
                    recentChanges: [
                      "新增 featureId 到查询条件",
                      "支持 recent-in-workspace 筛选",
                      "恢复入口增加 active / paused 状态",
                      "优化 loading 和空态 UI",
                    ],
                    relatedPaths: [
                      "src/app/sessions/feature-panel.tsx",
                      "src/core/session-store.ts",
                      "specs/session-recovery.md",
                    ],
                    openGaps: [
                      "右侧 Feature Explorer badge 未接",
                      "缺少 unit tests",
                      "恢复失败场景的错误态未处理",
                    ],
                  },
                  {
                    id: "feature-panel-tsx",
                    name: "feature-panel.tsx",
                    path: "src/app/sessions/feature-panel.tsx",
                    kind: "file",
                    scope: "changed",
                    metric: { plus: 43, minus: 10, sessions: 2, updatedAt: "5h ago", author: "human" },
                    why: "显示 feature 级别的信息面板，后续可以从 session page 和 explorer 复用。",
                    recentChanges: [
                      "增加 feature badge 位置",
                      "增加 changed / related / all 的切换按钮",
                      "加入 selection 状态摘要",
                    ],
                    relatedPaths: [
                      "src/app/sessions/page.tsx",
                      "src/core/session-context.ts",
                    ],
                    openGaps: [
                      "还没接 screenshot tab",
                      "和 API 测试面板状态未共享",
                    ],
                  },
                  {
                    id: "session-list-tsx",
                    name: "session-list.tsx",
                    path: "src/app/sessions/session-list.tsx",
                    kind: "file",
                    scope: "related",
                    metric: { plus: 12, minus: 2, sessions: 1, updatedAt: "4h ago", author: "mixed" },
                    why: "受 feature 聚合影响，需要同步 session list 的过滤与跳转逻辑。",
                    recentChanges: ["增加 fromFeature 参数", "保留最近打开 session 的高亮"],
                    relatedPaths: ["src/app/sessions/page.tsx"],
                    openGaps: ["排序规则还未和 explorer 对齐"],
                  },
                ],
              },
              {
                id: "src-app-api",
                name: "api",
                path: "src/app/api",
                kind: "folder",
                scope: "changed",
                children: [
                  {
                    id: "src-app-api-sessions",
                    name: "sessions",
                    path: "src/app/api/sessions",
                    kind: "folder",
                    scope: "changed",
                    children: [
                      {
                        id: "src-app-api-sessions-id",
                        name: "[id]",
                        path: "src/app/api/sessions/[id]",
                        kind: "folder",
                        scope: "changed",
                        children: [
                          {
                            id: "src-app-api-sessions-id-context",
                            name: "context",
                            path: "src/app/api/sessions/[id]/context",
                            kind: "folder",
                            scope: "changed",
                            children: [
                              {
                                id: "context-route-ts",
                                name: "route.ts",
                                path: "src/app/api/sessions/[id]/context/route.ts",
                                kind: "file",
                                scope: "changed",
                                metric: { plus: 25, minus: 8, sessions: 2, updatedAt: "1h ago", author: "agent" },
                                why: "恢复上下文 API，用于获取 parent / sibling / child 以及 related files 信息。",
                                recentChanges: [
                                  "补充 relatedFiles 字段",
                                  "增加 lastUpdated 排序",
                                  "补充缺省 feature id 兜底逻辑",
                                ],
                                relatedPaths: [
                                  "src/core/session-context.ts",
                                  "src/app/sessions/feature-panel.tsx",
                                ],
                                openGaps: ["缺少 response schema 校验"],
                              },
                            ],
                          },
                          {
                            id: "recent-route-ts",
                            name: "recent/route.ts",
                            path: "src/app/api/sessions/[id]/recent/route.ts",
                            kind: "file",
                            scope: "related",
                            metric: { plus: 18, minus: 4, sessions: 1, updatedAt: "yesterday", author: "human" },
                            why: "提供最近 session 快速恢复数据。",
                            recentChanges: ["增加 fromFeature 标签"],
                            relatedPaths: ["src/app/sessions/session-list.tsx"],
                            openGaps: ["还没带 feature tree path"],
                          },
                        ],
                      }
                    ],
                  }
                ],
              },
            ],
          },
          {
            id: "src-core",
            name: "core",
            path: "src/core",
            kind: "folder",
            scope: "changed",
            children: [
              {
                id: "src-core-store",
                name: "store",
                path: "src/core/store",
                kind: "folder",
                scope: "changed",
                children: [
                  {
                    id: "session-store-ts",
                    name: "session-store.ts",
                    path: "src/core/store/session-store.ts",
                    kind: "file",
                    scope: "changed",
                    metric: { plus: 12, minus: 3, sessions: 2, updatedAt: "2h ago", author: "mixed", dirty: true },
                    why: "维护 feature 绑定和多文件选择后的 continue payload。",
                    recentChanges: [
                      "追加 selectedFileIds",
                      "支持 contextSource = feature-explorer",
                      "补充 persistSelection 逻辑",
                    ],
                    relatedPaths: [
                      "src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx",
                      "src/app/sessions/feature-panel.tsx",
                    ],
                    openGaps: ["未完成 local storage 迁移", "dirty 状态回写还没完成"],
                  },
                  {
                    id: "types-ts",
                    name: "types.ts",
                    path: "src/core/store/types.ts",
                    kind: "file",
                    scope: "related",
                    metric: { plus: 6, minus: 1, sessions: 1, updatedAt: "now", author: "human", dirty: true },
                    why: "补充 feature explorer 的 selection 和 inspector 类型。",
                    recentChanges: ["新增 inspectorTab 类型", "补充 screenshot / api preset 类型"],
                    relatedPaths: ["src/core/store/session-store.ts"],
                    openGaps: ["导出的命名待统一"],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "specs",
        name: "specs",
        path: "specs",
        kind: "folder",
        scope: "changed",
        children: [
          {
            id: "session-recovery-md",
            name: "session-recovery.md",
            path: "specs/session-recovery.md",
            kind: "file",
            scope: "changed",
            metric: { plus: 23, minus: 7, sessions: 1, updatedAt: "1d ago", author: "human" },
            why: "定义 feature 级恢复流程与 UI 行为。",
            recentChanges: [
              "补充独立页面的信息架构",
              "增加 screenshot / API testing panel 说明",
            ],
            relatedPaths: ["src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx"],
            openGaps: ["缺少 keyboard shortcut 说明"],
          },
        ],
      },
    ],
    screenshots: [
      {
        id: "shot-1",
        title: "Feature tree / changed files default state",
        route: "/workspace/:workspaceId/feature-explorer?feature=session-recovery",
        viewport: "1440x900",
        updatedAt: "20m ago",
        note: "默认打开 Changed 模式，选中 page.tsx。",
        status: "baseline",
      },
      {
        id: "shot-2",
        title: "API inspector visible",
        route: "/workspace/:workspaceId/feature-explorer?feature=session-recovery&tab=api",
        viewport: "1440x900",
        updatedAt: "15m ago",
        note: "展示 POST /api/feature-explorer/selection 预设。",
        status: "needs-review",
      },
    ],
    apis: [
      {
        id: "api-1",
        method: "GET",
        path: "/api/spec/surface-index",
        description: "获取 feature 和 surface 的映射。",
        expectedStatus: 200,
        responseExample: `{
  "features": [
    { "id": "session-recovery", "name": "Session Recovery" }
  ]
}`,
      },
      {
        id: "api-2",
        method: "GET",
        path: "/api/sessions/demo-session/context",
        description: "读取一个 session 的恢复上下文。",
        expectedStatus: 200,
        responseExample: `{
  "parent": null,
  "siblings": [],
  "children": [],
  "recentInWorkspace": []
}`,
      },
      {
        id: "api-3",
        method: "POST",
        path: "/api/feature-explorer/selection",
        description: "保存当前 feature + selected files 作为 continue context。",
        body: `{
  "featureId": "session-recovery",
  "filePaths": [
    "src/app/sessions/page.tsx",
    "src/core/store/session-store.ts"
  ],
  "inspectorTab": "api"
}`,
        expectedStatus: 200,
        responseExample: `{
  "ok": true,
  "contextId": "ctx_feature_selection_01"
}`,
      },
    ],
  },
  {
    id: "kanban-workflow",
    name: "Kanban Workflow",
    sessionCount: 8,
    changedFiles: 5,
    updatedAt: "1d ago",
    summary: "Track tasks, states, and execution progress across sessions.",
    files: [
      {
        id: "kanban-root",
        name: "src",
        path: "src",
        kind: "folder",
        scope: "changed",
        children: [
          {
            id: "kanban-app",
            name: "app",
            path: "src/app",
            kind: "folder",
            scope: "changed",
            children: [
              {
                id: "kanban-folder",
                name: "kanban",
                path: "src/app/kanban",
                kind: "folder",
                scope: "changed",
                children: [
                  {
                    id: "kanban-board",
                    name: "board.tsx",
                    path: "src/app/kanban/board.tsx",
                    kind: "file",
                    scope: "changed",
                    metric: { plus: 31, minus: 9, sessions: 2, updatedAt: "1d ago", author: "human" },
                    why: "看板主视图，展示列和任务卡。",
                    recentChanges: ["增加 feature badge", "调整卡片密度"],
                    relatedPaths: ["src/app/kanban/task-card.tsx"],
                    openGaps: ["和 explorer 的跳转尚未接通"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    screenshots: [
      {
        id: "kanban-shot",
        title: "Board density review",
        route: "/workspace/:workspaceId/feature-explorer?feature=kanban-workflow",
        viewport: "1440x900",
        updatedAt: "1d ago",
        note: "检查 Kanban card density。",
        status: "passed",
      },
    ],
    apis: [
      {
        id: "kanban-api",
        method: "GET",
        path: "/api/tasks/board",
        description: "示例：获取当前 workspace 的看板任务。",
        expectedStatus: 200,
        responseExample: `{
  "columns": [
    { "id": "todo", "title": "Todo" }
  ]
}`,
      },
    ],
  },
  {
    id: "harness-console",
    name: "Harness Console",
    sessionCount: 7,
    changedFiles: 4,
    updatedAt: "2d ago",
    summary: "Console and execution feedback for agent runs.",
    files: [
      {
        id: "harness-root",
        name: "src",
        path: "src",
        kind: "folder",
        scope: "changed",
        children: [
          {
            id: "harness-app",
            name: "app",
            path: "src/app",
            kind: "folder",
            scope: "changed",
            children: [
              {
                id: "harness-folder",
                name: "harness",
                path: "src/app/harness",
                kind: "folder",
                scope: "changed",
                children: [
                  {
                    id: "harness-console-file",
                    name: "console.tsx",
                    path: "src/app/harness/console.tsx",
                    kind: "file",
                    scope: "changed",
                    metric: { plus: 27, minus: 4, sessions: 1, updatedAt: "2d ago", author: "agent" },
                    why: "显示执行结果和终端输出。",
                    recentChanges: ["增加 sticky footer", "优化失败态提示"],
                    relatedPaths: ["src/app/harness/output.tsx"],
                    openGaps: ["截图基线未建立"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    screenshots: [
      {
        id: "harness-shot",
        title: "Harness output baseline",
        route: "/workspace/:workspaceId/feature-explorer?feature=harness-console",
        viewport: "1280x800",
        updatedAt: "2d ago",
        note: "为 console 页建立 baseline。",
        status: "baseline",
      },
    ],
    apis: [
      {
        id: "harness-api",
        method: "PATCH",
        path: "/api/harness/runs/demo-run",
        description: "示例：修改 run 状态。",
        body: `{
  "status": "paused"
}`,
        expectedStatus: 200,
        responseExample: `{
  "ok": true
}`,
      },
    ],
  },
];

export function getFeatureDefinitions(): FeatureDefinition[] {
  return featureDefinitions;
}
