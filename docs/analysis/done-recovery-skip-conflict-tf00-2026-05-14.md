# DoneLaneRecovery 跳过冲突解决：TF-00 前端基础设施搭建

> **日期**: 2026-05-14
> **任务**: [TF-00] 前端基础设施搭建 (`a7a8deca-9a05-4884-9caa-0bfc09e4dba4`)
> **PR**: https://github.com/1339190177/CodeYield-HuiLife/pull/242
> **状态**: COMPLETED / done，但 PR 未合并（CONFLICTING）

## 1. 问题现象

DoneLaneRecovery 每 3 分钟报告相同错误，持续跳过：

```
[DoneLaneRecovery] Card a7a8deca... PR has conflicts, but task is COMPLETED. Skipping conflict-resolver.
```

## 2. PR 实际状态

```json
{
  "state": "OPEN",
  "mergeable": "CONFLICTING",
  "mergeStateStatus": "DIRTY",
  "headRefName": "issue/tf-00-a7a8deca",
  "baseRefName": "main"
}
```

- PR 存在合并冲突，无法自动合并
- 任务已标记 COMPLETED，`pull_request_merged_at: null`

## 3. 根因

DoneLaneRecovery 的逻辑是：**如果任务已经是 COMPLETED 状态，就不触发 conflict-resolver**。这个设计的意图是避免对已完成的任务重复处理，但忽略了「任务完成了但 PR 没合并」的场景。

## 4. 影响

1. **TF-00 代码未进入 main 分支**
2. **下游任务基于 TF-00 的 feature branch 创建 worktree**（如 TF-09、TF-31 等），继承的代码可能在冲突解决后变化
3. **依赖门控不检查 PR 合并**（见 [dependency-gate-review](./dependency-gate-review-2026-05-14.md)），下游任务已解锁
4. **冲突不会自动修复**，需要人工干预

## 5. 修复方案

### 方案 A：手动解决 PR 冲突（即时）

通过 CDP 连接 Chrome，在 GitHub PR 页面解决冲突，或在本地 worktree 手动 rebase：

```bash
cd <TF-00 worktree path>
git fetch origin main
git rebase origin/main
# 解决冲突后
git push --force-with-lease origin issue/tf-00-a7a8deca
```

### 方案 B：修改 DoneLaneRecovery 逻辑（长期）

当 PR 存在冲突且 `pull_request_merged_at` 为空时，即使任务状态为 COMPLETED，也应触发 conflict-resolver。

```typescript
// 修改 DoneLaneRecovery 的冲突检测逻辑
if (hasConflicts && !task.pullRequestMergedAt) {
  // PR 有冲突且未合并 → 触发 conflict-resolver
  // 而非因为 status=COMPLETED 就跳过
}
```

## 6. 关联问题

- [依赖门控评审](./dependency-gate-review-2026-05-14.md) — 同一架构问题的不同表现
- [CRAFTER 空跑问题](./crafter-empty-run-tf28-2026-05-14.md) — 完成判定缺少验证

## 7. 当前阻塞状态

**需要人工决策**：是手动解决 PR #242 冲突，还是暂时接受 TF-00 代码通过分支继承传递给下游？
