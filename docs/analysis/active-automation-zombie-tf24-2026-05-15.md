---
title: activeAutomations 僵尸条目导致 LaneScanner 无法重新触发 specialist
date: 2026-05-15
severity: P0
status: fixing
type: bug
---

# activeAutomations 僵尸条目导致 TF-24 卡死

## 症状

TF-24（订单详情消费端）在 dev 列卡住超过 12 小时，LaneScanner 每 30 秒输出空转日志 `dev→dev (source: lane_scanner)`，但从不启动新 specialist session。

## 根因（已代码验证确认）

`WorkflowOrchestrator` 使用内存 `activeAutomations: Map<string, ActiveAutomation>` 跟踪正在运行的自动化。当 specialist 完成或超时后，该 Map 应被清理。但在以下场景中产生了僵尸条目：

1. TF-24 的 dev specialist 完成后推进到 review
2. review-guard 将卡片退回 dev（backward transition）
3. 退回时 `handleColumnTransitionData` L985 将旧 automation 标记为 `"failed"` 并清理 session
4. 但 `handleAgentCompletion` 的延迟清理定时器（L1497-1502）只在 session 正常完成时注册——如果 session 已崩溃/evict，该定时器**从未注册**
5. Overseer 的 orphan session reset 只清理了数据库的 `triggerSessionId`，未清理内存中的 `activeAutomations` Map
6. LaneScanner 重触发时被僵尸条目拦截（L950-956 `existingAutomation.status==="running"` + 同列 → 直接 return）

### 关键代码路径

**僵尸拦截点** (`workflow-orchestrator.ts:950-956`):
```typescript
const existingAutomation = this.activeAutomations.get(data.cardId);
if (existingAutomation
    && existingAutomation.boardId === data.boardId
    && (existingAutomation.status === "queued" || existingAutomation.status === "running")) {
  if (existingAutomation.columnId === targetColumn.id) {
    return; // ← 僵尸 activeAutomation 阻止了重新触发
  }
```

**延迟清理依赖 handleAgentCompletion** (`workflow-orchestrator.ts:1497-1502`):
```typescript
const completedAutomation = automation;
this.pendingTimers.push(setTimeout(() => {
  if (this.activeAutomations.get(cardId) === completedAutomation) {
    this.activeAutomations.delete(cardId);
  }
}, COMPLETED_AUTOMATION_CLEANUP_DELAY_MS)); // 30s
```
如果 session 崩溃导致 `handleAgentCompletion` 不触发，此定时器永远不会注册。

**Overseer 清理不完整** (`health-tick.ts:243-265`):
只清理了 `triggerSessionId`（数据库字段），未清理 `activeAutomations`（内存 Map）。Overseer 通过 `RoutaSystem` 访问数据库，不持有 Orchestrator 引用。

### 现有防护机制为何失效

| 防护 | 位置 | 失效原因 |
|------|------|---------|
| `scanStaleQueuedAutomations` | L1742-1835 | 只扫 `status==="queued"`，**不扫 `"running"`** |
| `scanForInactiveSessions` | L1573-1728 | 要求 `sessionRecord` 存在（L1628）。session 被 evict 后返回 null，ACP 状态检查被跳过；activity 检查 fallback 到 `startedAt`，但 inactivity 阈值可能很大（60min），僵尸在此期间持续阻塞 |
| DoneLaneRecovery | L943-950 | 注释明确写了 "NOT tracked in activeAutomations"——只处理 specialist session |
| Overseer `orphan-in-progress` | `diagnostics.ts:255-272` | 检测 `!triggerSessionId` 后清数据库，**零可见性**到内存 Map |

### 根因链

```
session 崩溃/evict → handleAgentCompletion 不触发 → 无延迟清理定时器
  → Overseer 清数据库 triggerSessionId → LaneScanner 重触发
  → 被僵尸 activeAutomation("running") L950-956 拦截 → 永久卡死（直到重启）
```

## 影响范围

- TF-24 卡死导致 4 个 PENDING 终端任务（T7-01, T7-02, T7-03, TF-32）被阻塞
- `activeAutomations=3` 但只有 1 个 IN_PROGRESS 任务，说明有 2 个僵尸条目

## 根治方案（三层防御）

### 修复点 1：watchdog 增加 running 状态僵尸扫描（核心修复）

**文件**：`workflow-orchestrator.ts` — `scanForInactiveSessions`
**改动**：在遍历 `running` 条目时，增加 HttpSessionStore 不存在检测：

```typescript
// 如果 HttpSessionStore 中该 session 完全不存在，且超过 orphanAgeMs，视为僵尸
const sessionRecord = sessionStore.getSession(sessionId);
if (!sessionRecord) {
  const ageMs = now - automation.startedAt.getTime();
  if (ageMs >= cfg.orphanAgeMs) {
    // 标记 failed + delete
  }
}
```

**生效时机**：每 30s watchdog 扫描一次，僵尸 3 分钟后被清理。

### 修复点 2：Overseer orphan reset 通知 Orchestrator（纵深防御）

**文件**：`health-tick.ts` L243-265
**改动**：在 `reset-orphan-session` 完成数据库清理后，emit `COLUMN_TRANSITION` 事件（`source.type: "orphan_cleanup"`），触发 Orchestrator 清理对应条目。

**在 Orchestrator 侧**：`handleColumnTransitionData` 中对 `orphan_cleanup` source 做特殊处理——先无条件 delete `activeAutomations` 条目，再继续正常流程。

**生效时机**：Overseer 30 分钟检测周期后，最坏 30 分钟内清理。

### 修复点 3：handleColumnTransitionData 入口僵尸防御（即时防御）

**文件**：`workflow-orchestrator.ts` L950-957
**改动**：在 `existingAutomation` 拦截点，对 `running` 状态增加 session 存在性检查：

```typescript
if (existingAutomation.status === "running") {
  const sessionExists = existingAutomation.sessionId
    && getHttpSessionStore().getSession(existingAutomation.sessionId);
  if (!sessionExists) {
    // 僵尸，清理后继续后续流程
  }
}
```

**生效时机**：LaneScanner 重触发时立即清理。

### 三层防御冗余分析

| 场景 | 修复点 1（watchdog） | 修复点 2（Overseer） | 修复点 3（入口） |
|------|---------------------|---------------------|-----------------|
| 正常 dev specialist 运行中 | 不触发（session 存在） | 不触发（非 orphan） | 不触发（session 存在） |
| session 正常完成后 30s 内 | 不触发（延迟清理已注册） | 不触发（非 orphan） | 不触发（已完成） |
| session 崩溃 + evict | 30s watchdog 清理 | 30min Overseer 清理 | LaneScanner 重触发时清理 |

三层互为兜底，最坏情况下 30 分钟内必定解除。

## 对其它功能的影响

| 功能 | 影响 | 说明 |
|------|------|------|
| LaneScanner 正常扫描 | **不影响** | 扫描逻辑无变动 |
| review-guard 退回 | **不影响** | 退回流程不变，只修复了退回后的僵尸残留 |
| auto-merger | **不影响** | 不在 activeAutomations 中（L948 注释确认） |
| DoneLaneRecovery | **不影响** | 独立子系统 |
| 依赖链 fan-in/fan-out | **正面影响** | 解除卡死后下游任务可继续 |
| circuit breaker | **不影响** | circuit breaker 逻辑在僵尸检查之前（L920-948） |
| stale queued retry | **不影响** | `scanStaleQueuedAutomations` 逻辑不变 |

## 临时解决 (2026-05-15 08:09)

重启服务清空 `activeAutomations` 后，LaneScanner 成功触发新 dev session：
- `08:09:33` 新 CRAFTER session 创建（model=glm-5.1）
- `08:11:33` specialist 完成，dev→review 推进成功
- `08:14:04` review-guard 退回 dev（第 3 次循环）
- `08:14:05` 系统正确清理 3 个 laneSession + 取消 stale automation
- `08:14:10` 立即创建新 dev CRAFTER session

**关键验证**：backward transition 后 `activeAutomations` 不再产生僵尸条目。

## 复现条件

1. 卡片在 dev 列被 specialist 完成，推进到 review
2. review-guard 退回 dev
3. 退回时 activeAutomations 清理未完全（session 崩溃导致 handleAgentCompletion 不触发）
4. Overseer 检测到 orphan session 并 reset triggerSessionId
5. LaneScanner 重新触发但被僵尸 activeAutomation 拦截

## 遗留问题

1. **SDK session 挂起**：specialist 完成验证后，`pkill -f "vite"` 命令在 Windows 上不可用导致 session stream 沉默 9+ 分钟。建议：dev-executor 在 Windows 上应使用 `taskkill` 或 `tskill` 替代 `pkill`。
2. **review-guard 反复退回**：TF-24 已完成 3 次 dev→review→dev 循环。需调查 review-guard 的拒绝标准是否过于严格。
3. **TF-25/TF-06 误报**：DoneLaneRecovery 持续报 "exceeded 3 PR creation attempts"，但实际代码已通过 PR #268/#191/#203 合并。系统未正确关联 task 到已有 PR。
