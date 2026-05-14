# CRAFTER 空跑问题：TF-28 关于页无代码产出

> **日期**: 2026-05-14
> **任务**: [TF-28] 关于页 (`9e404dd1-80a4-4096-8069-80f67196bb05`)
> **现象**: 任务标记 COMPLETED 但 PR 创建失败

## 1. 问题现象

PrAutoCreate 连续 3 次尝试创建 PR 均失败：

```
GraphQL: No commits between main and issue/tf-28-9e404dd1 (createPullRequest)
(attempt 3/3)
```

任务状态：

| 字段 | 值 |
|------|-----|
| status | COMPLETED |
| column_id | done |
| pull_request_url | none |
| pull_request_merged_at | null |
| last_sync_error | Auto PR creation failed: ... No commits between main and issue/tf-28-9e404dd1 |

## 2. 根因

### 2.1 Worktree 无代码变更

```
分支: issue/tf-28-9e404dd1
HEAD: d7584bf (与 main 完全一致，无任何新 commit)
未跟踪文件: about-page-expanded.png, about-page-full.png (仅截图)
已修改文件: 0
新增文件(已跟踪): 0
```

### 2.2 CRAFTER 空跑

CRAFTER 会话以 `AGENT_COMPLETED` 正常结束，但没有产生任何代码变更。可能原因：

1. **Agent 认为任务已完成**：CRAFTER 判断现有代码已满足需求，无需修改
2. **Agent 改了文件但未 commit**：Agent 修改了文件但没有执行 git commit
3. **Agent 写入了错误路径**：代码写到了非 worktree 目录

### 2.3 完成判定缺少产出验证

系统在 CRAFTER 返回 `AGENT_COMPLETED` 后，直接将任务推进到下一阶段（GATE → done），没有检查：

- worktree 是否有新 commit
- worktree 是否有未提交的变更
- 代码变更量是否与任务复杂度匹配

## 3. 影响分析

- TF-28 标记为 COMPLETED 但实际无代码交付
- 下游依赖 TF-28 的任务可能基于错误的假设继续工作
- PR 创建失败后任务卡在 done 列，`last_sync_error` 持续存在

## 4. 相关代码路径

### 4.1 PrAutoCreate 失败处理

`src/core/kanban/pr-auto-create.ts` — 检测到 done 列任务无 PR 时尝试创建，但遇到空分支直接失败。

### 4.2 DoneLaneRecovery

DoneLaneRecovery 每 3 分钟轮询 done 列任务，但只能修复 PR 合并状态问题，无法检测「空跑」场景。

## 5. 改进建议

### P1: CRAFTER 完成后增加产出验证

在 CRAFTER 会话完成后、推进到下一列之前，检查 worktree 是否有实际代码变更：

```typescript
async function validateCrafterOutput(task: Task, worktreePath: string): Promise<boolean> {
  // 检查是否有新 commit
  const hasNewCommits = await hasCommitsAheadOfWorktreeBase(worktreePath);
  if (hasNewCommits) return true;

  // 检查是否有未提交的变更（排除未跟踪文件）
  const hasUnstagedChanges = await hasTrackedChanges(worktreePath);
  if (hasUnstagedChanges) {
    console.warn(`[OutputValidator] Task ${task.id} has uncommitted changes but no new commits`);
    return false;
  }

  console.warn(`[OutputValidator] Task ${task.id} has no code changes (empty run)`);
  return false;
}
```

### P2: 空跑任务回退机制

当产出验证失败时，不推进到下一列，而是：
1. 标记 `last_sync_error = "CRAFTER completed with no code changes"`
2. 回退到 dev 列重新执行
3. 连续空跑 3 次后升级为人工处理

### P2: PrAutoCreate 增加空分支预检

在调用 `gh pr create` 前，先检查分支与 base 之间是否有 commit：

```typescript
const diffCommits = await exec(`git log --oneline ${baseBranch}..${headBranch}`);
if (!diffCommits.trim()) {
  task.lastSyncError = `No commits between ${baseBranch} and ${headBranch}. CRAFTER may have produced no output.`;
  await taskStore.save(task);
  return; // Skip PR creation
}
```

## 6. 链接

- 关联问题：[依赖门控评审](./dependency-gate-review-2026-05-14.md) — 同样涉及完成判定缺少验证
- Worktree 路径：`E:/AI/routa/default/4128953e-2642-40c4-a16d-09ea60c49a81/issue-tf-28-9e404dd1`
