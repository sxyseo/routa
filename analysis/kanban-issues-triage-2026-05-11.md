# 看板流水线问题分级与修复计划

> 日期：2026-05-11 | 来源：kanban-issues.md + pipeline-root-cause + pipeline-monitoring 三份文档交叉验证
> 验证方式：逐一检查相关源码确认修复状态

---

## 一、已解决，无需再处理（8 个）

| 问题 | 验证结果 |
|------|---------|
| Issue 1: Windows TEMP `\r` | `safeTmpdir.ts` 已根治 |
| Issue 16: Auto-merger prompt 设计缺陷 | Activation Gate 已移除，逻辑迁入 WorkflowOrchestrator |
| Issue 14: WIP Limit 死锁 | 已有死锁恢复机制 |
| Issue 18: 僵尸任务检测 | LaneScanner 有孤儿检测，阈值 3 分钟 |
| P1: Structural skip 计数 | 已排除在 failures 计数外 |
| Issue 13: PrAutoCreate Version Conflict | 已有 3 次重试逻辑 |
| 循环依赖检测 | GraphRefiner 能检测并跳过循环 |
| Issue 12: Forbidden-term 注释误报 | 临时修复（注释改写），非平台级修复但可接受 |

---

## 二、必须解决（3 个）— 不修将反复阻塞流水线

### P0-1: DoneLaneRecovery 仍存在自锁死风险

**现状**：改进了但未根治。auto-merger 会话活跃时仍会跳过该任务的恢复检测，只是加了超时保护（10 分钟 auto-merger timeout）。

**为什么必须修**：auto-merger 超时是 10 分钟，DoneLaneRecovery tick 也是 10 分钟，两个计时器对齐时仍可能产生 15-20 分钟延迟。在长依赖链（6 层）下，每层累积 15 分钟 = 额外 1.5 小时。

**修复方向**：`recoverWebhookMissed` 中**优先调 GitHub API 验证 PR 状态**，不因活跃会话而跳过。auto-merger 活跃 ≠ PR 未合并。

**涉及代码**：
- `src/core/kanban/done-lane-recovery-tick.ts` — 活跃会话跳过逻辑（L142-160）
- `src/core/kanban/kanban-config.ts` — tick 间隔配置

---

### P0-2: 依赖门控传递延迟

**现状**：`pr-merge-listener.ts` 已实现 webhook 直接触发下游 unblock，但仅对显式依赖生效。

**为什么必须修**：文档中量化的最大瓶颈——66% 壁钟时间在等待依赖传递。当前每层仍需 25-40 分钟（tick 检测 + session 启动）。如果能降到 5 分钟/层，6 层依赖链从 3.5 小时降到 30 分钟。

**修复方向**：PR merge 事件 → 直接回调 `dependencyGate.unblock(taskId)` → 触发 LaneScanner 即时扫描下游，不再等 10 分钟 tick。

**涉及代码**：
- `src/core/kanban/pr-merge-listener.ts` — PR 合并监听
- `src/core/kanban/workflow-orchestrator.ts` — 依赖门控
- `src/core/kanban/kanban-lane-scanner.ts` — 列扫描

---

### P0-3: Auto-merger Bash 工具间歇性失败

**现状**：Issue 10 部分修复了 `process.env.TEMP` 写回，但报告显示后续 Bash 调用仍间歇性失败。

**为什么必须修**：auto-merger 依赖 Bash 执行 `gh pr merge`。间歇性失败 = 合并流程不可靠 = 所有 PR 可能需要手动合并。这是 Issue 9/16 的底层原因之一。

**修复方向**：确认 `process.env.TEMP/TMP` 写回是否在 SDK 子进程 fork 之前生效；或 auto-merger 改用 GitHub API（REST/GraphQL）直接合并，绕过 Bash。

**涉及代码**：
- `src/core/acp/claude-code-sdk-adapter.ts` — 环境变量写回
- `src/core/kanban/done-lane-recovery-tick.ts` — auto-merger 触发逻辑

---

## 三、需要再次解决（4 个）— 非阻塞但影响效率

### P1-1: Review Guard 无降级策略（Issue 17）

**现状**：stale retry 达上限后，任务**永远卡在 Review 列**，无自动通过或人工标记。

**影响**：Review 列成为隐性瓶颈，依赖该任务完成的所有下游任务被阻塞。

**修复方向**：stale retry 达上限后标记为 `[review-degraded]`，允许 auto-pass（带 warning）或提升为手动审查队列。

**涉及代码**：
- `src/core/kanban/workflow-orchestrator.ts` — stale retry 逻辑

---

### P1-2: PR 冲突热点文件（100% 冲突率）

**现状**：`index.ts` 路由注册仍是冲突热点。所有并行任务都修改同一文件。

**影响**：36% 任务触发 conflict-resolver，每个耗时 2-6 分钟。这是项目架构问题而非平台问题。

**修复方向**：架构解耦 — 路由自动注册（文件扫描加载），每个任务只创建独立路由文件。

**备注**：这是被开发项目的架构问题，非 Routa 平台问题。通过 specialist prompt 引导即可。

---

### P1-3: Forbidden-term 上下文感知

**现状**：`forbiddenTerms` 不区分注释和代码，仍可能误报。

**影响**：pre-gate blocker 误报 → 任务被错误拦截 → 需人工介入。

**修复方向**：pre-gate-checker 在扫描前先过滤注释行（`//` 和 `/* */` 块）。

**涉及代码**：
- `src/core/kanban/pre-gate-checker.ts` — 禁用词扫描逻辑

---

### P2-1: DoneLaneRecovery 不扫描 Blocked 列（Issue 19）

**现状**：`isDoneColumn()` 排除了 blocked 列，PR 已合并的任务若被移到 blocked 将永远卡住。

**影响**：低频但致命 — 任务永久停滞，需手动发现和修复。

**修复方向**：DoneLaneRecovery 增加 blocked 列检查，或 Done Finalizer 不将 PR 已合并的任务移入 blocked。

**涉及代码**：
- `src/core/kanban/done-lane-recovery-tick.ts` — `isDoneColumn()` 逻辑

---

## 修复优先级矩阵

| 优先级 | 问题 | 预期收益 | 实现难度 | 状态 |
|--------|------|---------|---------|------|
| **P0-3** | Auto-merger Bash 间歇性失败 | 消除手动合并 | 中 | 待修复 |
| **P0-1** | DoneLaneRecovery 自锁死 | -15 min/层 | 低 | 待修复 |
| **P0-2** | 依赖门控即时 unblock | -20 min/层 | 中 | 待修复 |
| **P1-1** | Review Guard 降级策略 | 消除隐性瓶颈 | 低 | 待修复 |
| **P1-3** | Forbidden-term 注释过滤 | 减少 pre-gate 误报 | 低 | 待修复 |
| **P2-1** | Blocked 列扫描 | 消除永久卡死 | 低 | 待修复 |
| **P1-2** | 路由架构解耦 | -2~6 min/任务 | 中（项目级） | 待修复 |

---

## 修复执行记录

| 日期 | 问题 | 修复方式 | PR/Commit |
|------|------|---------|-----------|
| 2026-05-11 | P0-1: DoneLaneRecovery 自锁死 | detectStuckPatterns 改 async，跳过前检查 PR 状态 | 待提交 |
| 2026-05-11 | P0-2: 依赖门控即时 unblock | PR merge 后触发即时 Lane Scanner 扫描 | 待提交 |
| 2026-05-11 | P0-3: Auto-merger 改用 GitHub REST API | 新建 github-merge.ts，triggerAutoMerger 直接调 API 合并 | 待提交 |
| 2026-05-11 | P1-1: Review Guard 降级策略 | stale retry 达上限后标记 review-degraded，DoneLaneRecovery auto-pass | 待提交 |
| 2026-05-11 | P1-3: Forbidden-term 注释过滤 | scanForPattern 增加 skipComments 选项，checkForbiddenTerms 启用 | 待提交 |
| 2026-05-11 | P2-1: Blocked 列扫描 | detectStuckPatterns 对 blocked 列中已合并 PR 任务触发恢复 | 待提交 |
