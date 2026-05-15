---
title: "GitLab 全流程集成：补齐 UI 层所有 GitHub-only 断点"
date: "2026-04-25"
status: open
severity: high
area: "gitlab-integration"
tags: [gitlab, kanban, vcs-provider, repo-picker, harness, rust-backend, i18n]
kind: feature
---

# GitLab 全流程集成：补齐 UI 层所有 GitHub-only 断点

## What & Why

routa 已有大量 GitLab 基础代码（VCS Provider、Webhook、Polling、DB Schema），但在用户可见的 UI 层面存在多处断点，导致 GitLab 用户无法像 GitHub 用户一样"从界面操作到完成"。本任务对所有模块做全面审计，找出所有 GitHub-only 断点，逐个补齐，确保 `PLATFORM=gitlab` 或 codebase `sourceType="gitlab"` 时全流程畅通。

**核心原则**：
- 不影响 GitHub 已有功能（零破坏性）
- 复用已有 `IVCSProvider` 抽象层和 `GitLabProvider`
- 按 `codebase.sourceType` 或全局 `PLATFORM` 环境变量动态切换

---

## 断点清单

### 已完成（无需改动）

| 模块 | 位置 | 状态 |
|------|------|------|
| VCS Provider 抽象 + GitLabProvider | `src/core/vcs/` | ✅ |
| Git URL 解析（GitHub + GitLab + 自建） | `src/core/git/git-utils.ts` | ✅ |
| Webhook 接收/处理/存储 | `src/core/webhooks/gitlab-*` | ✅ |
| Webhook 配置 UI | `src/client/components/gitlab-webhook-panel.tsx` | ✅ |
| Polling 轮询适配 | `src/core/polling/gitlab-polling-adapter.ts` | ✅ |
| DB Schema (Pg + SQLite) | `src/core/db/schema.ts`, `sqlite-schema.ts` | ✅ |
| .gitlab-ci.yml 解析器 + API | `src/core/gitlab/gitlab-ci-parser.ts`, `src/app/api/harness/gitlab-ci/route.ts` | ✅ |
| PR/MR 自动创建 (glab CLI + API) | `src/core/kanban/pr-auto-create.ts` | ✅ |
| Issue 创建（per-sourceType） | `src/core/kanban/github-issues.ts` | ✅ |
| Task 投递就绪检测 | `src/core/kanban/task-delivery-readiness.ts` | ✅ |
| Kanban Settings GitLab Token 输入框 | `kanban-settings-modal.tsx` L121-123 | ✅ |
| Settings Panel Webhook 平台切换 | `settings-panel.tsx` L579-673 | ✅ |
| VCS 虚拟文件系统（通用版） | `src/core/vcs/vcs-workspace.ts` `importVCSRepo()` | ✅ |
| Kanban Settings GitLab Webhook Section | `kanban-settings-modal.tsx` L896-933 | ✅ |

### 缺失断点（需要实施）

| # | 断点 | 位置 | 影响 | 优先级 |
|---|------|------|------|--------|
| **A1** | Kanban 导入弹窗只认 GitHub | `kanban-github-import-modal.tsx` | 无法导入 GitLab Issue/MR | P0 |
| **A2** | Kanban Tab 的 GitHub 检测逻辑 | `kanban-tab.tsx` L86-91, L217-221 | 导入按钮对 GitLab 不显示 | P0 |
| **A3** | 缺少 GitLab Issue/MR 列表 API | 无 `/api/gitlab/` 路由 | 前端无数据源 | P0 |
| **B1** | Kanban Card Activity Tab 硬编码 "GitHub" | `kanban-card-activity.tsx` L24, L267, L752-783 | GitLab Issue/MR 链接显示为 "GitHub" | P0 |
| **B2** | Kanban 导入工具函数类型绑定 GitHub | `kanban-github-import.ts` | 类型名含 "GitHub"，需通用化 | P1 |
| **C1** | Repo Picker 克隆 Tab 硬编码 github.com | `repo-picker.tsx` L112-120, L655, L661 | GitLab URL 不被识别 | P1 |
| **C2** | Repo Picker Tab 标签 "Clone from GitHub" | `repo-picker.tsx` L580 | 用户误导 | P1 |
| **D1** | GitHub Actions Flow Panel 无 GitLab 对等 | `harness-github-actions-flow-panel.tsx` | CI/CD 可视化缺位 | P1 |
| **D2** | GitHub Actions Flow Gallery 无 GitLab 对等 | `harness-github-actions-flow-gallery.tsx` | CI/CD 画廊缺位 | P1 |
| **E1** | Rust 后端完全无 GitLab 支持 | `crates/routa-server/src/api/` | 桌面模式无法使用 GitLab | P2 |
| **F1** | GitLabProvider 无分页支持 | `src/core/vcs/gitlab-provider.ts` | 大量 Issue/MR 只返回第一页 | P2 |
| **F2** | i18n 文案不完整 | `src/i18n/locales/` | 部分 GitLab 文案缺失 | P2 |

---

## 实施步骤

### 阶段 1：Kanban 全流程打通（P0）

> 目标：GitLab 用户打开 Kanban → 看到"导入"按钮 → 导入 GitLab Issue/MR → 创建卡片 → 完成 → 自动创建 MR

#### 1.1 新建 GitLab Issue/MR 列表 API 路由（A3）

**新建文件**：
- `src/app/api/gitlab/issues/route.ts`
- `src/app/api/gitlab/merge_requests/route.ts`

调用 `GitLabProvider.listIssues()` / `listPRs()`，接受 `repo` 和 `token` 参数。参考 `src/app/api/github/issues` 和 `src/app/api/github/pulls` 的模式。

端点：
- `GET /api/gitlab/issues?repo=group/project&token=glpat-xxx&state=open`
- `GET /api/gitlab/merge_requests?repo=group/project&token=glpat-xxx&state=open`

#### 1.2 Kanban Tab 平台检测通用化（A2）

**修改文件**：`src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`

将 `isLikelyGitHubCodebase` 替换为 `detectVCSPlatform`，返回 `"github" | "gitlab" | null`。连锁改动 `hasGitHubCodebase` → `hasVCSCodebase`、`githubAvailable` → `vcsAvailable`、`githubAccessAvailable` → `vcsAccessAvailable`。导入弹窗 props 传入 `platform={vcsPlatform}`。

#### 1.3 Kanban 导入弹窗平台化（A1）

**修改文件**：`src/app/workspace/[workspaceId]/kanban/kanban-github-import-modal.tsx`

增加 `platform` prop，根据平台切换 API 端点和术语（Pull Request → Merge Request）。不创建独立组件，90% UI 逻辑相同。

#### 1.4 Kanban Card Activity Tab 通用化（B1）

**修改文件**：`src/app/workspace/[workspaceId]/kanban/kanban-card-activity.tsx`

`ActivityTabId` 中 `"github"` → `"vcs"`，`label` 根据 `task.vcsUrl` 动态显示 "GitHub" 或 "GitLab"。重命名 `GitHubPanel` → `VCSPanel`。

#### 1.5 导入工具函数通用化（B2）

**修改文件**：`src/app/workspace/[workspaceId]/kanban/kanban-github-import.ts`

导出 `VCSImportItem` 类型别名（保持旧名兼容），核心函数已是平台无关的。

### 阶段 2：Repo Picker GitLab 支持（P1）

**修改文件**：`src/client/components/repo-picker.tsx`

增加 `isGitLabInput()` URL 识别。Clone Tab 前缀和标签动态化（github.com / gitlab.com / 自定义域）。底层 `/api/clone/progress` 已支持任意 git URL。

i18n 增加 `repoPicker.cloneFromURL`、`repoPicker.cloneFromGitLab`。

### 阶段 3：Harness CI/CD 流程面板（P1）

**新建文件**：
- `src/client/components/harness-gitlab-ci-flow-panel.tsx`
- `src/client/components/harness-gitlab-ci-flow-gallery.tsx`

数据源 `GET /api/harness/gitlab-ci` 已存在。展示 stages→jobs→dependencies 流程图，GitLab 橙色主题。

**修改文件**：`src/app/settings/harness/harness-console-page.tsx` — 注册 GitLab CI 面板。

### 阶段 4：Rust 后端 GitLab API（P2）

**新建文件**：
- `crates/routa-server/src/api/gitlab.rs` — REST API 路由（对照 `github.rs`）
- `crates/routa-server/src/api/tasks_gitlab.rs` — Kanban 任务同步

**修改文件**：
- `crates/routa-core/src/git.rs` — 增加 `parse_gitlab_url()`
- `crates/routa-server/src/api/mod.rs` — 注册 `/api/gitlab` 路由

### 阶段 5：边界处理与健壮性（P2）

- `src/core/vcs/gitlab-provider.ts` — 增加分页支持（`gitlabApiPaginated`）
- `src/i18n/locales/` — 补全 GitLab 文案
- 验证自建 GitLab 兼容性、MR/PR 术语映射、权限模型差异、平台共存

---

## 优先级总览

| 优先级 | 阶段 | 涉及文件数 | 预估工时 |
|--------|------|-----------|---------|
| **P0** | 1.1-1.5 Kanban 全流程 | ~8 文件 | 4-6 天 |
| **P1** | 2.1-2.3 Repo Picker | ~3 文件 | 1-2 天 |
| **P1** | 3.1-3.3 CI/CD 面板 | ~4 文件 | 2-3 天 |
| **P2** | 4.1-4.3 Rust 后端 | ~5 文件 | 3-5 天 |
| **P2** | 5.1-5.6 健壮性 | ~5 文件 | 2-3 天 |

---

## 验证计划

1. **环境配置**: `PLATFORM=gitlab`、`GITLAB_TOKEN`、`GITLAB_URL`，添加 `sourceType=gitlab` codebase
2. **Kanban 导入**: 确认导入按钮可见 → Issue/MR 导入 → 卡片创建成功
3. **Kanban Card Activity**: Tab 显示 "GitLab" → 链接跳转正确
4. **MR 自动创建**: 完成卡片 → 自动创建 MR
5. **Webhook**: 配置触发 → 确认处理
6. **Repo Picker**: GitLab URL 识别 → 克隆成功
7. **CI/CD**: Harness 页面 GitLab CI Pipeline 面板可见
8. **GitHub 回归**: 切回 `PLATFORM=github` → 全部操作正常

---

## 小白总结

> **现在的问题**：底层已能连 GitLab，但界面大量硬编码 "GitHub"——导入按钮只对 GitHub 显示、Activity Tab 写死 "GitHub"、克隆框只认 github.com。
>
> **方案做什么**：把所有硬编码改为"自动识别 GitHub/GitLab"，根据平台显示正确的按钮、文案和链接。
>
> **核心改动**：Kanban 导入弹窗支持 GitLab → Activity Tab 动态显示 → Repo Picker 识别 GitLab URL → GitLab CI/CD 可视化面板 → Rust 后端补齐桌面版
>
> **安全保障**：GitHub 功能一行不动，所有改动都是"增加 GitLab 路径"
