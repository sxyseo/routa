---
title: T7-01e 反馈循环根因分析 — board 缺失 stage 字段导致死循环
date: 2026-05-15
severity: P1
status: mitigated
type: analysis
related: tf24-post-zombie-fix-review-2026-05-15
---

# T7-01e 反馈循环根因分析

## 问题

T7-01e（订单详情消费端 AI 子任务）在 done→blocked→backlog→todo→dev→review→done→blocked 之间无限循环，
每次完整循环约 5 分钟。Overseer 每 5 分钟触发 unblock-dependency，但 T7-01e 的 `dependencies: []`。

**核心问题：反馈循环和依赖无关。**

## 根因：三个 bug 形成的死循环

### Bug 1：Board d9bfd11e 的 columns 缺失 `stage` 字段（数据层根因）

TypeScript 接口定义 `KanbanColumn.stage` 为必填字段（`kanban.ts:110`），且系统内建了 `DEFAULT_KANBAN_COLUMN_ORDER`（L149-155）将每个列映射到正确的 stage。但数据库中 board `d9bfd11e` 的 columns **没有 stage 字段**。

`autoAdvanceCard` 的终端守卫（`workflow-orchestrator.ts:2375`）：

```typescript
// Terminal stage guard: done/archived are end-of-flow columns.
if (currentColumn.stage === "done" || currentColumn.stage === "archived") {
  return; // ← stage=undefined 永远不匹配
}
```

**后果**：卡片从 done 列自动推进到 blocked 列（按 position 顺序的下一列）。

同样的 `stage` 检查还存在于：
- `workflow-orchestrator.ts:637`：done 列预自动化入口（PR 创建、early exit、auto-merger 注入）
- `workflow-orchestrator.ts:1427`：done 列 terminal guard（标记 COMPLETED）

三个关键守卫全部失效。

### Bug 2：Overseer 孤儿列检测无条件触发（触发层根因）

`diagnostics.ts:274-285`：

```typescript
// Detect PENDING tasks stuck in non-kanban columns (e.g. "blocked").
const nonKanbanColumns = new Set(["blocked"]);
if (task.status === "PENDING" && nonKanbanColumns.has(task.columnId ?? "")) {
  diagnostics.push({
    pattern: "dependency-block-resolved",  // ← 与真正的依赖解阻塞使用相同的 pattern
    category: "AUTO",
    taskId: task.id,
    description: `Task "${task.title}" is PENDING in non-kanban column "${task.columnId}"`,
  });
}
```

**关键点**：
1. 这个检查在 `checkOrphanInProgress` 函数中（L255-285），与 `checkDependencyBlockResolved`（L191-228）**完全独立**
2. `checkDependencyBlockResolved` 在 L206-207 有 `if (deps.length === 0) return;` 保护
3. 但 L274-285 的孤儿列检测**不检查 dependencies**——只要 PENDING + blocked 列就触发
4. 产出相同的 `pattern: "dependency-block-resolved"`，映射到 `action: "unblock-dependency"`

### Bug 3：陈旧 lane_sessions 导致 advance_only 快速推进（加速层）

当卡片从 blocked 回到 backlog 时，之前各列的 lane_sessions（status=completed/transitioned）未被清除。
LaneScanner 检测到 `allStepsCompleted=true`（`kanban-lane-scanner.ts:293-301`），发出 `advance_only` 事件，
卡片在约 30 秒内快速穿过 backlog→todo→dev→review→done。

## 完整反馈循环

```
卡片到达 done 列（正常 specialist 完成）
  → autoAdvanceCard: stage=undefined，终端守卫失效 → 推进到 blocked 列
  → blocked 列：task.status 变为 PENDING
  → Overseer diagnostics: L274-285 检测到 PENDING in blocked → "dependency-block-resolved"
  → decision-classifier: pattern 映射到 action "unblock-dependency"
  → health-tick.ts L188: columnOverride = { columnId: "backlog" } → 移到 backlog
  → LaneScanner: 检测到 stale lane_sessions → allStepsCompleted=true → advance_only
  → 卡片 ~30s 快速穿过 backlog→todo→dev→review→done
  → autoAdvanceCard 再次推进到 blocked
  → 5 分钟后 Overseer 再次 unblock
  → 循环重复
```

## 日志证据

```
[09:15:00.045] [Overseer] AUTO: Unblocked dependencies for task 55e3c501  (T7-01 父任务)
[09:15:00.063] [Overseer] AUTO: Unblocked dependencies for task 1c7aca15  (T7-01e 子任务)
[09:25:00.020] [Overseer] AUTO: Unblocked dependencies for task 55e3c501
[09:25:00.021] [Overseer] AUTO: Unblocked dependencies for task 1c7aca15
[09:30:00.042] [Overseer] AUTO: Unblocked dependencies for task 55e3c501
[09:30:00.044] [Overseer] AUTO: Unblocked dependencies for task 1c7aca15
```

T7-01e 的 session 创建记录也印证了循环（每次约 3-5 分钟一个周期）：

```
08:52:17 CRAFTER session → 08:56:29 GATE session → 09:00:20 CRAFTER → 09:03:30 GATE → 09:05:55 CRAFTER → 09:08:04 GATE → 09:10:18 DEVELOPER
```

## 依赖关系分析

| 问题 | 回答 |
|------|------|
| T7-01e 有 dependencies 吗？ | `dependencies: []`，空数组 |
| `parent_task_id` 是否触发了 dependency check？ | **否**。`checkDependencyBlockResolved`（L191-228）不检查 parent_task_id |
| 那为什么会触发 unblock-dependency？ | **L274-285 的孤儿列检测**——任何 PENDING 任务在 blocked 列都会触发，与依赖无关 |
| T7-01 父任务为什么也在循环？ | 同样原因：T7-01 也有 dependencies 但在被 Overseer 检测到 blocked 列后触发 |

**结论：与依赖无关。根因是 board 缺失 stage 字段 + Overseer 孤儿列检测无条件触发。**

## 影响范围

- **T7-01e**：持续循环浪费 specialist token（每次循环创建 CRAFTER+GATE+DEVELOPER session）
- **T7-01 父任务**（`55e3c501`）：同样在循环
- **被依赖阻塞的任务**：T7-01b、T7-02、T7-03、TF-32 全部被 `[T7-01] 前后端联调` 阻塞
- **资源浪费**：每 5 分钟 2 次 unblock + 多个 specialist session

## 修复建议

### 修复 1（根因修复，P0）：修复 board 的 stage 字段

Board `d9bfd11e` 的每个 column 需要添加正确的 `stage` 字段：

```
backlog → stage: "backlog"
todo → stage: "todo"
dev → stage: "dev"
review → stage: "review"
done → stage: "done"
blocked → stage: "blocked"
archived → stage: "archived"
```

可手动更新数据文件，或在 `KanbanBoardStore` 加载时自动填充缺失的 stage（用 `DEFAULT_KANBAN_COLUMN_ORDER` 作为 fallback）。

### 修复 2（纵深防御，P1）：autoAdvanceCard 对缺失 stage 的防御

```typescript
// workflow-orchestrator.ts:2375
const stage = currentColumn.stage ?? resolveStageFromPosition(board, currentColumn);
if (stage === "done" || stage === "archived") return;
```

### 修复 3（逻辑修正，P1）：孤儿列检测使用独立 pattern

L274-285 应使用独立的 pattern（如 `"stuck-in-blocked-column"`），而不是复用 `"dependency-block-resolved"`：
- 避免误导日志（日志显示 "Unblocked dependencies" 但实际与依赖无关）
- 允许对真正的依赖解阻塞和列卡死使用不同的处理策略

### 修复 4（可选，P2）：advance_only 前清除陈旧 lane_sessions

当卡片从非正常路径回到 backlog（如 Overseer unblock），应清除旧的 lane_sessions，
避免 advance_only 快速推进。

## 代码引用

| 文件 | 行号 | 说明 |
|------|------|------|
| `workflow-orchestrator.ts` | 2375 | autoAdvanceCard 终端守卫，stage=undefined 失效 |
| `workflow-orchestrator.ts` | 637 | done 列预自动化入口，stage=undefined 跳过 |
| `workflow-orchestrator.ts` | 1427 | done 列 terminal guard，stage=undefined 失效 |
| `diagnostics.ts` | 274-285 | 孤儿列检测，无条件触发 unblock-dependency |
| `diagnostics.ts` | 191-228 | checkDependencyBlockResolved，有 deps.length===0 保护 |
| `decision-classifier.ts` | 39 | pattern→action 映射 |
| `health-tick.ts` | 188 | columnOverride 将 blocked→backlog |
| `kanban-lane-scanner.ts` | 293-301 | allStepsCompleted 检查 |
| `kanban-lane-scanner.ts` | 329-372 | advance_only 事件发射 |
| `kanban.ts` | 105-117 | KanbanColumn 接口定义（stage 必填） |
| `kanban.ts` | 149-155 | DEFAULT_KANBAN_COLUMN_ORDER 正确 stage 映射 |

## 更新记录

### 2026-05-15 10:20 — Mitigation confirmed

- Board stage 字段已修复，终端守卫正常工作（日志确认 "Skipping auto-advance: done is a terminal stage"）
- T7-01e (`1c7aca15`) 现稳定停留在 done 列，不再循环到 blocked
- 卡片状态仍为 PENDING（应为 COMPLETED），需要后续处理
- 4个PR冲突已手动整合推送：T7-01-A, T7-01d, T7-01-B, TF-24
- 59 个任务已完成，5 个在 dev 中活跃，5 个在 todo 排队
