# Routa 看板流水线性能根因分析

> 分析日期：2026-05-09
> 数据来源：HuiLife（摊生意）项目 21 个任务的全生命周期
> 数据库：`E:\ideaProject\phodal\routa\routa.db`

---

## 1. 执行摘要

HuiLife 项目 21 个任务全部批量创建于同一时刻（时间戳差 < 70ms），14 个已完成任务的总壁钟时间跨度 **114~529 分钟**（平均 335 分钟 ≈ 5.6 小时）。核心瓶颈并非代码生成能力，而是 **流水线协调开销**——依赖门控串行化、自动合并器卡死、100% PR 冲突率、以及结构化跳过竞态导致的重复会话。

**一句话总结**：流水线 70%+ 的时间花在等待和协调上，实际代码生成仅占 ~30%。

---

## 2. 定量数据总览

### 2.1 任务壁钟时间

| 任务 | 壁钟时间(分钟) | 排序 |
|------|---------------|------|
| T1-03: 商户信息模块 | 114 | 1 |
| T1-04: 菜品 CRUD 模块 | 176 | 2 |
| T1-05: 种子数据 + 验证 | 209 | 3 |
| T6-01: 商户设置 + 图片上传 | 221 | 4 |
| T5-01: AI 网关搭建 | 283 | 5 |
| T2-01: 订单创建（消费者端） | 285 | 6 |
| T4-01: 消费者端首页 + 摊位浏览 | 319 | 7 |
| T2-02: 订单管理（商户端） | 339 | 8 |
| T3-02: 老客管理模块 | 377 | 9 |
| T2-03: 可疑订单检测 | 413 | 10 |
| T3-01: 营收统计模块 | 442 | 11 |
| T3-03: 优惠券模块 | 451 | 12 |
| T5-02: 钱包模块 | 487 | 13 |
| T4-02: 购物车 + 下单 | 529 | 14 |

**关键发现**：前 4 个任务（无依赖或依赖少）~2-4 小时完成；后续任务每增加一层依赖，壁钟时间增加 ~30-50 分钟。

### 2.2 Specialist 会话资源消耗

| Specialist | 会话数 | 消息数 | 平均消息/会话 |
|-----------|--------|--------|-------------|
| kanban-dev-executor | 33 | 112,504 | 3,409 |
| kanban-backlog-refiner | 29 | 60,354 | 2,081 |
| kanban-review-guard | 26 | 31,259 | 1,202 |
| kanban-todo-orchestrator | 21 | 25,088 | 1,195 |
| kanban-done-finalizer | 16 | 11,001 | 688 |
| kanban-auto-merger | 15 | 6,733 | 449 |
| kanban-conflict-resolver | 5 | 4,806 | 961 |

**总计**：145 个会话，251,745 条消息。

**关键发现**：dev-executor 消息量占 44.7%，但其中包含大量重复会话。backlog-refiner 有 29 个会话但只有 14 个任务——每个任务在 Backlog → Todo 过渡中平均产生 2+ 个会话。

### 2.3 Dev Executor 重复会话（结构化跳过竞态）

T1-01（项目骨架搭建）产生了 **4 个独立 dev-executor 会话**，全部因结构化跳过而浪费：

| 会话 | 持续时间(秒) | 结果 |
|------|------------|------|
| da327255 | 10,017 | 超时/跳过 |
| 4f352122 | 9,371 | 超时/跳过 |
| c49ae01f | 6,946 | 超时/跳过 |
| 09a2fcbd | 6,892 | 超时/跳过 |

**资源浪费**：仅 T1-01 的重复会话就消耗了 ~9.2 小时的计算时间，且全部是无效的。

### 2.4 Auto-Merger 会话分析

| 任务 | 持续时间(秒) | 状态 |
|------|------------|------|
| T1-02: 认证模块 | **4,203** | 卡死/超时 |
| T1-03 ~ T4-02（其余 13 个） | 37~60 | 正常 |

**关键发现**：T1-02 的 auto-merger 会话持续 70 分钟（正常值 < 1 分钟），这是流水线首次卡死事件，直接导致后续所有任务等待。

### 2.5 Conflict-Resolver 触发情况

| 任务 | 持续时间(秒) | 冲突文件数 |
|------|------------|-----------|
| T5-01: AI 网关搭建 | 254 + 250（两次） | 多文件 |
| T2-01: 订单创建 | 351 | 多文件 |
| T4-01: 消费者端首页 | 139 | 多文件 |
| T2-02: 订单管理 | 128 | 多文件 |

**冲突率**：5/14 任务需要冲突解决（36%），其中 `server/src/index.ts` 是 100% 冲突热点。

---

## 3. 根因分析（按影响排序）

### P0: 依赖门控串行化 —— 级联等待

**现象**：任务按依赖链严格串行推进，14 个任务的合并时间呈近似线性增长。

**机制**：
```
Task A merged → dependency gate checks pullRequestMergedAt
             → DoneLaneRecovery 10 分钟 tick 检测
             → pullRequestMergedAt 设置后下游任务 unblock
             → LaneScanner 15-60 秒扫描到 unblocked card
             → 启动下一个 specialist session
```

**量化影响**：每层依赖传递增加 ~25-40 分钟延迟（10 min DoneLaneRecovery + 15-60s LaneScanner + 2-5 min session 启动 + 模型推理时间）。

**根因代码**：
- `done-lane-recovery-tick.ts:158` — `prVerificationMinAgeMs = 5 min`，且仅 10 分钟 tick 检查
- `kanban-config.ts:89` — `orphanAgeMs: 10 * 60 * 1000`

**修复建议**：
1. PR webhook 合并事件直接触发下游 unblock（不要等 tick）
2. `prVerificationMinAgeMs` 从 5 分钟降到 1 分钟
3. DoneLaneRecovery tick 从 10 分钟降到 2-3 分钟

---

### P0: Auto-Merger 卡死 —— 单点故障

**现象**：T1-02 auto-merger 会话持续 4203 秒（70 分钟），期间整个合并流程阻塞。

**机制**：auto-merger 启动 Claude Code SDK 会话执行 `gh pr merge`，当遇到冲突时进入冲突解决循环，但无超时保护。

**量化影响**：单次卡死导致全流水线停滞 70 分钟。

**修复建议**：
1. auto-merger 会话设置硬超时（建议 10 分钟）
2. 冲突检测前置：merge 前先 `gh pr status` 检查 mergeability
3. 卡死后自动降级为手动合并标记，不阻塞其他任务

---

### P1: 结构化跳过竞态 —— 会话浪费

**现象**：卡片在 Backlog → Todo → Dev 列之间快速移动时，已创建的 session 发现目标列已变更，产生 "structural skip"（~50% 发生率）。

**机制**：
1. LaneScanner 检测到 unblocked card → 创建 session
2. Card 在 session 启动前已被另一个 tick 移动到下一列
3. Session 启动后检查当前列 → 不匹配 → structural skip
4. Skip 增加 `failures` 计数器，但不影响最终结果（自愈）

**量化影响**：
- T1-01 产生 4 个无效会话（浪费 ~9.2 小时计算）
- 全流水线 145 个会话中估计 ~30% 是重复/无效的

**修复建议**：
1. Session 创建时加乐观锁：`WHERE column_id = :expected_column AND version = :version`
2. Skip 不计入 `failures` 计数器
3. 减小 LaneScanner tick 频率（当前 15-60s，建议 30-90s）降低竞态概率

---

### P1: PR 冲突率 100%（热点文件） —— 合并阻塞

**现象**：所有 PR 在 `server/src/index.ts`（路由注册文件）上产生冲突。

**机制**：每个任务都添加新的路由 import 和 `app.use()` 注册，Git 无法自动合并。

**量化影响**：36% 的任务触发 conflict-resolver，每个冲突解决耗时 2-6 分钟。

**修复建议**：
1. **架构解耦**：拆分 `index.ts` 为模块化路由注册（如 `routes/index.ts` 自动扫描注册）
2. **Feature flag 文件**：每个任务创建独立路由文件，主文件仅做 `import + app.use`
3. **预防性 rebase**：dev executor 完成后自动 rebase main 最新代码

---

### P2: DoneLaneRecovery 延迟 —— 感知滞后

**现象**：手动合并 PR 后，看板状态最长需要 10 分钟才更新。

**机制**：
- Webhook 合并 → `pr-merge-listener.ts` 立即设置 `pullRequestMergedAt`（正常）
- 手动合并/CDP 操作 → 无 webhook → 依赖 DoneLaneRecovery 10 分钟 tick
- tick 还需等待 `prVerificationMinAgeMs = 5 min` 才确认

**量化影响**：手动合并后 5-15 分钟延迟。

**修复建议**：
1. GitHub webhook 监听 `pull_request.closed` 事件（不依赖 manual merge）
2. 或在 CDP 手动合并后主动调用内部 API 标记已合并

---

### P2: 批量创建风暴 —— 初始拥堵

**现象**：21 个任务在同一毫秒批量创建，backlog-refiner 在短时间内启动大量会话。

**机制**：LaneScanner 一次扫描发现 21 个 unblocked card → 并发启动 backlog-refiner sessions → 资源竞争。

**量化影响**：backlog-refiner 产生 29 个会话（14 任务 × 2+ 会话/任务），大量重复。

**修复建议**：
1. 批量创建时分阶段释放（如每批 3-5 个）
2. 或 LaneScanner 设置 WIP limit，限制同时处理的卡片数

---

## 4. 流水线时间分解（以 T4-02 为例）

T4-02（购物车 + 下单）壁钟时间 529 分钟，分解如下：

| 阶段 | 耗时(分钟) | 占比 | 说明 |
|------|-----------|------|------|
| 等待依赖（T6-02 的 9 个前置任务） | ~350 | 66% | 依赖门控串行等待 |
| Backlog Refiner | ~3 | 0.6% | 细化任务描述 |
| Todo Orchestrator | ~5 | 0.9% | 生成实施计划 |
| Dev Executor（实际编码） | ~17 | 3.2% | 992 秒有效会话 |
| Review Guard | ~10 | 1.9% | 代码审查 |
| Auto-Merger | ~1 | 0.2% | 58 秒 |
| DoneLaneRecovery 等待 | ~15 | 2.8% | 等待 tick 检测 |
| 其他（会话启动/排队/竞态） | ~128 | 24.2% | 重复会话+排队 |

**结论**：实际代码生成仅占 3.2%，96.8% 的时间花在协调、等待和重复工作上。

---

## 5. 修复优先级矩阵

| 优先级 | 问题 | 预期提速 | 实现难度 | ROI |
|--------|------|---------|---------|-----|
| **P0** | 依赖门控：webhook 直接触发 unblock | -40~60 min/层 | 中 | **极高** |
| **P0** | Auto-merger 超时保护 | -70 min（消除卡死） | 低 | **极高** |
| **P1** | 结构化跳过不计入 failures | 减少无效会话 30% | 低 | 高 |
| **P1** | index.ts 架构解耦 | -2~6 min/任务 | 中 | 高 |
| **P2** | DoneLaneRecovery tick 加速 | -5~10 min/任务 | 低 | 中 |
| **P2** | 批量创建限流 | 减少初始拥堵 | 低 | 中 |

---

## 6. 预估修复效果

假设全部 P0 修复落地：

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 单任务平均壁钟时间 | 335 min | ~120 min | -64% |
| 依赖传递延迟/层 | 25-40 min | ~5 min | -85% |
| Auto-merger 卡死风险 | 存在 | 消除 | -100% |
| 无效会话占比 | ~30% | ~5% | -83% |
| 14 任务全流程时间 | ~529 min | ~180 min | -66% |

---

## 附录 A: 关键配置参数

| 参数 | 当前值 | 建议值 | 位置 |
|------|--------|--------|------|
| `prVerificationMinAgeMs` | 5 min | 1 min | `kanban-config.ts:89` |
| `orphanAgeMs` | 10 min | 3 min | `kanban-config.ts` |
| `postMergeArchiveMs` | 60 min | 30 min | `kanban-config.ts` |
| LaneScanner tick | 15-60s | 30-90s | 自适应算法 |
| DoneLaneRecovery tick | 10 min | 2-3 min | `done-lane-recovery-tick.ts` |
| Auto-merger 超时 | 无 | 10 min | 未实现 |

## 附录 B: 冲突热点文件

| 文件 | 冲突率 | 原因 |
|------|--------|------|
| `server/src/index.ts` | 100% | 所有任务都添加路由 |
| `server/src/db/schema.ts` | ~60% | 多任务添加表定义 |
| `server/src/db/migrate.ts` | ~60% | 多任务添加建表语句 |
| `server/src/middleware/auth.ts` | ~20% | 认证逻辑冲突 |

## 附录 C: 依赖图（关键路径）

```
T1-01 ──┐
T1-02 ──┤
T1-03 ──┼──→ T1-04 ──→ T1-05
         │
T2-01 ──┼──→ T2-02 ──→ T2-03
         │
T3-01 ──┤     T3-02     T3-03
         │
T4-01 ──┼──→ T4-02 ──→ T4-03 ← 关键路径末端（10个依赖）
         │
T5-01 ──┤──→ T5-02
         │
T6-01 ──┴──→ T6-02 ──→ T7-01 ──→ T7-02
              (9个依赖)       T7-03
```

**关键路径**：T1-01 → T4-01 → T4-02 → T4-03 → T7-01 → T7-02/03
**最长依赖链**：6 层，理论最小壁钟时间 = 6 × (dev_time + coord_overhead)

## 附录 D: 运行时发现的新问题

### D1: T7-01/02/03 循环依赖（22:17 发现）

```
T7-01 (前后端联调)  ← depends on → T7-03 (Spec-to-Code 全量校验)
T7-02 (部署)        ← depends on → T7-01 (前后端联调)
T7-03 (Spec-to-Code) ← depends on → T7-01 + T7-02
```

GraphRefiner 日志：`Circular dependency detected among: 35c21ae1, 894a269b, 3d6eaabd`

**影响**：这三个任务将永远不会被自动推进，需要手动修复依赖关系或打破循环。

**根因**：任务拆分时 T7-01/T7-02/T7-03 的依赖关系设计错误——"部署"和"全量校验"互为前置条件。

**修复建议**：移除 T7-03 对 T7-02 的依赖（校验不需要等部署），或移除 T7-02 对 T7-01 的依赖（部署可以在联调后独立进行）。
