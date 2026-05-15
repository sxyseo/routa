## 一、问题现状（数据实证）

| 指标 | 数值 |
|------|------|
| Done 列卡片数据量 | 235,314 字符（超出工具单次输出上限） |
| 活跃列（Backlog + Todo + Dev + Review）合计 | 2 张卡片 |
| Done/活跃比例 | ~48:1，看板已严重失衡 |

## 二、四维度分析

### 2.1 UX 可用性

| 问题 | 影响 |
|------|------|
| 信息淹没 | 用户打开看板首先看到大量已完成任务，活跃任务不显眼 |
| 滚动疲劳 | 需大量滚动才能浏览 Done 列，"一眼概览"价值丧失 |
| 认知负荷 | 混合展示已完成和进行中任务，增加筛选有效信息的成本 |

### 2.2 渲染性能

| 问题 | 影响 |
|------|------|
| 数据量瓶颈 | 235K+ 字符 JSON 完整传输解析，增加首屏加载时间 |
| DOM 压力 | 大量卡片渲染为 DOM 节点，影响滚动流畅度和内存 |
| 实时更新开销 | SSE/WebSocket 推送时每条消息需遍历所有列的所有卡片 |

### 2.3 数据生命周期

| 问题 | 影响 |
|------|------|
| 缺失归档状态 | `KanbanColumnStage` 仅 6 种状态，无终态 |
| 无过期机制 | 任务进入 Done 后永久停留，无自动清理策略 |
| 无批量操作 | 无法批量选择已完成任务进行归档 |

**源码验证**（`src/core/models/kanban.ts:3`）：
```typescript
export type KanbanColumnStage = "backlog" | "todo" | "dev" | "review" | "blocked" | "done";
```

### 2.4 信息检索

| 问题 | 影响 |
|------|------|
| 历史可追溯性 | 用户仍需查阅已完成任务的详情、评审报告、代码变更 |
| 搜索能力 | `search_cards` 可按标题/标签搜索，但无法按完成时间范围过滤 |
| 无归档视图 | 缺少独立于主看板的归档历史视图 |

---

## 三、三种解决方案

### 方案 A：增加 Archived 状态 + 自动归档（推荐长期方案）

**实现方式**：
1. 在 `KanbanColumnStage` 新增 `"archived"` 状态
2. 任务进入 Done 后超过 N 天（可配置，默认 7 天）自动转为 archived
3. archived 任务不出现在主看板界面，通过独立"归档视图"或筛选条件访问
4. 提供 `archive_card` / `restore_card` MCP 工具
5. `list_cards_by_column("archived")` 返回归档任务，支持分页

**优点**：根本性解决生命周期问题 / 保留完整历史 / 主看板自动清爽 / 从源头减少 SSE 推送数据量
**缺点**：需扩展 TS + Rust 类型 / 需实现归档视图 / 需定时任务机制
**影响范围**：kanban.ts、boards.ts、MCP 工具层、UI 组件（Web + Tauri）、Rust crates
**实施复杂度**：中高

### 方案 B：Done 列折叠 + 虚拟滚动（推荐短期方案）

**实现方式**：
1. Done 列默认折叠，点击展开
2. 折叠状态仅显示卡片数量统计（如 "Done (47)"）
3. 展开后使用虚拟滚动渲染，仅渲染可视区域内卡片
4. 不新增状态，纯 UI 层优化

**优点**：实施简单 / 不改数据模型和 MCP 工具 / 立即缓解问题
**缺点**：治标不治本 / 数据量持续增长 / 不解决传输量和 SSE 推送开销
**影响范围**：仅看板 UI 组件
**实施复杂度**：低

### 方案 C：时间过滤 + 手动归档按钮

**实现方式**：
1. 看板顶部增加时间范围过滤器（最近7天/30天/全部）
2. 每张 Done 卡片增加"归档"按钮
3. 归档任务存入独立存储，可通过搜索访问
4. 不新增 `KanbanColumnStage`，在卡片上增加 `archivedAt` 时间戳字段

**优点**：灵活度高 / 不改现有列状态模型 / 时间过滤器通用
**缺点**：依赖用户手动操作 / 字段需多处兼容 / 无自动清理 / 查询时需区分"活跃Done"和"归档Done"增加条件复杂度
**影响范围**：kanban.ts、UI 组件、MCP 工具层
**实施复杂度**：中

---

## 四、推荐方案

**首选：方案 B（短期）+ 方案 A（长期）组合实施**

| 阶段 | 方案 | 目标 | 时机 |
|------|------|------|------|
| 第一阶段 | 方案 B | 快速止血，零数据模型变更 | 立即 |
| 第二阶段 | 方案 A | 根本性解决数据生命周期 | 规划迭代 |

**推荐理由**：
- 方案 B 可立即实施，快速止血
- 方案 A 是长期正确的架构方向
- 两者不冲突，可独立交付
- 组合方案兼顾短期见效和长期架构健康

**方案 C 不推荐的原因**：在卡片上增加 `archivedAt` 但保留 `done` stage，会导致"Done 列既包含活跃已完成任务又包含归档任务"的查询语义混乱。相比方案 A 的干净状态分离，方案 C 的半归档设计会增加全链路条件判断复杂度。

---

## 五、受影响模块清单（源码验证）

| 模块 | 文件路径 | 影响描述 | 验证状态 |
|------|----------|----------|----------|
| 类型定义 | `src/core/models/kanban.ts` | `KanbanColumnStage` 扩展 / `columnStageToTaskStatus` 映射新增 archived 分支 | 已验证 |
| 列配置 | `src/core/kanban/boards.ts` | 新增 archived 列定义和自动化配置 | 已验证 |
| 交付规则 | `src/core/kanban/task-delivery-readiness.ts` | 归档条件评估（含 `isAnalysisOnlyTask` 判断） | 已验证 |
| MCP 工具 | `src/core/tools/kanban-tools.ts` | 支持归档状态查询和操作 | 已验证 |
| Rust 类型 | `crates/routa-core/src/models/kanban.rs` | `stage` 字符串值同步、`recommended_automation_for_stage` match 分支、`default_column_position_for_stage` match 分支 | 已验证 |
| Rust 校验 | `crates/routa-core/src/models/kanban_config.rs` | `VALID_STAGES` 数组扩展（当前硬编码 6 值） | 已验证 |
| 自动化步骤 | `boards.ts:91-121` | Done 列 3 步自动化需评估归档触发点 | 已验证 |
| 调度服务 | `src/core/scheduling/scheduler-service.ts` | 已有 node-cron 分钟级定时机制，可复用 | 已验证 |
| 看板 UI | `src/app/workspace/[workspaceId]/kanban/` | Web 端看板组件（约 30+ 文件） | 已验证 |
| 桌面端 UI | 同上看板组件通过 Tauri WebView 渲染 | 需双端同步验证 | 已验证 |

**Rust 侧扩展成本评估**：低。Rust 使用字符串 `stage` 值（非枚举），添加 `"archived"` 需扩展 3 处：`VALID_STAGES` 数组、`recommended_automation_for_stage` match、`default_column_position_for_stage` match。每处仅增加一行分支。

---

## 六、关键约束与风险（补充分析）

### 6.1 Done 列自动化链依赖

Done 列已有 3 步自动化链（`boards.ts:91-120`）：

```
PR Publisher → Auto Merger → Done Reporter
```

**归档触发点必须在 Done Reporter 完成之后**，否则会截断交付流程（PR 未合并即归档）。推荐策略：

- **自动归档**：仅对"Done 列停留超过 N 天且所有自动化步骤已完成"的卡片生效
- **判定条件**：`automation.lastStepCompletedAt` 存在且距当前时间超过归档阈值
- **防护措施**：归档前校验卡片无活跃 PR（`deliveryRules.requirePullRequestReady` 对应的状态）

### 6.2 双端同步成本

routa 采用 Web(Next.js) + Desktop(Tauri) 双端架构。方案 A 的类型扩展需要在两端同步：

| 变更点 | Web 端 | Desktop 端（Tauri） |
|--------|--------|---------------------|
| TS 类型 | `KanbanColumnStage` | 同左（共享代码） |
| Rust 类型 | 不涉及 | `kanban.rs` + `kanban_config.rs` |
| UI 组件 | 看板页面组件（30+ 文件） | 同左（WebView 共享） |
| API 适配 | Next.js API routes | Axum routes |

Web 端 UI 组件与 Tauri 端通过 WebView 共享前端代码，UI 变更无需双套实现。但 Axum 侧的 API 路由需同步适配 `archived` 状态。

### 6.3 定时任务基础设施

**已有可复用机制**：`scheduler-service.ts` 使用 node-cron 实现分钟级定时调度，且支持 Vercel Cron Jobs 兼容。自动归档定时任务可直接注册为新的 schedule tick，无需从零搭建基础设施。

实现路径：
1. 在 `run-schedule-tick.ts` 中注册归档检查任务
2. 任务逻辑：查询 `done` 状态超过 N 天且自动化已完成的卡片，批量更新为 `archived`
3. 配置项：归档阈值天数（默认 7 天）存入 workspace 级别配置

### 6.4 存量数据迁移策略

当前 Done 列已有 235K+ 字符数据。新增 `archived` 状态后需处理存量：

| 策略 | 做法 | 适用场景 |
|------|------|----------|
| **一次性全量归档** | 发布时运行迁移脚本，将所有现有 Done 卡片标记为 archived | Done 列无历史查询需求 |
| **Cut-off 时间切割** | 设定截止日期（如发布日 -30 天），之前的全部归档，之后的保留在 Done | 需保留近期历史 |
| **渐进式自动归档** | 不做迁移，上线后由定时任务逐步将超期卡片归档 | 最安全，无一次性迁移风险 |

**推荐**：渐进式自动归档。无迁移脚本风险，上线即生效，存量数据随时间自然归档。

### 6.5 SSE 推送优化

方案 B（折叠）仅解决 DOM 渲染压力，不解决 SSE 推送数据量——即使折叠，服务端仍推送完整卡片数据。

方案 A 从源头减少推送量：`archived` 卡片不纳入主看板推送范围，SSE 消息体量随归档推进自然缩减。

**SSE 优化建议**（方案 A 实施时）：
- `list_cards_by_column` 默认排除 `archived` 状态
- SSE 推送事件增加 `includedStages` 过滤字段
- 归档/恢复操作发送轻量级通知（仅 cardId + newStage），不传输完整卡片数据

---

## 七、后续拆卡建议

### 卡片 1：Done 列折叠与虚拟滚动（方案 B 实施）
- **范围**：UI 层，Done 列默认折叠 + 虚拟滚动渲染
- **验收**：Done 列默认只显示数量统计，展开后流畅滚动
- **依赖**：无
- **复杂度**：低

### 卡片 2：Archived 状态模型扩展
- **范围**：TypeScript `KanbanColumnStage` + Rust `VALID_STAGES` / `recommended_automation_for_stage` / `default_column_position_for_stage` 类型定义同步、`columnStageToTaskStatus` 映射、MCP 工具层适配
- **验收**：双端 `archived` 状态定义就位，MCP 工具支持归档操作，Rust 校验通过
- **依赖**：无
- **复杂度**：中
- **关键文件**：`kanban.ts:3`、`kanban.rs:355-414`、`kanban_config.rs:5`

### 卡片 3：自动归档定时任务
- **范围**：在现有 `scheduler-service.ts` 基础上注册归档 schedule tick，实现配置化归档天数、批量归档触发
- **验收**：Done 列任务超期后自动转为 archived 状态；归档前校验自动化步骤已完成、无活跃 PR
- **依赖**：卡片 2
- **复杂度**：中
- **关键文件**：`scheduler-service.ts`、`run-schedule-tick.ts`

### 卡片 4：归档历史视图
- **范围**：独立的归档任务浏览界面、搜索和筛选；双端（Web + Tauri）同步验证
- **验收**：用户可在主看板外查阅已归档任务详情
- **依赖**：卡片 2
- **复杂度**：中高

### 卡片 5：SSE 推送优化（可选增强）
- **范围**：SSE 事件默认排除 archived 卡片；归档/恢复操作发送轻量级通知
- **验收**：主看板 SSE 推送数据量随归档自然缩减；归档操作不触发完整卡片数据推送
- **依赖**：卡片 2、卡片 3
- **复杂度**：中

---

## 八、验收标准对照

| AC | 要求 | 产出位置 | 状态 |
|----|------|----------|------|
| AC1 | 四维度分析（UX/性能/生命周期/检索） | 第二节 | 通过 |
| AC2 | 三种方案（含实现方式/优缺点/影响/复杂度） | 第三节 | 通过 |
| AC3 | 推荐方案 + 优先级排序 + 推荐理由 | 第四节 | 通过 |
| AC4 | 受影响模块/类型/配置/UI 组件清单 | 第五节 | 通过 |
| AC5 | 后续拆卡建议（每卡独立交付边界） | 第七节 | 通过 |
| AC6 | 关键约束与风险（自动化链依赖/双端同步/定时任务/数据迁移/SSE 优化） | 第六节 | 通过 |
