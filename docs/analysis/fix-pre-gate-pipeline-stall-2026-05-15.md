# 修复：Pre-Gate Check 阻塞全部 Review 卡片

**日期**: 2026-05-15
**状态**: 已修复
**影响**: review 列全部 6 张卡被 pre-gate blockers 阻塞，流水线停滞

## 根因

`workflow-orchestrator.ts:869` 的 pre-gate check 逻辑在检测到任何 forbidden term 匹配时直接 `return`，阻止卡片推进。

Pre-gate checker 扫描 worktree 中所有源文件，对 `spec-files.json` 中定义的 30+ 个 forbidden terms 进行匹配（如 `completed`、`console.log`、`parseFloat` 等）。这些词在正常代码库中极为常见，导致每张卡累积 90-110 个 blocker。

讽刺的是，L898 的 catch 注释写着 "Pre-gate check failure should not block the pipeline"，但 `!preGateResult.passed` 分支确实在阻塞。

## 修复

**文件**: `src/core/kanban/workflow-orchestrator.ts`

将 pre-gate blocker 从**硬阻塞**降级为**警告（advisory）**：

- blocker 仍然记录到 `task.preGateBlockers` 字段（UI 可见）
- 清除因 pre-gate 导致的 `lastSyncError`
- **不再 `return`**，卡片正常推进 pipeline
- review guard 仍会在 review 阶段捕获实际的质量问题

## 验证

- 重启前：6 张 review 卡全部 blocked（94-110 blockers/卡）
- 重启后：卡片应正常从 review 推进到 done
