# 看板流水线根因确诊报告

> 日期：2026-05-12 | 基于 `private` 分支全流程代码追踪 | 修正 05-08 初版分析

---

## 一、原三大根因修复状态总览

| # | 根因 | 原影响 | 05-08 状态 | 05-12 状态 | 说明 |
|---|------|--------|-----------|-----------|------|
| 1 | Orphan-worktree 竞态写回 | ~2.8h + 配额浪费/次 | P0 活跃 | **部分修复，核心竞态仍在** | Overseer `clear-worktree-ref` 仍用非原子 `save()` |
| 2 | Stale retry 无限循环 | ~185h (65%) | P0 活跃 | **已修复** | 三道防线阻断循环 |
| 3 | Done 列无效重试 | ~28h (10%) | P1 活跃 | **已修复** | Terminal guard + atomicUpdate + PR-settled guard |

---

## 二、根因 1 深度确诊：Orphan-Worktree 竞态写回

### 2.1 结论：竞态写回仍然活跃

原分析中「去重窗口 5min 不是根因」的判断正确。5min 去重窗口本身设计合理——问题出在写入侧。

### 2.2 完整竞态链路追踪

三个写入者参与竞态，全部使用非原子 `save()`：

```
写入者 A — Overseer clear-worktree-ref
写入者 B — DoneLaneRecovery 多个恢复路径
写入者 C — WorktreeCleanup listener
```

#### 写入者 A：Overseer（`src/core/overseer/health-tick.ts:163-170`）

```ts
case "clear-worktree-ref": {
  const task = await system.taskStore.get(decision.taskId);  // ① 读取整个 task
  if (task) {
    task.worktreeId = undefined;                             // ② 修改内存对象
    await system.taskStore.save(task);                       // ③ 写回整个 task（非原子）
  }
  break;
}
```

**问题**：`get → modify → save` 是经典的 TOCTOU（Time-of-check to Time-of-use）竞态。`save()` 会写入整个 task 对象（包括所有未变更字段），不检查 version。

#### 写入者 B：DoneLaneRecovery（`src/core/kanban/done-lane-recovery-tick.ts`）

**不 re-fetch 就 save 的路径（竞态高风险）**：

| 行号 | 函数 | 操作 |
|------|------|------|
| `:280` | `recoverWebhookMissed` | `save(task)` — task 来自外层循环，**未 re-fetch** |
| `:309` | `recoverWebhookMissed` → rebase-resolver | `save(task)` — 同一 stale task |
| `:321` | `recoverWebhookMissed` → conflict-resolver | `save(task)` — 同一 stale task |
| `:332` | `recoverWebhookMissed` → auto-merger | `save(task)` — 同一 stale task |
| `:348` | `recoverWebhookMissed` → unknown mergeability | `save(task)` — 同一 stale task |
| `:421` | `recoverCbExhausted` | `save(task)` — 同一 stale task |

**re-fetch 后 save 的路径（竞态低风险，但仍非原子）**：

| 行号 | 函数 | 操作 |
|------|------|------|
| `:570` | `triggerConflictResolver` | re-fetch 后 `save(freshTask)`，但无 version check |
| `:616` | `triggerAutoMerger` | re-fetch 后 `save(freshTask)`，但无 version check |
| `:685` | `triggerAutoMerger` success | re-fetch 后 `save(freshTask)`，但无 version check |
| `:808` | `recoverOrphanInProgress` | re-fetch 后 `save(fresh)`，但无 version check |
| `:827` | `recoverAutomationLimitExhausted` | re-fetch 后 `save(fresh)`，但无 version check |
| `:1248` | `review_degraded` | re-fetch 后 `save(freshDegraded)`，但无 version check |

#### 写入者 C：WorktreeCleanup（`src/core/kanban/worktree-cleanup.ts:49-54`）

```ts
const task = await system.taskStore.get(taskId);
if (task && task.worktreeId === worktreeId) {
  task.worktreeId = undefined;
  task.updatedAt = new Date();
  await system.taskStore.save(task);   // 非原子 save
}
```

### 2.3 竞态时序图

```
时间轴    Overseer (每5min)              DoneLaneRecovery (每10min)
─────────────────────────────────────────────────────────────────
T0        读取 task (worktreeId="wt-123",
          version=10)
T1                                        读取 task 列表，task 进入
                                          stuckItems 数组
T2        task.worktreeId = undefined
          save(task, version=10) ✓
          → worktreeId 被清除
T3                                        遍历到该 task（stale 对象，
                                          worktreeId 仍为 "wt-123"）
T4                                        recoverWebhookMissed:
                                          task.pullRequestMergedAt = now
                                          save(task) ← 写回整个 task
                                          → worktreeId 被恢复为 "wt-123"!

T5        去重窗口 5min 内 → 跳过
T10       去重窗口过期 → 重新检测
          → 又发现 orphan-worktree
          → 又清除 worktreeId
T11       ... DoneLaneRecovery 下一个 tick
          → 又写回 ... 无限循环
```

### 2.4 量化影响（基于代码分析）

- Overseer tick 每 5 分钟运行一次
- DoneLaneRecovery tick 每 10 分钟运行一次
- 每轮竞态浪费：1 次 Overseer 清除（无效） + 1 次 DoneLaneRecovery 写回（覆盖）
- `MAX_AUTO = 20`：每个 tick 最多处理 20 个 AUTO 决策
- 如果 57 个已完成任务仍带 orphan worktreeId（原分析数据），每轮 tick 最多清理 20 个，下一轮 DoneLaneRecovery 写回 → **永远清理不完**

### 2.5 去重窗口为什么不是根因

`overseer-state-store.ts:42` 的 `DEDUP_WINDOW_MS = 5 * 60 * 1000` 是**正确的设计**：

1. 去重防止同一 task 在 5 分钟内被重复处理 → 避免 Overseer 和 LaneScanner 同时处理同一 task
2. 5 分钟窗口过后重新检测是**合理的**——如果 worktree 真的被删除了，task 的 worktreeId 应该保持 undefined
3. **问题不在于"为什么 5 分钟后又检测到了"**，而在于 **"为什么清除的 worktreeId 又回来了"**

**根因是写入侧**：Overseer 清除 worktreeId 后，DoneLaneRecovery 用 stale task 对象的 `save()` 把旧 worktreeId 写回了。

---

## 三、根因 2 确诊：Stale Retry 无限循环 —— 已修复

### 3.1 修复确认

循环已被三道防线完全阻断：

**防线 1：WorkflowOrchestrator 拦截 review-degraded 转换**
```ts
// workflow-orchestrator.ts:534
if (source?.type === "review_degraded") {
  return;  // 直接跳过，不再创建 session
}
```

**防线 2：DoneLaneRecovery 终结 review-degraded 任务**
```ts
// done-lane-recovery-tick.ts:1246-1248
freshDegraded.status = TaskStatus.COMPLETED;
freshDegraded.lastSyncError = undefined;
await system.taskStore.save(freshDegraded);
```

**防线 3：LaneScanner 跳过 COMPLETED 任务**
```ts
// kanban-lane-scanner.ts:175
if (task.status === "COMPLETED" || task.status === "BLOCKED" || task.status === "CANCELLED") {
  continue;
}
```

### 3.2 旧循环 vs 新行为

```
旧流程（无限循环）：
  stale retry 1/3 → 2/3 → 3/3 → review-degraded
  → DoneLaneRecovery 清除标记 → LaneScanner 重新拾取
  → stale retry 1/3 → 2/3 → 3/3 → review-degraded（再次）
  → 无限循环...

新流程（终结）：
  stale retry 1/3 → 2/3 → 3/3 → review-degraded
  → WorkflowOrchestrator 拦截 review_degraded source → 不再入队
  → DoneLaneRecovery 标记 COMPLETED
  → LaneScanner 跳过 COMPLETED → 结束
```

### 3.3 额外防护

| 防护机制 | 位置 | 说明 |
|---------|------|------|
| Circuit breaker | `workflow-orchestrator.ts:866-898` | `sessionFailureCounts >= 3` → 阻止新 session |
| Stale retry limit | `workflow-orchestrator.ts:1689` | `staleMaxRetries = 3` → 到达上限标记 review-degraded |
| CB cooldown reset | `kanban-config.ts:83` | `cbMaxCooldownResets = 5` → 最多重置 5 次后永久跳过 |
| Non-dev repeat limit | `workflow-orchestrator.ts:231` | `nonDevRepeatLimit = 3` + 30min 时间窗口衰减 |

---

## 四、根因 3 确诊：Done 列无效重试 —— 已修复

### 4.1 修复确认

**Terminal Guard（原子写入）**：
```ts
// workflow-orchestrator.ts:1351-1377
if (freshTask.version !== undefined && this.taskStore.atomicUpdate) {
  await this.taskStore.atomicUpdate(cardId, freshTask.version, {
    status: "COMPLETED",
    lastSyncError: undefined,
  });
}
```

**Done-lane PR-settled guard**：
```ts
// kanban-lane-scanner.ts:182-221
if (task.pullRequestUrl && columnStageMap.get(task.columnId) === "done") {
  const isPRSettled = task.pullRequestMergedAt
    || task.pullRequestUrl === "manual"
    || task.pullRequestUrl === "already-merged";
  if (isPRSettled) continue;  // 跳过已结算的 done 列卡片
}
```

**Done-lane early exit**：
```ts
// workflow-orchestrator.ts:627-648
if (isFullyDone) {
  await this.taskStore.atomicUpdate(data.cardId, freshTask.version, {
    status: "COMPLETED",
    lastSyncError: undefined,
  });
  return;  // 跳过 done-lane 自动化
}
```

---

## 五、新发现的残留问题

### 5.1 P1：Overseer 所有 AUTO 操作均使用非原子 save()

**位置**：`src/core/overseer/health-tick.ts:134-238`

所有 6 个 AUTO action 都使用 `get → modify → save` 模式：

| Action | 行号 | 风险 |
|--------|------|------|
| `clear-trigger-session` | `:139-146` | 中 — 可能写回 stale worktreeId/laneSessions |
| `clear-pending-marker` | `:149-160` | 低 — 只改 comment |
| `clear-worktree-ref` | `:163-170` | **高** — 竞态写回 worktreeId（本报告核心问题） |
| `unblock-dependency` | `:173-197` | 中 — 可能写回 stale worktreeId |
| `retry-version-conflict` | `:200-209` | 中 — 手动递增 version 不靠谱 |
| `reset-orphan-session` | `:212-232` | 中 — 可能写回 stale worktreeId |

### 5.2 P2：WorktreeCleanup 非原子 save()

**位置**：`src/core/kanban/worktree-cleanup.ts:49-54`

与 Overseer `clear-worktree-ref` 存在相同模式的竞态。但 WorktreeCleanup 通过事件触发（不是定时轮询），频率较低，影响较小。

### 5.3 P3：DoneLaneRecovery ~6 处不 re-fetch 就 save()

**位置**：见 2.2 节表格

`recoverWebhookMissed` 和 `recoverCbExhausted` 使用外层循环的 stale task 对象，在 Overseer/WorktreeCleanup 并发清除 worktreeId 后会写回旧值。

---

## 六、修复建议（按优先级）

### P0：Overseer AUTO 操作改用 safeAtomicSave()

将 `health-tick.ts` 的 6 个 AUTO action 全部从 `get → modify → save` 改为 `safeAtomicSave()`：

```ts
// 修复前（health-tick.ts:163-170）
case "clear-worktree-ref": {
  const task = await system.taskStore.get(decision.taskId);
  if (task) {
    task.worktreeId = undefined;
    await system.taskStore.save(task);
  }
  break;
}

// 修复后
case "clear-worktree-ref": {
  const task = await system.taskStore.get(decision.taskId);
  if (task) {
    await safeAtomicSave(task, system.taskStore, {
      worktreeId: null,
      updatedAt: new Date(),
    }, "Overseer clear-worktree-ref");
  }
  break;
}
```

**预期效果**：
- Overseer 的 `clear-worktree-ref` 不再被 DoneLaneRecovery 的 stale save 覆盖
- version conflict 时自动重试一次，不再需要 `retry-version-conflict` action
- 消除 Overseer ↔ DoneLaneRecovery / WorktreeCleanup 之间的所有竞态

### P1：DoneLaneRecovery `recoverWebhookMissed` / `recoverCbExhausted` 改用 safeAtomicSave()

6 处不 re-fetch 就 save 的路径改为：
```ts
// 修复前
await system.taskStore.save(task);

// 修复后
await safeAtomicSave(task, system.taskStore, {
  pullRequestMergedAt: task.pullRequestMergedAt,
  lastSyncError: undefined,
  updatedAt: new Date(),
}, "DoneLaneRecovery webhook-missed");
```

**注意**：`safeAtomicSave` 的 `undefined → null` 转换确保 Drizzle ORM 正确清除字段。

### P2：WorktreeCleanup 改用 safeAtomicSave()

```ts
// 修复后
await safeAtomicSave(task, system.taskStore, {
  worktreeId: null,
  updatedAt: new Date(),
}, "WorktreeCleanup");
```

---

## 七、附录：代码位置速查表

| 文件 | 关键位置 | 说明 |
|------|---------|------|
| `src/core/overseer/health-tick.ts` | `:163-170` | `clear-worktree-ref` 非原子 save |
| `src/core/overseer/health-tick.ts` | `:139-146` | `clear-trigger-session` 非原子 save |
| `src/core/overseer/health-tick.ts` | `:173-197` | `unblock-dependency` 非原子 save |
| `src/core/overseer/health-tick.ts` | `:200-209` | `retry-version-conflict` 非原子 save |
| `src/core/overseer/health-tick.ts` | `:212-232` | `reset-orphan-session` 非原子 save |
| `src/core/overseer/decision-classifier.ts` | `:37` | `orphan-worktree → clear-worktree-ref` 映射 |
| `src/core/overseer/decision-classifier.ts` | `:48` | `MAX_AUTO = 20` 每 tick 最多 20 个 |
| `src/core/overseer/diagnostics.ts` | `:158-186` | `checkOrphanWorktree` 检测逻辑 |
| `src/core/overseer/overseer-state-store.ts` | `:42` | `DEDUP_WINDOW_MS = 5min` |
| `src/core/kanban/done-lane-recovery-tick.ts` | `:280` | `recoverWebhookMissed` stale save |
| `src/core/kanban/done-lane-recovery-tick.ts` | `:309,321,332,348` | 同上，多个分支 |
| `src/core/kanban/done-lane-recovery-tick.ts` | `:421` | `recoverCbExhausted` stale save |
| `src/core/kanban/worktree-cleanup.ts` | `:49-54` | WorktreeCleanup 非原子 save |
| `src/core/kanban/workflow-orchestrator.ts` | `:534` | review-degraded 拦截（已修复） |
| `src/core/kanban/workflow-orchestrator.ts` | `:1296` | atomicUpdate + mergeLaneSessions（已修复） |
| `src/core/kanban/workflow-orchestrator.ts` | `:1351` | terminal guard atomicUpdate（已修复） |
| `src/core/kanban/kanban-lane-scanner.ts` | `:175` | COMPLETED 跳过（已修复） |
| `src/core/kanban/kanban-lane-scanner.ts` | `:182-221` | PR-settled guard（已修复） |
| `src/core/kanban/atomic-task-update.ts` | `:28-65` | `safeAtomicSave()` 工具函数 |
| `src/core/kanban/sync-error-writer.ts` | `:1-247` | 统一 error 格式化 + 解析 |
