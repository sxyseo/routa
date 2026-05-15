---
title: TF-24 僵尸修复后全流程审查 — 3 个遗留问题
date: 2026-05-15
severity: P2
status: resolved
type: analysis
related: active-automation-zombie-tf24-2026-05-15
---

# TF-24 僵尸修复后全流程审查

## 背景

对 TF-24（订单详情消费端）进行全流程代码追踪，确认「review lane_sessions 缺少 completed 状态」是否为 LaneScanner 重新触发 review→review 的根因。

## 结论：原假设不成立

**「review lane_sessions 缺少 completed」不是独立根因，是僵尸 bug 的下游症状。**

代码证据：

| 组件 | 位置 | 关键逻辑 |
|------|------|---------|
| `findLastCompletedStepIndex` | `kanban-lane-scanner.ts:600-602` | 同时匹配 `"completed"` 和 `"transitioned"` |
| `finalizeActiveTaskSession` | `task-session-transition.ts:22` | moveCard 时标记 session 为 `"completed"` |
| `handleAgentCompletion` | `workflow-orchestrator.ts:1031` | 卡片被 autoAdvance 移走时标记 `"transitioned"` |
| backward transition | `workflow-orchestrator.ts:604-624` | 清除 source + dest 两列的所有 laneSessions |

完整因果链：

```
activeAutomations 僵尸（根因，已修复）
  → LaneScanner 被拦截，无法重新触发
  → review-guard 旧 session 超时 → lane_sessions = timed_out/failed
  → 僵尸清理后 backward transition 清除旧 sessions
  → 最终成功周期：review session = transitioned（正确）
  → allStepsCompleted = true（因为 transitioned 也算完成）
```

TF-24 当前状态：**COMPLETED**，在 done 列，PR #288（有冲突未合并）。

---

## 遗留问题 1：done-finalizer session 状态残留

### 现象

TF-24 的 done lane_session 状态为 `"running"`，但 task.status 已是 `"COMPLETED"`。trigger_session_id 仍指向该 session。

数据库证据：
```
done lane_session: status="running", startedAt=2026-05-15T00:40:54
task: status=COMPLETED, trigger_session_id=e4ec37db-...
```

### 根因

done-lane terminal guard（`workflow-orchestrator.ts:1427-1504`）在 done-finalizer session 完成前就标记了 task 为 COMPLETED。这是一个设计上的时序问题：

1. review-guard 通过 → review→done → COLUMN_TRANSITION
2. `handleColumnTransitionData` 处理 done 列 → done-lane early exit（L676-698）检测到 PR 存在
3. early exit 将 task 标记 COMPLETED 并 return → done-finalizer 从未启动
4. 但如果 early exit 条件不满足 → done-finalizer 启动（L1067-1100）
5. done-finalizer session 开始后，terminal guard（L1427）又标记 COMPLETED
6. done-finalizer session 的 lane_session 状态从未被更新为 "completed"

### 影响范围

- **功能性影响**：低。LaneScanner 会跳过 COMPLETED 状态的卡片（L175），不会重复触发
- **资源影响**：trigger_session_id 持有 session 引用，但 watchdog 最终会清理
- **可观测性影响**：日志/数据库显示 session 仍在 running，可能误导排查

### 修复建议

**评估：可选修复（P2-Low）**

方案：在 done-lane terminal guard 标记 COMPLETED 前，同步更新 done lane_session 状态为 "completed"。

```typescript
// workflow-orchestrator.ts:1427 附近
if (isTerminalStage && freshTask.status !== "COMPLETED") {
  // 标记当前 done session 为 completed
  const doneSession = freshTask.laneSessions?.findLast(
    (s) => s.columnId === automation.columnId && s.status === "running"
  );
  if (doneSession) {
    markTaskLaneSessionStatus(freshTask, doneSession.sessionId, "completed");
  }
  // 然后标记 COMPLETED
}
```

**不建议立即修复**：影响低，风险小，watchdog 会兜底。

---

## 遗留问题 2：scanForInactiveSessions 使用了错误的 session 变量

### 现象

`workflow-orchestrator.ts:1695` 和 L1705 引用了 L1630 定义的 `sessionRecord`（可能过时），而非 L1685 的 `recoverySessionRecord`（最新值）。

### 代码位置

```typescript
// L1630: 首次获取 session（zombie 检测用）
const sessionRecord = sessionStore.getSession(sessionId);
if (!sessionRecord) { /* zombie 清理 */ continue; }

// ... 80 行其他逻辑 ...

// L1685: 重新获取 session（recovery 模式专用）
const recoverySessionRecord = sessionStore.getSession(sessionId);
if (recoverySessionRecord?.acpStatus === "error") {
  // L1695: BUG — 引用 sessionRecord 而非 recoverySessionRecord
  reason: sessionRecord.acpError ?? "ACP session entered error state.",
  // L1705: 同样的 BUG
  error: sessionRecord.acpError ?? "ACP session entered error state.",
```

**这不是编译错误**（`sessionRecord` 在 L1630 定义，同一 for 循环块内仍可访问），而是语义 bug：L1685 重新获取 session 是为了拿到最新状态，但 L1695/L1705 仍然使用 L1630 的旧值。

### 影响范围

- **严重性**：P1
- **触发条件**：watchdog 扫描到 running automation → session 存在（过了 L1631 检查）→ 是 recovery 模式 → session ACP 状态为 error
- **后果**：使用过时的 ACP error 信息通知 agent 和记录失败事件。如果 L1630 获取时 session 无 error 但 L1685 时有了，会漏报；反过来如果 L1630 有 error 但 L1685 已恢复，会误报
- **实际触发概率**：低。需要 session ACP 状态在两次 `getSession` 调用间发生变化

### 修复建议

**评估：应该修复（P1）**

将 L1695 和 L1705 的 `sessionRecord.acpError` 改为 `recoverySessionRecord?.acpError`：

```diff
- reason: sessionRecord.acpError ?? "ACP session entered error state.",
+ reason: recoverySessionRecord?.acpError ?? "ACP session entered error state.",

- error: sessionRecord.acpError ?? "ACP session entered error state.",
+ error: recoverySessionRecord?.acpError ?? "ACP session entered error state.",
```

同时建议在 L1686 加可选链 `recoverySessionRecord?.acpStatus`（已存在则忽略）。

---

## 遗留问题 3：COMPLETED task 的 PR 冲突被跳过

### 现象

```
[DoneLaneRecovery] Card c5503160 PR has conflicts, but task is COMPLETED.
Skipping conflict-resolver.
```

PR #288 有合并冲突，但 task 已标记 COMPLETED，DoneLaneRecovery 不再尝试解决冲突。

### 代码位置

DoneLaneRecovery tick 中的 COMPLETED 跳过逻辑。

### 影响范围

- **功能性影响**：PR 代码无法自动合并到 main。代码已在 PR 分支中，但不影响 main 分支
- **业务影响**：如果 TF-24 的代码是最终需要的，需要手动合并
- **设计意图**：这是故意的行为——COMPLETED task 不应再被自动修改，避免无限循环

### 修复建议

**评估：不需要代码修复（by design）**

这是正确的防御设计。处理方式：
1. 手动合并 PR #288（如有冲突需手动解决）
2. 或者确认代码已通过其他途径合入 main 后关闭 PR

---

## 总结

| # | 问题 | 严重性 | 是否修复 | 理由 |
|---|------|--------|---------|------|
| 1 | done-finalizer session 状态残留 | P2-Low | 可选 | watchdog 兜底，影响低 |
| 2 | L1695/L1705 错误引用 sessionRecord | **P1** | **应该** | 使用过时数据，可能漏报/误报 ACP 错误 |
| 3 | COMPLETED task PR 冲突被跳过 | P3 | 不需要 | by design，手动处理即可 |

**优先级**：问题 2 > 问题 1 > 问题 3

## 代码验证与修复 (2026-05-15)

三个问题的分析全部经代码验证确认正确。

### 已修复

**问题 2**（P1）：`workflow-orchestrator.ts` L1695/L1705 的 `sessionRecord.acpError` 已改为 `recoverySessionRecord.acpError`，使用最新 session 状态而非过时值。TypeScript 编译零错误。

### 验证结论

| # | 分析结论 | 代码验证 |
|---|---------|---------|
| 1 | done-finalizer 时序问题 | **确认**：L676-698 early exit 和 L1469-1500 terminal guard 均未更新 lane_session |
| 2 | 错误变量引用 | **确认并已修复**：L1685 重新获取的 `recoverySessionRecord` 未被 L1695/L1705 使用 |
| 3 | COMPLETED task 跳过 PR 冲突 | **确认**：by design，正确的防御设计 |
