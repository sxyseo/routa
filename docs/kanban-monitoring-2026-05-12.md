# 看板流水线监控报告 (2026-05-12)

## 监控时间线

| 时间 | 事件 |
|------|------|
| 04:04 | 开始监控，COMPLETED: 13 |
| 04:38 | Claude SDK 首次崩溃 (exit code 3221226505) |
| 04:48-06:40 | **系统死锁** ~2h，所有活跃会话静默 |
| 06:40-06:45 | 系统自恢复，批量创建 7+ backlog-refiner |
| 06:45:45 | **服务崩溃** (STACK_BUFFER_OVERRUN)，停运 1h17m |
| 08:02 | 手动重启服务 |
| 08:04-08:09 | RestartRecovery 恢复，首批会话创建 |
| 08:19 | review-degraded 级联（~16 张卡片） |
| 08:19-08:20 | 批量会话创建爆发（6+ backlog-refiner + dev-executor） |

## 最终状态 (08:20)

- COMPLETED: 13, IN_PROGRESS: 4, REVIEW_REQUIRED: 1, PENDING: 46, ARCHIVED: 2
- 活跃任务: T5-01 (AI网关), T4-04b (黑名单CRUD), T6-01a (图片上传), TF-10c (黑名单管理, review中)

---

## 问题 1: Claude SDK 周期性崩溃 (Windows STACK_BUFFER_OVERRUN)

**现象**: `Claude Code process exited with code 3221226505` (Windows 错误码 0xC0000409 = STACK_BUFFER_OVERRUN)

**发生时间**: 04:38, 06:41, 06:45:45 (导致服务整体崩溃)

**根因**: Windows 平台上 `@anthropic-ai/claude-agent-sdk` 的 Node.js 进程在高并发会话负载下触发栈缓冲区溢出。每次崩溃杀死 2 个活跃会话。

**影响**:
- 活跃会话丢失，任务中断
- 06:45 的崩溃直接导致整个 dev server 进程退出
- 服务停运 1h17m (06:45→08:02)

**临时方案**: 监控到服务不可达时执行 `npm run dev` 重启

**改进建议**:
- 降低并发会话数上限，避免触发 Windows 栈溢出
- 添加进程守护（如 pm2）实现自动重启
- 考虑 Linux 部署环境规避 Windows 特定问题

---

## 问题 2: 并发会话限制导致 review-degraded 级联

**现象**: ~16 张卡片在 stale retry 3/3→4/3 后被标记为 review-degraded，然后在新一轮 retry 中再次重复此循环

**根因**: 系统并发会话上限（约 12 个活跃 session）远小于待处理卡片数。大量排队会话无法在 stale 超时窗口内获得执行机会。

**循环模式**:
1. RestartRecovery 排队 ~18 个会话
2. 仅 1-3 个获得并发槽位
3. 剩余会话等待 → stale retry 1/3 → 2/3 → 3/3 → 4/3 → review-degraded
4. review-degraded 释放槽位 → 新一轮排队 → 重复

**影响**: 47 张 PENDING 卡片中的大部分反复在 degraded/queued 间循环，有效推进缓慢

**改进建议**:
- 提高并发上限（如果硬件允许）
- 实现优先级队列，优先调度 dev/review 阶段而非全部 backlog
- 增大 stale 超时窗口，给会话更多创建时间

---

## 问题 3: WorkflowOrchestrator stale retry 计数器异常

**现象**: stale retry 计数器达到 4/3 后才触发 review-degraded 标记，而非预期的 3/3

**相关卡片**: 1bd94115, ca7fcaf1, abb0591d 等多张卡片均在 4/3 时被标记

**根因**: 重启后 stale retry 计数器可能未正确重置。RestartRecovery 将卡片标记为 "queued" 但不清零计数器，导致继承之前的计数。

**代码位置**: `WorkflowOrchestrator` 的 stale retry 逻辑

**影响**: 低。最终仍会标记 review-degraded，仅多一轮延迟

---

## 问题 4: BranchPlan 远程分支不可用

**现象**: `[BranchPlan] None of the base branch candidates [main] exist on remote. Falling back to "main".`

**频率**: 几乎每次会话创建都会触发

**根因**: Git 远程仓库配置问题，`main` 分支不在 remote tracking branch 列表中。系统 fallback 到本地 `main`。

**影响**: 非关键。Worktree 从本地 main 创建，功能正常。但可能导致 worktree 与远程不同步。

---

## 问题 5: NODE-CRON 调度丢失

**现象**: `[NODE-CRON] [WARN] missed execution at ... Possible blocking IO or high CPU`

**频率**: 多次，尤其在批量会话创建期间

**根因**: node-cron 与主进程共享事件循环，批量 Claude SDK 进程启动时的阻塞 IO 导致 cron 回调无法按时执行

**影响**: Overseer/DoneLaneRecovery tick 延迟，但下一周期自动恢复

---

## 关键依赖链分析

**阻塞最严重的瓶颈任务**:
1. **T2-01 订单创建** → 阻塞 T2-02, T2-03, T4-02, T4-03, T6-02 及其全部下游 TF 页面
2. **T5-01 AI网关** → 阻塞 TF-09, TF-11~TF-14 所有 AI 相关页面
3. **T4-01 消费者首页** → 阻塞 TF-19, TF-20, T4-02 及其下游

**T7-01 前后端联调** 被 30+ 任务阻塞，是最终集成门。

## 有效产出

- 2 小时监控期间，COMPLETED 数保持 13 不变
- 服务实际可用时间约 2.5h（04:00-06:45 + 08:02-08:30），其中 ~1h 用于死锁恢复
- 有效推进: 若干任务从 backlog→todo→dev→review，但未新增 COMPLETED
