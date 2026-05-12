# 深度确诊报告：[T7-01] 拆分后父任务立即归档，下游依赖链断裂

**日期**：2026-05-12
**严重程度**：P0 — 系统性守卫缺失 + Agent 行为缺陷双重叠加

---

## 1. 现象

[T7-01] 前后端联调（30 页面全量联调）于 **21:33** 被拆分为 5 个子任务。**1 分钟后**（21:34），父任务 T7-01 状态变为 `ARCHIVED`，column 变为 `archived`。

此时 5 个子任务全部为 `PENDING`（backlog/todo），无任何子任务被执行。

**连锁效应**：

| 下游任务 | 依赖 T7-01 | T7-01 归档后状态 | 后果 |
|---------|-----------|----------------|------|
| 创建部署配置文件模板 | `→ f926f21d` | `REVIEW_REQUIRED`（review 列） | 联调未做就已部署 |
| [T7-03] Spec-to-Code 全量校验 | `→ f926f21d` | `IN_PROGRESS`（dev 列） | 全量校验在联调未完成时启动 |
| [TF-32] E2E 核心流程验证 | `→ f926f21d` + 28 个 | `PENDING`（backlog） | 依赖 T7-01 已满足，随时可被 pickup |

**核心问题**：T7-01 是项目的最终集成门（50 个前置开发任务的汇聚点）。它的提前归档导致后续验证任务被"放行"，跳过了联调验证阶段。

---

## 2. 时间线还原

```
02:04  T7-01 创建（PENDING，50 个前置依赖）
21:30  大批开发任务标记 COMPLETED（TF-06/07/17/22, T4-04a~d, T6-01a/b 等）
       → T7-01 的 50 个依赖全部满足
21:3?  LaneScanner pickup T7-01，启动 session
       → Agent 判断任务过大，执行拆分
21:33  5 个子任务创建：
         T7-01a 商户核心（7 页）→ todo 列
         T7-01b 商户运营（7 页）→ backlog
         T7-01c AI 功能（5 页）→ backlog
         T7-01d 消费者核心（6 页）→ backlog
         T7-01e 消费者辅助（5 页）→ backlog
21:34  T7-01 状态变更为 ARCHIVED, column 变为 archived ← 🔴 关键异常
21:35  其他已完成任务（Rust 后端 E1, F2）被归档
21:48  T7-03 启动（IN_PROGRESS）← 不应启动
21:52  部署配置任务进入 REVIEW_REQUIRED ← 不应启动
```

---

## 3. 根因确诊：逐条排除后锁定两条路径

### 3.1 排除 `auto-archive-tick`

`auto-archive-tick.ts:58-87` 的 `isCardOldEnough` 要求任务在 done 列停留超过 **30 天**（`DEFAULT_AUTO_ARCHIVE_DAYS = 30`）。T7-01 当天创建当天归档，不可能满足。

此外，`ROUTA_AUTO_ARCHIVE_ENABLED` 环境变量控制（`:149`），默认关闭。

**结论**：排除。

### 3.2 排除 `autoAdvanceCard`

`workflow-orchestrator.ts:2257-2263` 有 terminal stage guard：

```typescript
if (currentColumn.stage === "done" || currentColumn.stage === "archived") {
  console.log(`Skipping auto-advance: ${currentColumn.stage} is a terminal stage.`);
  return;
}
```

done 列的任务不会被 `autoAdvanceCard` 推进到 archived 列。

**结论**：排除。

### 3.3 排除 `DoneLaneRecovery`

DoneLaneRecovery 只处理 **done 列**的任务（`done-lane-recovery-tick.ts` 只扫描 columnId === done 的任务）。T7-01 拆分前在 done 列，但归档时 column 变为 archived。DoneLaneRecovery 不可能处理已归档的任务。

此外，DoneLaneRecovery 的操作（merged/conflict/auto-merger）不包含归档动作。

**结论**：排除。

### 3.4 排除 `parent-child-lifecycle` 的 `advanceParentToReview`

`parent-child-lifecycle.ts:73-78` 只在所有子任务 COMPLETED 时触发：

```typescript
const allCompleted = allChildren.every(c => c.status === TaskStatus.COMPLETED);
if (allCompleted) {
  return await advanceParentToReview(parentTask, deps);
}
```

5 个子任务全部 PENDING，不满足条件。

**结论**：排除。

### 3.5 ✅ 确诊路径 A（主因）：Agent Session 完成后的 terminal-lane guard

**代码路径**：`workflow-orchestrator.ts:1357-1404`

当 Agent session 在 done 列完成时：

```
session 完成 → automation.status === "completed"
  && automation.stage === "done"
  && doneCol?.stage === "done" → isTerminalStage = true
  && freshTask.status !== "COMPLETED"
→ 执行：status = "COMPLETED", lastSyncError = undefined
```

**这会将 T7-01 标记为 COMPLETED（仍在 done 列），但不会移动到 archived 列。**

### 3.6 ✅ 确诊路径 B（归档动作本身）：Agent 直接调用 `move_card` 或 archive API

T7-01 从 done 列到 archived 列的**列变更**只能通过以下两种方式：

**方式 1 — Agent 调用 `move_card` 工具**：

`kanban-tools.ts:228` 的 `moveCard` 方法可以将任务移到任何列（包括 archived）。Agent 在拆分后可能认为"拆分=完成"，直接调用 `move_card(cardId, archivedColumnId)`。

虽然 `agent-trigger.ts:185` 有指令：
```
"This card is in a terminal column. Do not call move_card."
```
但 Agent 在拆分后可能忽略了这条约束。

**方式 2 — Agent 调用 `/api/kanban/boards/[boardId]/archive` API**：

`archive-task.ts:128-179` 的 `archiveDoneTasks()` **没有时间限制**（不同于 auto-archive-tick 的 30 天）。只要有 `taskIds` 参数，可以直接归档指定任务。

**综合判定**：**路径 A（terminal-lane guard 设 COMPLETED）+ 路径 B（Agent 调用 move_card/archive）** 是 T7-01 归档的完整链路。

---

## 4. 系统性缺陷：三层守卫全部缺失

### 缺陷 1：拆分后父任务无状态保护

`task-split-orchestrator.ts:249-251`：

```typescript
parentTask.splitPlan = splitPlan;
parentTask.updatedAt = new Date();
await deps.taskStore.save(parentTask);
// ↑ 不设守卫标记、不改状态、不改列
```

拆分后父任务保持原始 columnId 和 status，看起来和普通完成无异。

### 缺陷 2：terminal-lane guard 不检查子任务状态

`workflow-orchestrator.ts:1357-1404`：

```typescript
if (automation.status === "completed" && task && automation.stage === "done") {
  // ↓ 没有检查 task.splitPlan?.childTaskIds
  if (isTerminalStage && freshTask.status !== "COMPLETED") {
    // 直接设 COMPLETED
  }
}
```

即使父任务有未完成的子任务，session 完成后仍被标记 COMPLETED。

### 缺陷 3：`move_card` / `archiveDoneTasks` 不检查子任务状态

`kanban-tools.ts:228` 的 `moveCard` 和 `archive-task.ts:43` 的 `archiveTask` 都不检查 `splitPlan`：

```typescript
// archive-task.ts — 归档前只检查：
if (hasPendingAutomation(task)) { skip; }  // 不检查子任务
if (hasOpenPR(task)) { skip; }             // 不检查子任务
// → 直接归档
```

### 缺陷间的交互

三层守卫缺失形成完整故障链：

```
拆分 → 父任务无保护标记（缺陷1）
     → session 完成 → terminal guard 设 COMPLETED（缺陷2）
     → Agent 调用 move_card/archive → 直接归档（缺陷3）
     → 下游依赖解除 → T7-03/部署任务提前启动
```

---

## 5. 附随问题：子任务质量缺陷

### 5.1 子任务间无依赖（P1）

| 子任务 | dependencies | 应有依赖 |
|--------|-------------|---------|
| T7-01a 商户核心 | `[]` | 无（根节点） |
| T7-01b 商户运营 | `[]` | → T7-01a |
| T7-01c AI 功能 | `[]` | 无（独立） |
| T7-01d 消费者核心 | `[]` | 无（根节点） |
| T7-01e 消费者辅助 | `[]` | → T7-01d |

**原因**：LLM 生成 `fan_in` 策略时所有 `dependencyEdges = []`。`task-split-orchestrator.ts:178-190` 只处理 LLM 声明的边，不做自动推断。

### 5.2 子任务未继承父任务外部依赖（P1）

`task-split-orchestrator.ts:192-210` 不传递 `parentTask.dependencies`。50 个前置开发任务作为外部约束被丢弃。

### 5.3 子任务描述过于模板化（P2）

5 个子任务的 objective 格式完全一致，仅页面列表不同。缺失验收标准（acceptanceCriteria 空）和验证命令。

---

## 6. 修复方案

### P0：三层守卫补全

**守卫 1 — 拆分时设置保护标记**：

文件：`task-split-orchestrator.ts:249`

```typescript
parentTask.splitPlan = splitPlan;
parentTask.lastSyncError = `[Split] Waiting for ${childTaskIds.length} child tasks to complete.`;
parentTask.updatedAt = new Date();
await deps.taskStore.save(parentTask);
```

**守卫 2 — terminal-lane guard 检查子任务**：

文件：`workflow-orchestrator.ts:1368`

```typescript
// 在 isTerminalStage && freshTask.status !== "COMPLETED" 之间插入：
const splitPlan = freshTask.splitPlan;
if (splitPlan?.childTaskIds?.length) {
  const allChildrenDone = await checkAllChildrenCompleted(splitPlan.childTaskIds);
  if (!allChildrenDone) {
    console.log(`Skipping COMPLETED: ${childTaskIds.length} child tasks still pending.`);
    continue; // 不标记 COMPLETED
  }
}
```

**守卫 3 — archiveTask 检查子任务**：

文件：`archive-task.ts:43` 和 `kanban-tools.ts:228`

```typescript
// 归档前检查
if (task.splitPlan?.childTaskIds?.length) {
  // 查询所有子任务状态
  for (const childId of task.splitPlan.childTaskIds) {
    const child = await taskStore.get(childId);
    if (child && child.status !== TaskStatus.COMPLETED) {
      return { success: false, error: `Child task ${childId} not completed` };
    }
  }
}
```

### P1：子任务依赖传递

文件：`task-split-orchestrator.ts:178-190`

拆分时将父任务的 `dependencies` 传给根节点子任务（无入边的节点）。

### P1：Agent prompt 增强

文件：`agent-trigger.ts` 中对 terminal column 的指令，增加拆分感知：

```
"If this task has been split (splitPlan exists), do NOT archive or complete it.
 The parent task must remain until all child tasks are completed."
```

---

## 7. 影响范围

此问题是**系统性缺陷**，影响所有满足以下条件的任务：

1. 任务在 done 列（terminal stage）
2. Agent session 执行了拆分操作
3. 拆分后 session 正常完成

**当前看板中所有带 `splitPlan` 的任务都应检查**。特别是网关任务（GATE 类型的多依赖汇聚点），它们的提前归档会导致依赖链断裂，下游任务被放行。

---

## 8. 当前数据修复

| 操作 | 任务 | 修改 |
|------|------|------|
| 恢复父任务 | T7-01 | status: ARCHIVED → IN_PROGRESS, column: archived → todo |
| 暂停 T7-03 | T7-03 | status: IN_PROGRESS → PENDING, 清除 triggerSessionId |
| 暂停部署任务 | 部署配置 | status: REVIEW_REQUIRED → PENDING |
| 添加子任务依赖 | T7-01b | dependencies: [] → [T7-01a.id] |
| 添加子任务依赖 | T7-01e | dependencies: [] → [T7-01d.id] |
