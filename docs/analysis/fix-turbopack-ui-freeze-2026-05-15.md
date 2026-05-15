# UI 假死根因分析 — 2026-05-15

## 状态：已确诊，待修复

## 用户假设 vs 实际根因

| 维度 | 用户假设 | 实际情况 |
|------|---------|---------|
| 根因 | worktree 文件修改触发 Turbopack 重编译 | 服务端事件循环饥饿（Event Loop Starvation） |
| 编译次数 | "不断重编译" | 全天仅 **4 次**编译 |
| 影响路径 | 文件监听 → 编译 → UI 冻结 | MCP 长请求 → 阻塞事件循环 → 全部请求排队 |
| 修复方向 | 排除 worktree 目录 | MCP/kanban-events 异步化 + Turbopack 缓存清理 |

## 假设被推翻的证据

1. **编译次数极低**：全天仅 4 次编译（08:37, 10:13, 10:30, 10:50），均为正常路由编译
2. **11:22 无编译事件**：用户提到 T7-01-B2.2 在 11:22 修改 10+ 文件，但日志中 11:22 时段仅有 `GET /api/.../codebases/changes` 一个请求
3. **worktree 在项目外部**：agent worktree 位于 `E:/AI/routa/...`，主项目在 `E:/ideaProject/phodal/routa/`，Next.js 文件监听不会跨目录
4. **无 `--turbo` 标志但 Turbopack 默认启用**：Next.js 16 默认使用 Turbopack

## 实际根因：服务端事件循环饥饿

### 问题链条

```
MCP SSE 长连接 (2-7 min/请求)
    ↓
Node.js 事件循环被阻塞
    ↓
better-sqlite3 同步查询加剧阻塞
    ↓
全部 HTTP 请求排队 (305 个慢请求，平均 3.9 min)
    ↓
node-cron 丢失执行 (93 次警告)
    ↓
UI 无法获得任何响应 → "假死"
```

### 关键数据

| 指标 | 数值 | 正常值 |
|------|------|--------|
| 慢请求 (>50s) 总数 | 305 | 0 |
| 平均慢请求耗时 | 3.9 min | <1s |
| kanban/events 超 5min | 69 次 | 0 |
| node-cron 丢失执行 | 93 次 | 0 |
| dev server 重启次数 | 10 次 | 1-2 |
| Turbopack panic | 8 次 | 0 |

### 慢请求分布

| 端点 | 次数 | 典型耗时 |
|------|------|---------|
| `GET /api/kanban/events` | 77 | 5-7 min（超时） |
| `GET /api/mcp` (SSE) | 200+ | 2-5 min |
| `GET /api/tasks` | 5 | 2+ min |
| `GET /api/kanban/boards` | 5 | 2+ min |

## 次要问题：Turbopack 缓存损坏

08:29 发生 SST 缓存文件损坏：
- 文件 `.next/dev/cache/turbopack/c573e8c4/00005314.sst` 丢失
- 触发 8 次 Turbopack panic（08:29-08:35）
- 导致 dev server 崩溃重启（exit code 1）
- 缓存目录已膨胀至 **1.3 GB**
- 昨日日志无 panic，今日首次出现

## 根治方案

### P0：清理 Turbopack 缓存 ✅ 已完成

删除 `.next/dev/cache/turbopack`（1.3 GB），消除 SST 损坏导致的 panic。

### P1：SQLite 锁超时 + 请求缓存 ✅ 已完成

**发现**：
- SQLite 数据库 **360 MB**，WAL 模式已启用
- **缺少 `busy_timeout`**：写操作持锁时，读请求立即 SQLITE_BUSY 而非等待
- `kanban/boards` 端点无缓存，每次轮询都全量查询 360MB 数据库
- `better-sqlite3` 同步执行特性：drizzle-orm async API 是伪装，底层仍同步阻塞事件循环

**已实施修复**：

1. **添加 `busy_timeout = 5000`**（`src/core/db/sqlite.ts`）
   - 写锁持有时最多等待 5 秒，避免级联 SQLITE_BUSY
   - 单行修复，零副作用

2. **kanban/boards 请求级缓存**（`src/app/api/kanban/boards/route.ts`）
   - 3 秒 TTL 缓存，减少重复全量查询
   - POST 创建 board 时自动清除缓存
   - 与 tasks 端点的缓存策略一致

### P1.5：MCP SSE 阻塞（暂缓）

**问题**：`/api/mcp` SSE 长连接（2-7 min/请求）占用事件循环。
**代码层面**：MCP SDK streaming transport、kanban/events SSE 均为 async 非阻塞设计。
**实际瓶颈**：`better-sqlite3` 同步执行在 async 外壳下仍阻塞事件循环，导致级联延迟。

**暂缓原因**：
- MCP SSE 长连接是正常业务需求（agent 工具调用）
- 需要架构级改造（worker_threads / 独立进程）
- P1 修复（busy_timeout + 缓存）可显著缓解症状
- 影响范围：MCP 路由文件

### P2：kanban/events SSE 优化

**问题**：77 次请求全部命中 ~5min 超时，说明 SSE 连接未正常推送事件。

**方案**：
- 检查 SSE heartbeat 是否工作
- 确认事件推送路径未被阻塞
- 添加连接超时和自动重连机制
- 影响范围：`src/app/api/kanban/events/route.ts`

### P3：better-sqlite3 异步化（长期）

**问题**：`better-sqlite3` 同步执行在 drizzle-orm async API 下仍阻塞事件循环。
**方案**：将耗时查询包装在 `worker_threads` 中或评估迁移到 `sql.js`。
**影响范围**：所有直接调用 `better-sqlite3` 的代码路径。

## 影响评估

### 用户提议方案（排除 worktree 目录）的影响

**结论：无效且无副作用**

- worktree 已在项目外部（`E:/AI/routa/`），Next.js 不会监听
- 即使添加排除规则，也不解决实际问题
- 不会破坏任何现有功能，但也完全无效果

### 根治方案的影响

| 修改 | 影响范围 | 风险 | 回滚方案 |
|------|---------|------|---------|
| 清理 Turbopack 缓存 | `.next/` | 极低 | 下次编译自动重建 |
| MCP worker_threads | `api/mcp` | 中 | 保留同步 fallback |
| kanban/events 优化 | `api/kanban/events` | 低 | 恢复原 SSE 逻辑 |
| SQLite 异步化 | 全局 | 高 | wrapper 层可回退 |

### 不影响的功能

- 看板编排逻辑（WorkflowOrchestrator）
- Agent 会话管理
- Git worktree 操作
- 前端组件渲染
- API 路由定义
- CI/CD 流程

## 日志时间线

```
00:02  dev server 启动，MCP session 开始建立
00:02-00:20  MCP 请求全部 2-5min（事件循环阻塞已存在）
07:49  dev server 重启
08:09  dev server 重启
08:29  Turbopack SST 缓存损坏，首次 panic
08:29-08:35  8 次 Turbopack panic
08:36  dev server 崩溃 (exit=1)
08:36-08:37  多次重启冲突 ("Another next dev server is already running")
08:37  最终成功重启，重建缓存
09:55  dev server 重启
10:29  dev server 重启
10:49  dev server 重启（最后一次）
11:22  T7-01-B2.2 agent 修改文件（在 worktree 中，与 dev server 无关）
11:35  kanban/boards 请求 2.0min，node-cron 丢失执行
11:36  tasks 请求 2.1min，dev-login 请求 2.1min
```
