# 看板全流程根因诊断 (2026-05-12)

## 全景概述

对 Routa 看板自动化流水线进行全流程代码审计，从任务创建到代码合并 main 的完整生命周期。

---

## 一、任务完整生命周期

```
backlog ──→ todo ──→ dev ──→ review ──→ done
  │           │        │        │         │
  │           │        │        │         └→ Done Finalizer (LLM Agent)
  │           │        │        │              ├─ Phase 1: Review 入口检查
  │           │        │        │              ├─ Phase 2: PR 发布 (push + gh pr create)
  │           │        │        │              └─ Phase 3: Completion Summary
  │           │        │        │
  │           │        │        └→ Review Guard (LLM Agent)
  │           │        │
  │           │        └→ Dev Crafter (LLM Agent, 在 worktree 中编码)
  │           │
  │           └→ Todo Orchestrator (LLM Agent)
  │
  └→ Backlog Refiner (LLM Agent)
```

**每个阶段对应一个 LLM Agent 会话**，通过 ACP (Agent Communication Protocol) 与 Claude SDK 通信。

---

## 二、并发控制机制

### 关键配置 (`kanban-config.ts`)

| 参数 | 默认值 | 环境变量 |
|------|--------|---------|
| **并发会话上限** | **2** | `ROUTA_SESSION_CONCURRENCY_LIMIT` |
| stale 重试上限 | 3 | `ROUTA_STALE_MAX_RETRIES` |
| stale 检测阈值 | 60,000ms (60s) | `ROUTA_STALE_QUEUED_THRESHOLD_MS` |
| orphan 检测年龄 | 180,000ms (3min) | `ROUTA_ORPHAN_AGE_MS` |
| PR 创建重试上限 | 3 | `ROUTA_PR_RETRY_LIMIT` |
| circuit-breaker 冷却 | 300,000ms (5min) | `ROUTA_SESSION_RETRY_RESET_MS` |
| circuit-breaker 最大重置 | 5 | `ROUTA_CB_MAX_COOLDOWN_RESETS` |

### 并发限制实现 (`kanban-session-queue.ts:100-128`)

```typescript
const limit = await this.getConcurrencyLimit(job.workspaceId, job.boardId);
const runningCount = await this.countRunning(job.boardId, job.workspaceId);

if (runningCount >= limit) {
  this.pushQueuedEntry(entry);  // 排队等待
  return { queued: true };
}
```

**`countRunning` 计数**：
- 内存中 `status === "running"` 的队列条目
- 加上数据库中 `triggerSessionId` 已设置或 `lane_sessions` 中有 running 会话的孤立任务
- **2 小时前的 running 会话视为过期**，不阻塞队列

---

## 三、Stale Retry 完整机制 (`workflow-orchestrator.ts:1652-1721`)

```
排队(queued) → 等待 staleQueuedThresholdMs (60s)
  → stale retry 1/3 → 重新排队
  → 等待 120s (指数退避)
  → stale retry 2/3 → 重新排队
  → 等待 240s
  → stale retry 3/3 → 标记 review-degraded
```

**标记 review-degraded 时做了什么**：
1. 设置 `lastSyncError = "[review-degraded] Stale retry limit (3) reached..."`
2. 从 `activeAutomations` 中删除
3. 触发 `review_degraded` 类型的事件

**问题：标记 review-degraded 后不会重置 `staleRetryCount`**。当 DoneLaneRecovery auto-pass 清除 `lastSyncError` 后，LaneScanner 重新触发 → 重新排队 → 继承旧计数器 → 直接跳到 4/3 → 立即再次 review-degraded。

**日志证据**：
```
stale retry 4/3 → review-degraded  (应该到 3/3 就停止)
```

---

## 四、PR 创建的 3 条路径（只有第 1 条可靠工作）

### 路径 1: Done Finalizer Specialist (LLM Agent)
- **文件**: `routa-specialists/done-finalizer.yaml`
- **触发**: 任务从 review 列进入 done 列时
- **步骤**: git push → gh pr create → 更新 task
- **问题**: 网络超时时降级为 `"manual"`，不再重试
- **问题**: 服务崩溃时会话被杀死，PR 创建永远不执行

### 路径 2: PrAutoCreate 模块 (`pr-auto-create.ts`)
- **触发**: `PR_CREATE_REQUESTED` 事件（由 done 列 pre-automation 触发）
- **步骤**: 检查 worktree → git push → gh pr create → 更新 task
- **有重试**: `PR_RETRY_LIMIT=3`，失败时记录 `lastSyncError`
- **问题**: 只在特定事件触发，不会被 DoneLaneRecovery 调用

### 路径 3: DoneLaneRecovery `no_pr_completed` 模式
- **检测**: `COMPLETED + !hasPR + (worktreeId || !worktreeId) + ageMs > ORPHAN_AGE_MS`
- **处理**: **空壳 — `break;` 没有任何恢复动作**
- **这是最大的设计缺陷**

---

## 五、review-degraded Auto-Pass 的连锁缺陷

### 正常流程
```
stale retry 3/3 → review-degraded → DoneLaneRecovery 检测 → auto-pass
```

### Auto-pass 做了什么 (`done-lane-recovery-tick.ts:1188-1201`)
```typescript
case "review_degraded": {
  freshDegraded.lastSyncError = undefined;  // 清除标记
  freshDegraded.status = TaskStatus.COMPLETED;
  await system.taskStore.save(freshDegraded);
  break;
}
```

### 连锁问题
1. **只清状态，不补推代码** — COMPLETED 但 pullRequestUrl 为空
2. **不检查是否需要 PR** — 即使任务在 done 列且无 PR，也直接 COMPLETED
3. **触发重入循环** — 清除 lastSyncError 后 LaneScanner 重新触发 → 排队 → 又 stale → 又 review-degraded → 又 auto-pass...

---

## 六、根因分类：5 个系统性缺陷

### 缺陷 1: `no_pr_completed` 恢复逻辑缺失（P0）

**位置**: `done-lane-recovery-tick.ts:1179-1181`
**现象**: 检测到"COMPLETED 但无 PR"，但什么都不做
**影响**: 5 个任务的代码停在本地，阻塞 ~15 个下游任务

**应做**: 调用 `executeAutoPrCreation` 补推代码并创建 PR

### 缺陷 2: review-degraded auto-pass 不验证 PR 状态（P0）

**位置**: `done-lane-recovery-tick.ts:1188-1201`
**现象**: auto-pass 只清 lastSyncError，不检查任务是否缺少 PR
**影响**: 没有 PR 的任务被标记为 COMPLETED，代码永远不进 main

**应做**: auto-pass 前检查 `pullRequestUrl`，如果为空则触发 `executeAutoPrCreation`

### 缺陷 3: 并发上限过低（P1）

**位置**: `kanban-config.ts:97`
**默认值**: `defaultSessionConcurrencyLimit: 2`
**现象**: 只有 2 个并发会话槽位，但有 50+ 待处理任务
**影响**: 大量任务排队 → stale retry → review-degraded → 级联循环

**建议**: 提高到 4-6（取决于硬件和 API rate limit）

### 缺陷 4: stale retry 计数器重入问题（P1）

**位置**: `workflow-orchestrator.ts:1657-1721`
**现象**: auto-pass 清除状态后重新排队时，staleRetryCount 不重置
**影响**: 重入后直接跳到 4/3 触发 review-degraded（本应从 1/3 开始）

### 缺陷 5: Done Finalizer 网络失败降级策略过于激进（P2）

**位置**: `routa-specialists/done-finalizer.yaml`
**现象**: git push 或 gh pr create 网络超时时立即标记 "manual"，不重试
**影响**: 临时网络抖动导致代码永久停留在本地
**对比**: `PrAutoCreate` 模块有 3 次重试机制，但 Done Finalizer 没有

---

## 七、数据流断点图

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│  Dev Crafter │───→│ Review Guard │───→│Done Finalizer│───→│  PR Created  │
│  (worktree)  │    │  (LLM Agent) │    │ (LLM Agent)  │    │  + Merged    │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                    │                   │
       │ 代码 commit       │ review             │ push + PR         │
       │ 到本地分支        │ APPROVED           │                    │
       │                   │                    │                    │
       │         ┌─────────┴──────────┐    ┌───┴────────────┐      │
       │         │ 断点 A:             │    │ 断点 B:         │      │
       │         │ Review 超时         │    │ 网络超时 → manual│      │
       │         │ → review-degraded   │    │ 服务崩溃 → killed│      │
       │         │ → auto-pass         │    │ 会话创建 → failed│      │
       │         │ → 跳过 Done Finalizer│    │                  │      │
       │         └─────────┬──────────┘    └───┬────────────┘      │
       │                   │                    │                    │
       │                   ▼                    ▼                    │
       │            ┌──────────────────────────────┐                │
       │            │ DoneLaneRecovery 补偿         │                │
       │            │                               │                │
       │            │ no_pr_completed → break (空)  │ ← 缺陷 1      │
       │            │ review_degraded → 只清状态    │ ← 缺陷 2      │
       │            └──────────────────────────────┘                │
       │                                                              │
       └──────────────────────────────────────────────────────────────┘
              代码停在本地，永不合并到 main
```

---

## 八、修复优先级

| 优先级 | 缺陷 | 修复方案 | 工作量 |
|--------|------|---------|--------|
| **P0** | `no_pr_completed` 空实现 | 调用 `executeAutoPrCreation` 补推+创建PR | 中 |
| **P0** | auto-pass 不检查 PR | auto-pass 前检查 `pullRequestUrl`，为空则触发 PR 创建 | 小 |
| **P1** | 并发上限=2 | 提高到 4-6（通过环境变量） | 配置变更 |
| **P1** | stale 计数器重入 | auto-pass 清状态时同时重置 `staleRetryCount` | 小 |
| **P2** | Done Finalizer 降级策略 | 引入 PrAutoCreate 的重试机制替代直接 manual | 中 |

---

## 九、环境变量调优建议

当前可通过环境变量立即改善（不改代码）：

```bash
ROUTA_SESSION_CONCURRENCY_LIMIT=6    # 默认2，提高到6
ROUTA_STALE_MAX_RETRIES=5            # 默认3，增加重试次数
ROUTA_STALE_QUEUED_THRESHOLD_MS=120000  # 默认60s，给更多等待时间
```
