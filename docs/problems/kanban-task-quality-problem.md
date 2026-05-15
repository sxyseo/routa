# Routa 看板系统：任务质量问题分析

> 日期：2026-05-08
> 状态：方案已确定，待实施

## 1. 背景

- Routa 是 AI-native 看板驱动开发平台
- 用户画像：全栈技术人员，略懂架构，懒，不想看代码
- 执行层已完善：7 列流水线 + 8 种 Specialist Agent + 三层恢复机制 + 35/63 个文件处理 recovery/retry/fail/stuck

## 2. 问题

**执行层已经能跑，但任务本身合不合理？任务本身有没有管理？**

| 子问题 | 现状 |
|--------|------|
| 任务从哪来？ | 用户一句话通过界面创建，直接进 Backlog，没有甄选 |
| 任务合不合理？ | Backlog Refiner 只做文本润色，无法判断任务质量 |
| 任务有没有管理？ | 只有 Delivery 轨道，没有 Discovery 轨道 |
| 任务之间关系对不对？ | 系统按单卡片处理，看不到任务之间的依赖图 |

### 根因

**系统按单卡片维度处理任务，但任务本质上是一个依赖图。缺乏图级别的分析能力——依赖推断、拓扑排序、完整性检查、冲突检测。**

更深层：系统只有交付流水线（Delivery），没有需求质量的把关机制（Discovery）。Backlog Refiner 被禁止访问代码（`agent-trigger.ts` 的 guardrail），不可能做出有信息量的判断。

## 3. 真实数据验证

数据来源：routa.db, 2026-05-08，餐饮小程序后端 + AI 服务项目。

### 3.1 任务分布

- 活跃任务 21 条（排除 20 条 ARCHIVED），分 5 个阶段

| 阶段 | 完成 | 进行中 | 待做 | 合计 |
|------|------|--------|------|------|
| 阶段1 基础搭建 | 4 | 0 | 0 | 4 |
| 阶段2 核心 API | 1 | 2 | 4（3 个被依赖阻塞） | 7 |
| 阶段3 AI 服务 | 3 | 1（被依赖阻塞） | 0 | 4 |
| 阶段4 营销功能 | 0 | 0 | 3（全部被依赖阻塞） | 3 |
| 阶段5 部署运维 | 0 | 0 | 3（全部被依赖阻塞） | 3 |

### 3.2 依赖链

```
阶段1: Express初始化 → Drizzle ORM → 全局错误处理 (串行)
                          ↓
阶段2: 商户注册登录 → 商户信息CRUD → 菜品管理CRUD → 消费者下单 → 订单生命周期 → 每日统计
                                                                    ↓            ↓
阶段4: 优惠券(依赖注册+ORM)                                    客户追踪      二维码
                                                                  ↓            ↓
阶段5:                                            Nginx配置 ← 优惠券+二维码
       frp配置 ← 优惠券+二维码
       健康检查 ← 订单生命周期
```

### 3.3 数据揭示的问题

1. **10/21 任务被 `dependency_blocked`**——接近一半在等待
2. **一个任务（菜品管理CRUD）阻塞了 6 个下游任务**
3. **阶段2 纯串行**（注册→商户→菜品→下单→订单→统计），但阶段3 和阶段2 的部分任务可以并行——用户设了依赖但可能设得保守了
4. **依赖关系无法验证**——优惠券依赖"Drizzle ORM"而不是"商户信息CRUD"，看起来合理但系统无法确认
5. **多个任务经历了 5-11 次会话**（商户注册登录 11 次、Drizzle ORM 9 次），说明执行有反复
6. **9/21 任务缺 `verification_commands`**——还没被 Refiner 处理过

## 4. 执行层代码验证

> 基于源码深入分析，确认执行层已完善，缺口在规划层。

### 4.1 已完善的能力

| 能力 | 文件 | 说明 |
|------|------|------|
| `dependency_inherit` 分支策略 | `branch-plan.ts` | 递归遍历 `task.dependencies` 链找 base branch，`visited` Set 防循环依赖，已合并依赖自动跳过 |
| PR 合并后 rebase 下游 | `pr-merge-listener.ts:194-207` | `rebaseDownstream = true`，对所有共享 codebase 的 dev 列 worktree 执行 `rebaseBranchSafe` |
| 主仓库 fetch 同步 | `pr-merge-listener.ts:149-168` | PR 合并后调用 `fetchAndFastForward(cb.repoPath, { forceReset: true })` |
| Worktree 创建 + 依赖感知 base | `ensure-task-worktree.ts` | 基于最新 main 创建 worktree，`resolveDependencyBaseBranch()` 找到正确的 base |
| 依赖解锁 | `pr-merge-listener.ts:210-239` | PR 合并后清除 `dependency_blocked` 错误，重新触发 `COLUMN_TRANSITION` |

### 4.2 关键缺口

**Worktree 只在进入 dev 列时创建**（`board-branch-rules.ts`: `worktreeCreationColumns: ["dev"]`）：

| 阶段 | 有 Worktree | 能看到最新代码 | 原因 |
|------|------------|--------------|------|
| Backlog | 否 | **否** | Refiner 无 worktree，`agent-trigger.ts` 禁止 Read/Grep/Glob |
| Todo | 否 | **否** | 无 worktree，没有代码上下文 |
| Dev | 是 | **是** | `ensure-task-worktree` + `resolveDependencyBaseBranch` |
| Review | 是 | **是** | worktree 已存在，PR 合并后会被 rebase |

### 4.3 核心矛盾

```
任务A 完成 → PR 合入 main
  → fetchMainCodebase() 更新主仓库 refs ✅
  → dev 列任务 worktree rebase ✅
  → backlog/todo 列任务无感知 ❌（没有 worktree）

任务B（backlog）→ Refiner 分析时
  → agent-trigger.ts 禁止 Read/Grep/Glob ❌
  → 无法读代码做增量分析

任务B → backlog → todo → dev 时
  → 基于最新 main 创建 worktree ✅
  → resolveDependencyBaseBranch() 找到正确的 base ✅
  → 执行时能看到 A 产出的代码 ✅
```

**结论：分支同步在执行层（Dev 列）已完善。问题是规划层（Backlog/Todo 列）没有代码上下文——这不是分支同步问题，是规划 Agent 能力问题。**

### 4.4 从 0-1 的动态性

从 0-1 不是静态快照——第一批任务面对空项目，后续任务面对越来越完整的代码库。任务规划应该分阶段：Backlog 规划时信息量少，推进到 Todo/Dev 时信息量多，需要二次规划的机会。

## 5. 提议的解法：两层规划，按信息量递进

> 核心矛盾：任务规划的信息量和执行时机不匹配——规划太早（信息少），执行太晚（信息多），中间没有修正机会。

现在的信息量只在 Dev 列才跃升：

```
Backlog（纯文本）→ Todo（纯文本）→ Dev（有代码）→ 执行
     规划               规划          规划+执行
   信息量：低          信息量：低     信息量：高
```

解法：在两个关键节点各做一次规划，每次都用当时能获得的最大信息量。

### 5.1 第一层：图级结构分析（Backlog，不依赖代码）

**目标**：保证任务集合的整体结构正确——依赖、顺序、完整性。

现有 Refiner 逐卡处理，看不到其他卡片。新增 **Graph Refiner**，分析整个 Backlog 的任务集合。

全部基于纯文本推理，不依赖代码：

| 能力 | 解决什么 | 例子 |
|------|---------|------|
| **依赖推断** | 用户不设依赖或设错 | "数据库 schema" 应该依赖 "Drizzle ORM" |
| **拓扑排序** | 建议执行顺序 | schema → ORM → API → 前端 |
| **关键路径识别** | 找到瓶颈任务 | "菜品管理CRUD" 阻塞了 6 个下游 |
| **并行机会发现** | 减少不必要的串行等待 | 阶段3 可以和阶段2 并行 |
| **完整性检查** | 发现隐含缺失的子任务 | 有了 API 但没有路由定义？ |
| **冲突检测** | 两个任务对同一模块的假设矛盾 | 任务A 假设 REST，任务B 假设 GraphQL |

代码基础：`task-split-topology.ts` 已有 `topologicalSort()` 和 `detectFileConflicts()`，目前只用于拆分场景，可扩展。

从 0-1 场景：完全工作，因为纯文本推理不依赖代码库是否存在。

### 5.2 第二层：代码感知二次规划（Todo→Dev 边界）

**目标**：保证单个任务的规划精确——scope、acceptance criteria、影响范围。

任务从 Todo 推进到 Dev 时，在创建 worktree 之前做一次自动重规划。此时 `fetchMainCodebase()` 已确保主仓库 refs 最新。

```
Todo → [二次规划：基于最新代码重新评估] → Dev（创建 worktree + 执行）
         ↑
         可以读到已合入 main 的所有代码
         用现有的 fetchAndFastForward 结果
```

- 代码库存在：读代码，校验 scope 是否合理，调整 AC，识别文件级影响范围
- 代码库不存在（从 0-1 早期）：降级为纯文本分析，和第一层等价
- 全自动，不需要人工干预

代码基础：`agent-trigger.ts` 的 guardrail 需要修改（允许只读工具），`fetchMainCodebase` 机制可复用。

### 5.3 两层的关系

```
Backlog（N个任务）                    Todo → Dev（单个任务）
┌─────────────────────────┐          ┌─────────────────────────┐
│ Graph Refiner           │          │ Code-Aware Re-plan      │
│                         │          │                         │
│ 输入：所有任务的文本     │          │ 输入：该任务 + 最新代码  │
│ 输出：                   │   ──→    │ 输出：                   │
│  - 推断的依赖关系        │          │  - 基于代码的 scope 校验 │
│  - 建议的执行顺序        │          │  - 更精确的 AC           │
│  - 关键路径和瓶颈        │          │  - 文件级的影响范围      │
│  - 缺失和冲突           │          │                         │
│ 约束：不依赖代码         │          │ 约束：优雅降级          │
└─────────────────────────┘          └─────────────────────────┘
     解决"任务集合的                      解决"单个任务的
      结构是否合理"                       规划是否精确"
```

### 5.4 两个场景的统一

- **从 0-1**：第一层完整工作（纯文本），第二层早期降级为文本、后期逐步获得代码上下文
- **从 1 到 N**：两层都完整工作，第二层价值更大

## 6. 代码改动清单

### 需要改动的

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 Graph Refiner | 新文件，基于 `task-split-topology.ts` 扩展 | 图级分析：依赖推断、拓扑排序、完整性检查 |
| 修改 Backlog guardrail | `agent-trigger.ts` | 允许 Refiner 使用只读工具（Read/Grep/Glob），带降级逻辑 |
| 增加二次规划步骤 | Todo→Dev 过渡逻辑 | 复用 `fetchMainCodebase` 机制，在创建 worktree 前重规划 |

### 不需要改动的（已验证完善）

| 能力 | 文件 |
|------|------|
| `dependency_inherit` 分支策略 | `branch-plan.ts` |
| PR 合并后 rebase 下游 | `pr-merge-listener.ts` |
| 主仓库 fetch 同步 | `pr-merge-listener.ts` |
| Worktree 创建 + 依赖感知 base | `ensure-task-worktree.ts` |

## 7. 行业框架交叉验证

用 6 个成熟框架逐条验证，确认方向正确并暴露盲区。

### 7.1 验证结果总表

| 框架 | 方向验证 | 暴露的盲区 |
|------|---------|-----------|
| **WSJF**（SAFe/Reinertsen） | 拓扑排序 = Job Sequencing ✅ | 缺经济优先级（Cost of Delay） |
| **看板方法**（David Anderson） | Flow + Feedback Loop ✅ | 缺 WIP Limit、Commitment Point 未解决 |
| **Plan-and-Solve**（Wang et al., ACL 2023） | 两阶段结构直接映射 ✅ | 触发条件需明确 |
| **双轨敏捷**（Marty Cagan） | 补 Discovery 方向正确 ✅ | 全自动 vs 用户参与的取舍 |
| **CPM**（关键路径法） | 关键路径分析完全对齐 ✅ | 依赖推断的不确定性 |
| **HTN**（层次任务网络） | 两层抽象层次划分 ✅ | 可能需要更多层次、领域知识注入 |

### 7.2 共识与盲区

**方向共识**：6 个框架一致验证"先规划再执行，按信息量递进"。

**独立暴露的同一盲区**：看板方法、双轨敏捷、WSJF 三个框架独立指向 **Commitment Point（需求甄选）**——系统照单全收所有输入，没有"要不要做"的把关。不在当前方案范围内，作为后续独立议题。

### 7.3 需加入方案的补充项

| 补充项 | 来源 | 说明 |
|--------|------|------|
| **WIP Limit** | 看板方法硬性要求 | 限制 Dev 列同时执行的任务数量 |
| **依赖可信度标记** | CPM 暗示 | 推断出的依赖标记可信度，在第二层验证时修正 |
| **层次扩展预留** | HTN 暗示 | 架构不锁死两层，预留第三层可能性 |

### 7.4 各框架详细验证

#### WSJF（Weighted Shortest Job First）

核心：任务优先级 = Cost of Delay ÷ Job Duration。排序比估算单个任务的绝对价值更重要。

> "Job sequencing — rather than theoretical individual job value — produces the best results." — SAFe WSJF

- Graph Refiner 的拓扑排序本质就是 job sequencing
- WSJF 提倡"频繁重排优先级"，第二层 Code-Aware Re-plan 正是在 Todo→Dev 边界做重排
- 缺口：没有"哪个任务延迟代价最大"的判断（Cost of Delay），也没有任务复杂度自动评估（Job Duration）。短期可接受，长期需补

#### 看板方法（Kanban Method）

核心：4 原则 + 6 实践。最相关的 4 个实践：

- **Manage Flow → Graph Refiner**：管理任务集合的流转结构，而非单个任务的产出
- **Feedback Loops → Code-Aware Re-plan**：获得代码信息后回头修正规划
- **Make Policies Explicit → 依赖关系可视化**：推断的依赖和关键路径应让用户看到
- **Limit WIP**：方案没有限制 Dev 列同时在执行的任务数——这是看板方法的硬性要求
- **Commitment Point**：两层都在交付流水线内部，真正的"要不要做"甄选没有解决

#### Plan-and-Solve（Wang et al., ACL 2023）

核心：将复杂任务规划分为两阶段——先制定计划分解子任务，再按计划执行。

> "First, devising a plan to divide the entire task into smaller subtasks, and then carrying out the subtasks according to the plan."

- Graph Refiner = Plan 阶段，Code-Aware Re-plan = Solve 前的校准阶段——直接映射
- 论文实验表明 Plan-and-Solve 在多个基准上优于单阶段直接回答，实证了"先规划再执行"
- 差异：论文假设子任务独立或顺序，方案的 Graph Refiner 增加了依赖图维度（由 HTN 支撑）

#### 双轨敏捷（Dual-Track Agile）

核心：Discovery（发现"做什么对"）和 Delivery（交付"高效地做"）是两条独立轨道。

- 方案本质上在补 Discovery 轨道：Graph Refiner 解决"任务结构对不对"，Code-Aware Re-plan 解决"规划在代码层面是否可行"
- 张力：Cagan 强调 Discovery 需要用户参与，但方案两层都是全自动的。考虑用户画像（"人类很懒"），全自动 + 异常时通知用户是合理的折中

#### CPM（Critical Path Method）

核心：在依赖图中找最长路径，关键路径上任何延迟直接延长总工期。

- Graph Refiner 的关键路径识别直接来自 CPM
- 拓扑排序 + 关键路径分析是 CPM 标准流程，方案完全对齐
- 并行机会发现 = CPM 中的非关键路径浮动时间分析
- 挑战：CPM 假设依赖确定，但方案中依赖是推断的——这正是设计第二层来修正的

#### HTN（Hierarchical Task Network）

核心：将高层任务递归分解为低层子任务，在正确的抽象层次上做规划。

- 两层对应两个抽象层次：Graph Refiner（集合级结构规划，高抽象）和 Code-Aware Re-plan（单任务执行规划，低抽象）
- HTN 要求"在正确的抽象层次上使用正确的信息量"——信息量递进设计完全对齐
- 注意：典型 HTN 有 3-4 层，两层作为起点足够，但架构要预留扩展；Graph Refiner 的领域知识依赖 LLM 推理能力，是否足够需实践验证

## 8. 优先级

```
优先级 1：第一层 — Graph Refiner（依赖推断、拓扑排序、完整性检查）
           ——10/21 任务被阻塞是真实痛点
           ——不依赖代码库是否存在
           ——代码基础：task-split-topology.ts 已有 topologicalSort()

优先级 2：第二层 — Code-Aware Re-plan（Todo→Dev 边界的二次规划）
           ——修改 agent-trigger.ts 的 guardrail
           ——复用 fetchMainCodebase 机制
           ——从 0-1 早期优雅降级为纯文本分析
```

## 9. 已排除的方案

| 方案 | 排除原因 |
|------|---------|
| 三个"桥"（任务引导、快速审查、可观测性） | 效率层面优化，不触及根因 |
| 执行控制权（Checkpoint、回滚、粒度校准） | 用户不想管执行细节 |
| 系统主动生成候选任务让用户选择 | 用户明确说理解错了 |

## 10. 实施方案

### 10.1 依赖存储策略

现有模型 `task.dependencies: string[]`（用户声明）+ `task.blocking: string[]`（反向引用）。`dependency-gate.ts` 只检查 `dependencies`。

**选择：直接写入 `dependencies` + 审计评论。不改模型、不改 gate。**

理由：
1. KISS——`task.ts` 313 行、`createTask()` 58 个参数，不值得为推断依赖加字段
2. Graph Refiner 写入 `dependencies`，同时通过 `TaskCommentEntry` 记录推断理由
3. 用户在 UI 看到依赖 + 评论，能覆盖。覆盖走 `updateDependencyRelations()`，一致性自动维护
4. 后续可迭代加 `inferredDependencies` 字段做精细控制——现在不阻塞

### 10.2 Graph Refiner 触发时机

**防抖 30s + 定期 5 分钟兜底。**

```
用户创建/更新 Backlog 任务
  → emit BACKLOG_CHANGED 事件
  → 30s 防抖定时器启动（复用 pr-merge-listener.ts 的 setTimeout 模式）
  → 30s 内无新 Backlog 事件 → 触发 Graph Refiner
  → 分析全部 Backlog 任务 → 写入依赖 + 评论

兜底：lane scanner 每 5 分钟扫描时检查 Backlog 图结构是否过期
```

适配"用户通过界面逐个创建任务"——连续创建 5 个任务只运行一次。

### 10.3 Layer 2 与 Layer 1 冲突处理

**原则：Code truth overrides text inference。Layer 2 有更多信息，它赢。**

```
Layer 1 推断：Task B 依赖 Task A → 写入 dependencies + 评论（置信度：中）

Layer 2（Todo→Dev 边界读代码）:
  场景 A：代码证实 → 评论升级"代码验证：依赖正确"
  场景 B：代码否定 → 移除依赖 + 评论"代码验证：移除推断，原因：..."
  场景 C：代码发现新依赖 → 添加依赖 + 评论
```

所有变更通过 `TaskCommentEntry` 审计，source 标记为 graph_refiner / code_aware_replan。

### 10.4 WIP Limit

**在 board 配置层加 `maxDevColumnWip`，默认 3。**

不改模型。在 workflow-orchestrator 的 Todo→Dev 过渡中加检查：

```typescript
const devTasks = allTasks.filter(t => t.columnId === "dev" && t.status !== "COMPLETED");
if (devTasks.length >= maxDevColumnWip) {
  task.lastSyncError = `[wip-limited] Dev column at capacity (${devTasks.length}/${maxDevColumnWip})`;
  return; // 保持在 Todo
}
```

Dev 列任务完成时，`pr-merge-listener.ts` 已有重触发机制，自然拉下一个 Todo 任务。

### 10.5 Commitment Point

**软门控——质量信号，不阻塞。**

任务进入 Backlog 时自动检查：
- 有标题和 scope → 通过
- 有 acceptance criteria → 通过
- 和现有任务重复 → 警告标签 `possible-duplicate`
- 粒度异常（objective 过短且无 scope）→ 警告标签 `needs-detail`

Graph Refiner 运行时利用这些标签决定优先处理哪些任务。

### 10.6 完整流程

```
用户创建任务 → Backlog
  │
  ├─ [软门控] 质量检查 → 通过或加警告标签
  │
  ├─ [个体 Refiner] 现有流程：文本润色、scope/AC/VC 细化
  │
  └─ [30s 防抖] → Graph Refiner
       ├─ 依赖推断 → 写入 dependencies + 评论
       ├─ 拓扑排序 → 建议执行顺序
       ├─ 关键路径 → 标记瓶颈任务
       ├─ 并行机会 → 标记可并行任务组
       ├─ 完整性检查 → 发现缺失子任务，加评论建议
       └─ 冲突检测 → 标记冲突的任务对

用户推进任务 → Todo → [准备进入 Dev]
  │
  ├─ [WIP 检查] Dev 列已满？→ 保持在 Todo
  │
  └─ [Code-Aware Re-plan]
       ├─ 读最新代码（复用 fetchMainCodebase）
       ├─ 验证 Layer 1 推断 → 确认或修正
       ├─ 校验 scope → 基于代码调整
       ├─ 精化 AC → 基于现有模式补充
       └─ 识别文件影响范围
            │
            └─ → Dev（创建 worktree + 执行）
```

### 10.7 代码改动清单

| 优先级 | 改动 | 文件 | 复杂度 | 说明 |
|--------|------|------|--------|------|
| P1 | Graph Refiner | 新文件 `graph-refiner.ts`，扩展 `task-split-topology.ts` | 中 | 依赖推断、拓扑排序、完整性检查、冲突检测 |
| P1 | 防抖触发 | Backlog 列过渡处理 | 低 | 复用 `setTimeout` 模式 |
| P2 | Code-Aware Re-plan | 新文件，Dev 列自动化步骤 | 中 | 代码校验、scope 调整、AC 精化 |
| P2 | guardrail 修改 | `agent-trigger.ts` | 低 | Todo→Dev 步骤允许 Read/Grep/Glob |
| P3 | WIP Limit | `workflow-orchestrator.ts` 的 Todo→Dev 过渡 | 低 | 检查 Dev 列任务数 |
| P3 | 软门控 | Backlog 列自动化步骤 | 低 | 质量标签检查 |

### 10.8 不需要改动的

| 文件 | 原因 |
|------|------|
| `task.ts` | 不改模型，推断依赖直接写入 `dependencies` |
| `dependency-gate.ts` | gate 逻辑不变，只检查 `dependencies` |
| `board-branch-rules.ts` | 分支规则不变 |
| `pr-merge-listener.ts` | PR 合并处理不变 |
| `ensure-task-worktree.ts` | Worktree 创建逻辑不变 |
| `task-trigger-session.ts` | 会话管理不变 |
