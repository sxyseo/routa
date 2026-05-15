# 看板全流程偏慢根因分析 v3（2026-05-13）

> v2 的三个根因（orphan-worktree 竞态写回、stale retry 无限循环、done 列无效重试）已全部修复。
> 本轮聚焦：修复后流程仍偏慢的结构性原因。

## 一、核心发现：轮询驱动是最大瓶颈

当前的列间流转完全依赖轮询，不是事件驱动。

打个比方：**像外卖骑手到了楼下不打电话，顾客每 30 秒下楼看一眼来没来。**

改前改后对比：

| | 改前（轮询驱动） | 改后（事件驱动） |
|---|---|---|
| 列间传递 | 完成后等 LaneScanner 30s 扫一次 | 完成后立刻通知下列 |
| 5 列空转 | ~2.5min 纯等待 | ~0s |
| 快任务（ACP 5min） | ~10min（一半时间在等） | ~5min |
| 典型任务（ACP 30min） | ~35min | ~30min |
| 最差任务（排队+重试） | ~2h+ | ~1.5h |
| 纯等待时间 | ~5min | ~0.5min |

## 二、5 个延迟源详解

### 延迟源 1：轮询驱动架构（影响最大）

每个列边界贡献 ~30s 空转等待。

| 组件 | 间隔 | 代码位置 |
|------|------|----------|
| LaneScanner | 30s（空闲 60s） | `kanban-lane-scanner.ts:41` |
| DoneLaneRecovery | */3（3min） | `scheduler-service.ts:85` |
| Overseer | */5（5min） | `scheduler-service.ts:122` |
| Auto-archive | 1h | `scheduler-service.ts:66` |
| Watchdog | 30s | `workflow-orchestrator.ts:429` |

5 列流程（backlog→todo→dev→review→done），仅轮询延迟就贡献 ~2.5min。

### 延迟源 2：Stale Retry 指数退避放大

并发满时 `createSession` 返回 null，任务进入 stale retry 循环：

```
60s (retry 1/3) → 120s (retry 2/3) → 240s (retry 3/3) → review-degraded
```

单轮 stale retry 总等待 7min。单列就可能卡 7min+。

代码位置：`workflow-orchestrator.ts:1710-1809`

### 延迟源 3：并发限制（sessionConcurrencyLimit = 3）

每板最多 3 个并发 session。10 个任务在单列时：

- 前 3 个立即创建 session
- 后 7 个排队等 stale retry 捡起
- 第 7 个任务可能等 3-5min

配置位置：`kanban-config.ts:97`

### 延迟源 4：DoneLaneRecovery 心跳注册表不一致

| 位置 | 写的间隔 |
|------|---------|
| `scheduler-service.ts:85`（实际执行） | `*/3 * * * *`（3min） |
| `system-heartbeat-registry.ts:68`（监控用） | `*/10 * * * *`（10min） |

实际执行以 scheduler-service 为准，但监控/告警按注册表判断，可能导致误判 tick 超时。

### 延迟源 5：Post-merge 归档链条长

```
PR merged → postMergeArchiveMs(60min) → auto-archive-tick(1h) → archived
```

Done 列完成后，最终归档可能等 1-2h。

配置位置：`kanban-config.ts:90`

## 三、量化延迟模型

### 任务全生命周期时间线

假设任务走 backlog→todo→dev→review→done：

| 阶段 | 最小 | 典型 | 最差 |
|------|------|------|------|
| backlog→todo（LaneScanner 拾取） | 0s | 30s | 60s |
| todo session 创建 | 即时 | 30s | 7min（stale retry） |
| todo ACP 执行 | 取决于任务 | ~5min | ~30min |
| todo→dev（autoAdvance + LaneScanner） | 0s | 30s | 60s |
| dev ACP 执行 | 取决于任务 | ~10min | ~30min |
| dev→review | 0s | 30s | 60s |
| review ACP 执行 | 取决于任务 | ~3min | ~15min |
| review→done | 0s | 30s | 60s |
| done→PR 创建 | 即时 | 3min | 10min |
| PR merge 等待 | 即时 | ~2min | ~10min |
| done→COMPLETED | 即时 | 即时 | 3min |
| **总计（不含 ACP 执行）** | ~0s | ~5min | ~30min |
| **总计（含 ACP 执行）** | ~18min | ~35min | ~2h+ |

### 轮询开销占比

| ACP 执行时间 | 轮询开销 | 占比 |
|-------------|---------|------|
| 5min（快任务） | ~5min | **50%** |
| 18min（中任务） | ~5min | 22% |
| 30min（慢任务） | ~5min | 14% |

**结论**：快任务受轮询影响最大（一半时间在等），慢任务影响较小（ACP 执行本身是瓶颈）。

## 四、优化建议

| 优先级 | 方案 | 预期收益 | 改动量 | 涉及文件 |
|--------|------|----------|--------|---------|
| **P0** | autoAdvanceCard 完成后直接 emit COLUMN_TRANSITION，不走 LaneScanner | 每列省 30s，快任务总时间降 **50%** | 中 | `workflow-orchestrator.ts` |
| **P0** | 修正心跳注册表 interval 为 `*/3` | 监控准确反映实际间隔 | 1 行 | `system-heartbeat-registry.ts:68` |
| P1 | stale retry 首轮从 60s 降到 15s | 最差场景降 45s/轮 | 小 | `kanban-config.ts` |
| P1 | 提高并发限制或实现优先级队列 | 减少排队延迟 | 小 | `kanban-config.ts` |
| P2 | post-merge 归档改为事件驱动 | done→archived 降 30-60min | 中 | `workflow-orchestrator.ts` |

## 五、改前改后效果（小白话）

### 改前——「等红灯的流水线」

1. 包裹到了一个工位，没人通知下一个工位。下一个工位只能每 30 秒扭头看一眼「有没有新包裹来啊？」——没来就继续等，来了才开工。
2. 每过一道工序，就白白等一个「扭头看」的周期（30 秒）。5 道工序 = 5 个 30 秒 = 至少 2.5 分钟在干等。
3. 如果工位 3 台机器都满了（并发限制 = 3），后面的包裹要排队。排队不是秒级提醒，而是每分钟回头看一眼——前面的走了没？没走继续等。
4. 最惨情况：一个简单任务，AI 写代码 5 分钟就搞定了，但在各个工位之间等来等去又多花 5 分钟。**一半时间在等，一半时间在干活**。
5. 任务做完到最终归档，最长要等 1-2 小时，明明已经完了就是收不了尾。

### 改后——「打铃的流水线」

1. 包裹一完成，工位立刻按铃通知下一个工位——零等待，直接开工。不用 30 秒回头看，改成「来了就干」。
2. 5 道工序之间的空转从 2.5 分钟降到接近 0。
3. 排队包裹也更快被捡起来——从每分钟看一次改成每 15 秒看一次。
4. 归档也不用等 1 小时了——PR 一合并立刻触发收尾。

## 六、附录：关键代码引用

| 文件 | 关键行 | 说明 |
|------|--------|------|
| `kanban-lane-scanner.ts` | :41 | SCAN_INTERVAL_MS = 30s |
| `workflow-orchestrator.ts` | :427-429 | Watchdog 30s 定时器 |
| `workflow-orchestrator.ts` | :1710-1809 | Stale retry 指数退避逻辑 |
| `workflow-orchestrator.ts` | :2259-2349 | autoAdvanceCard（P0 改造目标） |
| `scheduler-service.ts` | :85 | DoneLaneRecovery 实际 cron */3 |
| `system-heartbeat-registry.ts` | :68 | DoneLaneRecovery 注册表 interval */10 |
| `kanban-config.ts` | :80-105 | 所有默认参数 |
| `health-tick.ts` | :136-270 | Overseer AUTO actions（已全部用 safeAtomicSave） |
