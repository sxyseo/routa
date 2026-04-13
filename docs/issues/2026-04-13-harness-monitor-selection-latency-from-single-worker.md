---
title: "Harness monitor 文件切换和预览加载仍会被单一后台 worker 拖慢"
date: "2026-04-13"
kind: issue
status: open
severity: high
area: "harness-monitor"
tags: ["harness-monitor", "tui", "performance", "selection-latency", "background-worker"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-13-harness-monitor-user-value-gap-to-decision-console.md"
  - "docs/issues/2026-04-12-harness-monitor-task-tracking-from-codex-hooks.md"
github_issue: null
github_state: null
github_url: null
---

# Harness monitor 文件切换和预览加载仍会被单一后台 worker 拖慢

## What Happened

`crates/harness-monitor` 当前已经补上了：

- transcript/session recovery
- prompt-first runs
- lazy file preview 的首屏 100 行加载

但在真实仓库里切换 `Git Status` / `Change Status` 选中项时，UI 仍然会明显发卡，尤其是大仓库或 dirty files 较多时更明显。

调查发现，当前 `AppCache` 只有一个后台 worker，以下任务都共享同一个命令队列：

- 文件预览 / diff 加载
- diff stats
- file facts
- fitness
- test mapping
- scc

其中 `file facts` 还会触发 `git log --follow`，这会把真正影响操作手感的预览热路径和慢元数据任务串在一起。

## Expected Behavior

用户切换文件或 run 选中项时，预览内容应尽快更新，不能因为慢元数据任务而排队。

更具体地说：

- 文件预览 / diff 应属于 selection-critical path
- facts / git history / test mapping / fitness / scc 应属于 background enrichment path
- 即使 enrichment 很慢，主交互也应保持可用

## Reproduction Context

- Environment: desktop TUI / terminal TUI
- Trigger: 在存在多个 dirty files、snapshot 文件、大型 repo 或慢 `git log --follow` 的仓库中切换选中项

## Why This Might Happen

- `AppCache` 只有一个后台 worker，selection-critical work 和 metadata enrichment 共用一个 FIFO 队列
- `LoadFacts` 里会执行 `git log --follow`，容易形成 head-of-line blocking
- 当前 UI 循环仍偏 polling 驱动，缺少更细粒度的结果通道和热路径优先级

## Relevant Files

- `crates/harness-monitor/src/ui/cache.rs`
- `crates/harness-monitor/src/ui/tui.rs`
- `crates/harness-monitor/src/ui/panels.rs`
- `/Users/phodal/ai/codex/codex-rs/tui/src/app.rs`
- `/Users/phodal/ai/codex/codex-rs/tui/src/file_search.rs`
- `/Users/phodal/ai/codex/codex-rs/tui/src/tui/frame_requester.rs`

## Observations

- 已经做过一次 lazy preview，只读前 100 行，说明热点已从“读整文件”部分转移到“后台任务竞争”
- `codex-rs` 更接近 event-driven + feature-owned async tasks，而不是一个 omnibus worker
- 这一问题不只是性能问题，也直接影响 run/session 旅程在 UI 上的可信度，因为用户会把延迟误判成状态错误

## References

- `docs/issues/2026-04-13-harness-monitor-user-value-gap-to-decision-console.md`
