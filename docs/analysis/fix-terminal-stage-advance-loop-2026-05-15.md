# 修复：Terminal Stage Advance-Only 无限循环

**日期**: 2026-05-15
**状态**: 已修复
**影响**: Card `1c7aca15` (T7-01e) 每分钟触发 2 次 advance-only 事件，持续空转

## 根因

`kanban-lane-scanner.ts` 的 `stuckInColumn` 检查只看 `autoAdvanceOnSuccess=true`，不检查当前列是否为 terminal stage (done/archived)。

当 card 完成所有 steps 且在 done 列时：
1. LaneScanner 检测到 `shouldAutoAdvance=true` → 设置 `stuckInColumn=true`
2. 发出 advance-only COLUMN_TRANSITION 事件
3. WorkflowOrchestrator 收到事件，调用 `autoAdvanceCard`
4. `autoAdvanceCard` 检测到 done 是 terminal stage → 跳过
5. 下一个 tick 重复步骤 1-4

**循环无法中断的原因**：`countStepAttempts` 计数已有的 lane_sessions，但 advance-only 事件不创建新 session，所以 `stuckAttempts` 永远不递增，上限 `MAX_STEP_RESUME_ATTEMPTS=3` 永远达不到。

## 修复

**文件**: `src/core/kanban/kanban-lane-scanner.ts`

在 `stuckInColumn` 判定中增加 terminal stage 检查：

```typescript
// Before:
const stuckInColumn = shouldAutoAdvance;

// After:
const columnStage = currentColumn?.stage ?? (currentColumn?.id ? inferStageFromColumnId(currentColumn.id) : undefined);
const stuckInColumn = shouldAutoAdvance && columnStage !== "done" && columnStage !== "archived";
```

**效果**：done/archived 列中已完成的 card 直接 `continue` 跳过，不再触发无意义的 advance-only 事件。

## 验证

- 重启前：67 次 advance-only 事件（10:39-10:44，约 5 分钟内）
- 重启后：0 次（10:50+ 无新事件）
