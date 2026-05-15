# 依赖门控与代码继承机制评审

> **日期**: 2026-05-14
> **评审人**: Claude Code 动态监控
> **触发**: T1-01 完成但 PR 未合并时 T1-02 已解锁执行
> **PR**: https://github.com/1339190177/CodeYield-HuiLife/pull/239

## 1. 问题发现

### 1.1 事件时间线

```
19:09:20  T1-01 → done (COMPLETED)，PR #239 尚未合并
19:10:00  Overseer 解锁 T1-02 依赖（仅检查 status=COMPLETED）
19:10:39  T1-02 Backlog 梳理员开始工作
19:12:36  T1-02 被推入 todo 列
19:15:02  PR #239 在 GitHub 上合并（UTC 11:15:02）
19:25:48  T1-02 开发执行员完成代码编写
```

**T1-02 在 PR 合并前 5 分钟就已开始工作。**

### 1.2 Git 实际状态验证

```
origin/main:   8c593b0 (Merge PR #239) ← 已包含 T1-01 代码
local main:    d7584bf                  ← 未 pull，不含 T1-01 代码
T1-01 branch:  1b01a43 (2 commits ahead of main)
T1-02 branch:  1b01a43                  ← 与 T1-01 完全相同的 HEAD!
```

T1-02 是从 T1-01 的 feature branch 创建的，不是从 main。因此 T1-02 能看到 T1-01 的代码，但存在结构性风险。

## 2. 根因分析

### 2.1 依赖门控：仅检查任务状态，不检查 PR 合并

**文件**: `src/core/kanban/dependency-gate.ts:27-46`

```typescript
export function isDependencySatisfied(depTask: Task): boolean {
  const isCompleted = depTask.status === TaskStatus.COMPLETED
    || depTask.status === TaskStatus.ARCHIVED
    || depTask.columnId === "done"
    || depTask.columnId === "archived";
  // Terminal status alone is sufficient — PR merge tracking can be stale
  if (isCompleted) return true;
  return false;
}
```

**问题**: 注释说 "PR merge tracking can be stale"，这是一个已知 bug，但解决方案是跳过检查而非修复 tracking。

### 2.2 分支继承：从依赖的 feature branch 创建，非 main

**文件**: `src/core/kanban/branch-plan.ts:196-251`

```typescript
// resolveDependencyBaseBranch()
for (const depId of task.dependencies) {
  const depTask = await deps.taskStore.get(depId);
  // Merged PRs are on main already — skip
  if (depTask.pullRequestMergedAt) continue;
  // If dependency has a worktree with a branch, use it
  if (depTask.worktreeId) {
    return depWorktree.branch;  // ← T1-02 继承 T1-01 的分支
  }
}
```

**问题**: 当 `rules.baseBranch.strategy === "dependency_inherit"` 时，新任务从依赖的 worktree 分支创建，产生分支扇出。

### 2.3 补救机制：30 秒后删除远程分支

**文件**: `src/core/kanban/pr-merge-listener.ts:28`

```typescript
const CLEANUP_DELAY_MS = 30_000;
```

**问题**: PR 合并后 30 秒删除远程分支，但此时可能还有下游 worktree 引用该分支。

## 3. 风险评估

### 3.1 分支扇出（Branch Fan-out）

```
T1-01 (feature branch, 未合并)
  ├── T1-02 (基于 T1-01 分支)
  │     ├── T1-03 (基于 T1-02 分支)
  │     └── TF-01 (基于 T1-02 分支)
  └── TF-00 (基于 T1-01 分支)
        ├── TF-09 (基于 TF-00 分支)
        └── TF-31 (基于 TF-00 分支)
```

若 T1-01 PR 需要 squash merge 或修改，所有下游分支都需 rebase。代价 O(深度 × 宽度)。

### 3.2 竞态场景

| 场景 | 当前结果 | 风险等级 |
|------|---------|---------|
| 下游在 PR 合并前启动 | 分支继承保证代码可见 | 低（正常合并时） |
| 上游 PR 被拒绝 | 下游基于被拒绝的分支 | **高** |
| 上游 PR squash merge | commit hash 变化，rebase 冲突 | **中** |
| 上游分支被删除 | 下游 worktree 基准丢失 | **高** |
| 多个下游共享同一上游分支 | 上游变更导致批量 rebase | **中** |

## 4. 改进建议

### P0: 依赖门控增加 PR 合并验证

```typescript
// 改进后的 isDependencySatisfied
export function isDependencySatisfied(depTask: Task): boolean {
  const isTerminal = depTask.status === TaskStatus.COMPLETED
    || depTask.status === TaskStatus.ARCHIVED;

  if (!isTerminal) return false;

  // 如果有 PR，必须确认已合并
  if (depTask.pullRequestUrl && !depTask.pullRequestMergedAt) {
    return false;
  }

  return true;
}
```

### P0: 分支删除前检查引用

```typescript
// pr-merge-listener.ts — 在 deleteRemoteBranch 前增加检查
const activeWorktrees = await system.worktreeStore.listByWorkspace(task.workspaceId);
const referenced = activeWorktrees.some(
  w => w.branch === branchName && w.id !== task.worktreeId
);
if (referenced) {
  console.log(`[PrMergeListener] Skipping branch delete: still referenced by other worktrees`);
  return;
}
```

### P1: 新 worktree 优先从 main 创建

将 `dependency_inherit` 改为 fallback 策略：优先从 main 创建 worktree，仅在 main 上缺少依赖代码时才继承分支。

### P2: Rebase 失败自动重试

当前 `attemptDownstreamRebase` 失败后只标记 `lastSyncError`。应增加指数退避重试机制。

## 5. 行业对标

| 实践 | Routa 当前 | 行业 Top 1% |
|------|-----------|-------------|
| 依赖门控 | 状态检查 | 状态 + PR 合并 + CI 通过 |
| 分支策略 | dependency_inherit | main 为单一真相源 |
| 合并后清理 | 30s 定时删除 | 引用检查 + 安全窗口 |
| 下游更新 | best-effort rebase | merge queue + 自动化 rebase |
| 失败恢复 | 标记 lastSyncError | 指数退避重试 + 人工升级 |

## 6. 结论

当前设计是「乐观依赖解析 + 分支继承」（ODR-BI），在 AI coding 场景下吞吐量高（9/10），但正确性不足（5/10）。核心问题是 **依赖门控应该是流水线中最坚固的环节，而不是最宽松的**。

建议优先实施 P0 级改进，将依赖门控从「只看状态」升级为「状态 + PR 合并」双重验证。
