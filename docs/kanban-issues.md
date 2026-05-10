# 看板自动化流水线 — 系统性问题记录

> 日期：2026-05-09 | 项目：CodeYield-HuiLife (摊生意) | 监控环境：Windows 11

## 问题 1：Auto-merger 会话卡死

**严重度**：高（阻塞整条流水线）

**现象**：
PR 进入 done 列后，auto-merger 会话持续运行（MCP `tools/call` 请求不断），但永远无法完成合并。
在 HuiLife 项目中连续出现在 PR #24、#25、#26。

**根因**：
auto-merger 使用 Claude Code SDK（模型 glm-5.1，端点 `open.bigmodel.cn/api/anthropic`）。
会话启动后持续发 tools/call 请求但未能执行 `gh pr merge`，可能是模型指令遵循问题或 SDK 会话状态异常。

**临时方案**：
手动执行 `gh pr merge <N> --squash --repo <repo> --delete-branch=false`。

**影响链路**：
```
auto-merger 卡死
  → pullRequestMergedAt 为空
    → isDependencySatisfied() 返回 false（dependency-gate.ts:27-39）
      → 下游所有任务依赖门不通过
        → 整条流水线停滞
```

**改进建议**：
- auto-merger 增加超时熔断机制（如 5 分钟未完成则自动终止）
- 合并前先用 GitHub API 检查 PR 是否已经 merged，避免重复操作

---

## 问题 2：PR 并行修改共享文件导致合并冲突

**严重度**：中

**现象**：
PR #24（T1-04 菜品 CRUD）和 PR #26（T6-01 商户设置+图片上传）均显示 DIRTY/CONFLICTING。

**冲突文件**（以 PR #26 为例）：
- `server/src/index.ts` — 路由注册
- `server/src/middleware/auth.ts` — 认证中间件
- `server/package-lock.json` — 依赖锁文件

**根因**：
多任务并行开发时修改了相同的共享入口文件。T1-03（商户模块）、T1-04（菜品 CRUD）、T1-05（种子数据）、T6-01（图片上传）均需要向 `index.ts` 注册路由。

**解决方案**：
1. 在 PR 分支上 rebase onto main
2. 逐文件合并双方改动（保留 main 已有功能 + 添加新功能）
3. `git push --force-with-lease`

**改进建议**：
- 任务拆分时隔离共享文件修改范围
- 采用路由自动注册机制（如 `server/src/routes/` 下文件自动加载），减少对 `index.ts` 的争用

---

## 问题 3：DoneLaneRecovery 自锁死

**严重度**：高（延迟 15-25 分钟才能检测到合并）

**现象**：
PR 已通过 CLI 手动合并，但 DoneLaneRecovery 连续多个 10 分钟 tick 都 `recovered=0`，不检测合并。

**根因**：
`done-lane-recovery-tick.ts` 第 138-149 行的活跃会话检查逻辑：

```typescript
// 如果任务最近的 lane session 是恢复专家（含 kanban-auto-merger）
// 且该会话仍在 HttpSessionStore 中活跃（非 terminalState）
// 则跳过该任务的所有恢复检测
if (recentSession?.status === "running" && recentSession.specialistId
    && RECOVERY_SPECIALIST_IDS.includes(recentSession.specialistId)
    && getSessionActivity(recentSession.sessionId) && !activity.terminalState) {
  return patterns; // 直接跳过
}
```

当 auto-merger 卡死（问题 1）时：
1. auto-merger 会话持续活跃 → DoneLaneRecovery 跳过该任务
2. 即使 PR 已被手动合并 → 系统不知道
3. 直到 HttpSessionStore 定期清理（~15 分钟）移除过期会话后，下一个 10 分钟 tick 才能检测到

**时间线实例**（PR #26）：
```
16:52:27  手动合并 PR #26
16:52:51  stale retry 3/3 创建新 auto-merger 会话
17:00:00  DoneLaneRecovery tick — recovered=0（被活跃会话阻塞）
17:10:00  DoneLaneRecovery tick — recovered=1（会话过期后终于检测到）
```

**改进建议**：
- 在 `recoverWebhookMissed` 中优先直接调用 GitHub API 验证 PR 状态，绕过活跃会话检查
- 或将 `kanban-auto-merger` 从 `RECOVERY_SPECIALIST_IDS` 中移除，仅保留 `conflict-resolver` 和 `rebase-resolver`

**关键代码**：
- `done-lane-recovery-tick.ts:30` — `RECOVERY_SPECIALIST_IDS` 包含 `kanban-auto-merger`
- `done-lane-recovery-tick.ts:138-149` — 活跃会话跳过逻辑
- `done-lane-recovery-tick.ts:156-160` — `webhook_missed` 模式（被跳过逻辑短路）

---

## 问题 4：Structural Skip 竞态条件

**严重度**：低（系统可自愈，仅增加延迟）

**现象**：
```
[createAutomationSession] Structural skip for card <id>:
Task moved to a different column before session could start.
```

**根因**：
卡片在列间移动速度（毫秒级，由 LaneScanner 完成）快于会话创建速度（秒级，需启动 Claude Code SDK 进程）。

**系统自愈机制**：
1. LaneScanner 检测到 failed advance
2. 清理孤儿会话
3. 重新触发（最多 3 次重试）
4. 超过重试上限后标记为 `[advance-recovery]` 等待 DoneLaneRecovery 处理

**影响**：每次 structural skip 增加 15-30 秒延迟，但不阻塞最终完成。

---

## 问题 5：Dev Executor 连续失败

**严重度**：中（代码质量风险）

**现象**：
```
[WorkflowOrchestrator] Releasing task dev server for <id>: port XXXXX, failures=3
```

T6-01（商户设置+图片上传）和 T2-01（订单创建）均出现此问题。

**根因**（可能）：
1. 模型（glm-5.1）在复杂代码生成任务上的能力不足
2. 任务 scope 过大（T6-01 包含商户设置+图片上传+反馈 API 等多个子功能）
3. Worktree 环境配置或依赖问题

**影响**：
- 任务被推进到 review/done 但代码可能不完整
- T6-01 在 dev 失败 3 次后直接被推进到 done，review-guard 补创了 PR #26
- 代码完整性未经验证

**改进建议**：
- 限制单个任务 scope，一个任务聚焦一个功能模块
- 增加 dev executor 的重试策略或降级机制（如失败后缩小 scope 重试）
- review-guard 增加代码完整性检查（如编译/测试是否通过）

---

## 问题关联矩阵

```
问题 1 (auto-merger 卡死)
  └─→ 问题 3 (DoneLaneRecovery 自锁死) — 卡死的 auto-merger 阻止恢复检测
       └─→ 下游任务延迟 15-25 分钟才能解除阻塞

问题 5 (dev executor 失败)
  └─→ 代码可能不完整 → PR 可能需要额外修复

问题 2 (PR 冲突) — 独立问题，由并行开发引起
问题 4 (竞态条件) — 独立问题，系统可自愈
```

## 统计数据（2026-05-09 16:30 - 17:10）

| 指标 | 数值 |
|------|------|
| 手动合并 PR | 3 个（#24、#25、#26） |
| 手动解决冲突 | 2 个（#24、#26） |
| auto-merger 卡死 | 3 次 |
| structural skip | 3 次（T1-05、T2-01、T6-01） |
| dev executor 失败 | 2 次（T6-01 failures=3、T2-01 failures=3） |
| DoneLaneRecovery 延迟检测 | 2 次（T1-05: 16:40、T6-01: 17:10） |
