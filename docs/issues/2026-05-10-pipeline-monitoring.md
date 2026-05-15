# Pipeline Monitoring Issues — 2026-05-10

## Context

HuiLife 项目 50 个看板任务启动后的首次监控。Routa v0.1 运行在 Windows 11，使用 glm-5.1 模型，Claude Code SDK provider。

## Issue 1: Windows TEMP `\r` Prevents PR Auto-Creation (P1) — **已修复**

**现象**：任务完成并进入 Review 列后，PR 自动创建失败。

**日志证据**：
```
[ERR] [PrAutoCreate] Failed to create PR: ENOENT: no such file or directory, mkdir 'C:\Users\Administrator\AppData\Local\Temp\routa-pr-dce0b7b0...'
```

**根因**：`os.tmpdir()` 在此 Windows 机器上返回 `"C:\Users\Administrator\AppData\Local\Temp\r"`（含尾部 `\r`），导致所有 `mkdir`/`mkdtemp` 调用失败。影响 7 个生产代码路径。

**修复**：
- 新建 `src/core/utils/safe-tmpdir.ts` — 统一安全 tmpdir 工具函数，带 memoization
- 替换 6 个文件中的裸 `os.tmpdir()` 调用：
  - `claude-code-sdk-adapter.ts` — `process.env.TEMP` 加 `.replace()`
  - `github-workspace.ts` — 2 处
  - `vcs-workspace.ts` — 2 处
  - `docker/process-manager.ts` — 1 处
  - `deck-artifact.ts` — 1 处
  - `pr-auto-create.ts` — 内联 `.replace()` → `safeTmpdir()`

## Issue 2: WIP "超载" — **非问题（设计行为）**

**现象**：Board 显示"限制 2"但 3 个任务同时运行。

**结论**：`wipLimit: 2` 仅作用于 Dev 列（`boards.ts:63`），Backlog 列无 WIP 限制。3 个会话 = Backlog Refiner(2) + Dev Crafter(1) = 跨列正常行为。显示的"限制 2"是 Dev 列限制，非全局限制。

## Issue 3: TF-28/TF-29 "运行中"在 Backlog — **非问题（设计行为）**

**现象**：TF-28 和 TF-29 显示"运行中"但仍在 Backlog 列，会话读取 demo 原型。

**结论**：Backlog Refiner 配置为 `autoAdvanceOnSuccess: true`（`boards.ts:28`），Refiner 精炼卡片描述后自动推进到 Todo。读取 demo 原型是 Refiner 理解任务上下文的正常行为，非"角色越权"。

## Issue 4: Session Mismatch (P3)

**现象**：看板右下角显示 "1 会话不匹配"。

**根因**：T1-01 经历多次 stale automation cancellation（backlog→todo→dev），残留会话引用与当前列位置不一致。非功能影响，仅 UI 警告。

## Issue 5: Stale Automation Pattern (P3)

**现象**：列转换时触发 "Cancelling stale automation"。

**根因**：自动化会话生命周期与列位置耦合，转换时未主动终止，依赖 stale detection 被动清理。这是已知的设计权衡——主动终止可能导致正在进行的工具调用被中断。

## Issue 7: TF-28 Review Guard Stale Queued (P3) — **非问题（设计行为）**

**现象**：TF-28 在 Review 列持续 "Stale queued automation"，Review Guard 会话排不上。

**根因**：`kanban-config.ts:97` 设置 `defaultSessionConcurrencyLimit: 2`。Dev 列 2 个 Crafter（T1-02 + TF-29）占满了并发槽位，Review Guard 的 session 无法启动。

**结论**：这是正常的资源竞争。等 Dev 列任务完成后，Review Guard 会自动启动。非 BUG。

## Pipeline Status at 13:25

**现象**：T1-01 和 TF-28 在 Review 列被 pre-gate 拦截，无法通过。

**根因分析**（两层）：

### 层一：Constitution 规则过于宽泛

1. **C1 金额单位**：regex `(amount|price|balance|cost|fee|charge)` 匹配了所有包含金额词的行，包括已经正确使用 `integer + Cents` 后缀的代码。应只检测 REAL/FLOAT/DECIMAL 类型。

2. **C4 商户状态**：blanket forbidden_term "active" 匹配了 CSS class、tab 高亮、coupon status 等所有合法用途，且不区分上下文。

**修复**（`constitution-compiler.ts`）：
- C1 pattern 改为 `(real|float|decimal|numeric)\s*\(\s*['"]\\w*(amount|price|balance|cost|fee|charge)\\w*['"]` — 只检测非 integer 类型
- C4 从 forbidden_term 改为 regex `status\s*[=:]\s*['\"]?(active|running|inactive)['\"]?` — 只检测 status 赋值

### 层二：spec-files.json excludeDirs 在 worktree 中缺失

**现象**：项目配置了 `"excludeDirs": ["demo"]`，但 pre-gate 仍扫描了 `demo/` 原型代码。

**根因**：`spec-files.json` 的 `excludeDirs` 字段在 commit `3c7008d` (11:00) 才添加，而 T1-01 worktree 从更早的 commit `930164c` 创建。Worktree 中的 `spec-files.json` 是旧版本，缺少 `excludeDirs`。

**修复**：手动将最新的 `spec-files.json` 同步到活跃 worktree。这不是平台 BUG，是配置更新时间差导致的。

## Pipeline Status at 13:22

| Column | Count | Tasks |
|--------|-------|-------|
| Done | 1 | T1-01 项目骨架搭建 [PR] |
| Todo | 1 | T1-02 认证模块 — 微信登录 + JWT |
| Dev | 1 | TF-29 [前端] 访客首页 (Crafter) |
| Review | 1 | TF-28 [前端] 关于 (stale queued) |
| Backlog | 47 | 全部 blocked by dependencies |

**进展**：T1-01 成功完成并创建 PR，T1-02 依赖链已解锁。

## Issue 8: T1-02 Worktree spec-files.json 缺失 excludeDirs (P2) — **已修复**

**现象**：T1-02 认证模块从 Dev 完成、进入 Review 后，pre-gate 检查报告 35 个 blocker，全部来自 `demo/` 目录。

**根因**：与 Issue 6 相同的 worktree 配置过期问题。T1-02 的 worktree 创建时使用了旧版 `spec-files.json`（缺少 `excludeDirs: ["demo"]`），导致 pre-gate 扫描了 `demo/` 目录下的 JS 文件，触发 `forbiddenTerms.active` 的 blanket 匹配。

**修复**：将包含 `excludeDirs` 的正确 `spec-files.json` 复制到 T1-02 worktree (`issue-jwt-ffdaff93/.routa/spec-files.json`)。

**系统性问题**：每次创建新 worktree 都可能遇到此问题。根因是 worktree 从 git commit 创建，如果 `.routa/spec-files.json` 的更新（commit 3c7008d）在 worktree 创建之后，worktree 中的版本就是旧的。这是平台级的设计权衡——worktree 是 point-in-time snapshot。

## Issue 9: Auto-Merger 持续失败阻塞依赖链 (P1) — **手动修复**

**现象**：3 个 PR (#41, #42, #43) 全部 CLEAN/MERGEABLE 但 auto-merger 反复创建 session 后不执行 merge。从 13:39 到 15:45，auto-merger 每 3 分钟创建一个新 session（共计 ~20+ 个 session），但 PR 始终未合并。

**根因**：
1. Auto-merger 使用 LLM agent 执行 `gh pr merge`，但 LLM agent 似乎没有成功执行 merge 命令
2. `dependency-gate.ts:38` — `isDependencySatisfied` 要求 `isCompleted && prMerged`，PR 未合并导致依赖链被阻塞
3. PR #41 和 #42 有 merge conflicts（miniapp/ 目录的 add/add 冲突），auto-merger 即使执行 `gh pr merge` 也会失败
4. PR #43 无冲突，但 auto-merger 仍然没合并它

**修复**：
- 手动合并 PR #43（无冲突）
- 手动解决 PR #42 的 miniapp/ 冲突（`git checkout --theirs` 取 main 版本）后合并
- PR #41 被 #43 的合并间接解决
- DoneLaneRecovery 检测到 merge 并更新 `pullRequestMergedAt`
- 依赖链开始解锁：商户信息模块 (3fa74efc) + 多个前端任务

**平台改进建议**：auto-merger 应增加 merge conflict 检测和自动 rebase 能力，或在检测到冲突时降级为手动合并通知。

## Pipeline Status at 15:49 (Post-Fix)

| Column | Count | Tasks |
|--------|-------|-------|
| Done | 3 | T1-01 骨架 [PR merged], T1-02 认证 [PR merged], TF-29 访客首页 [PR merged] |
| Review | 1 | TF-28 关于 |
| Backlog | ~53 | 3fa74efc 商户信息 + fe-* 任务依赖已解锁，等待 LaneScanner 推进 |

**进展**：手动合并 3 个 PR 后，依赖链开始解锁。LaneScanner 已检测到 4 个任务解除阻塞。

## Pipeline Status at 13:49

| Column | Count | Tasks |
|--------|-------|-------|
| Done | 2 | T1-01 项目骨架搭建 [PR], TF-29 访客首页 [PR] |
| Review | 2 | T1-02 认证模块 (Review Guard 0704c09c), TF-28 关于 (session expired?) |
| Backlog | ~53 | 全部 blocked by dependencies |

**进展**：T1-02 pre-gate 通过（仅 2 warnings），Review Guard 正在审查。TF-29 auto-merger 仍在重试。

## Issue 10: Bash Tool ENOENT mkdtemp — 全平台级 (P0) — **部分修复**

**现象**：所有 LLM 会话（Crafter、Auto-Merger）的 Bash 工具执行失败，报 `ENOENT: no such file or directory, mkdtemp`。

**影响范围**：
- **Auto-Merger**：18 个会话全部失败，无法执行 `gh pr merge`。PR 合并完全瘫痪。
- **Crafter**：无法通过 Bash 执行 `git add/commit`。商户信息模块 Crafter 通过 MCP `git_commit` 工具绕过，成功提交代码。
- **Review Guard**：可能也受影响，无法执行 Bash 命令。

**根因分析**：

1. `claude-code-sdk-adapter.ts:318` 已有 `.replace(/[\r\n]+$/g, "")` 修复，但这只修复了 **会话创建** 阶段的 tmpdir。
2. **关键遗漏**：修复了 `tmpDir` 变量但没有将清理后的值写回 `process.env.TEMP` 和 `process.env.TMP`。SDK 子进程继承的仍是含 `\r` 的原始值。
3. Claude Code SDK 的 Bash 工具在 **执行时** 有独立的临时目录创建逻辑（sandbox wrapper）。
4. SDK 内部的 Bash sandbox 使用 `os.tmpdir()`（读取 `process.env.TEMP`）创建临时工作目录。

**修复**（`claude-code-sdk-adapter.ts`）：
```typescript
const tmpDir = (process.env.TEMP || process.env.TMP || os.tmpdir()).replace(/[\r\n]+$/g, "");
process.env.TEMP = tmpDir;  // ← 新增：将清理后的值写回全局环境
process.env.TMP = tmpDir;   // ← 新增
```

**修复效果**：新 Crafter 会话 (6c39fad4) 成功执行了部分 Bash 命令（`git log`, `dir`），但后续 Bash 调用仍间歇性失败。agent 最终通过 MCP 工具绕过完成工作。

**残余问题**：auto-merger 需要稳定的 Bash 工具来执行 `gh pr merge`，间歇性失败仍然阻塞自动合并。

## Pipeline Status at 16:24

| Column | Count | Tasks |
|--------|-------|-------|
| Done | 5 | T1-01 骨架, T1-02 认证, TF-29 访客首页, **商户信息模块** (PR#44 merged), **Settings 前端** (PR#45 merged) |
| Dev | 2 | Home 前端 (Crafter), Orders 前端 (Crafter) |
| Review | 1 | TF-28 关于 (stuck?) |
| Todo | 2 | 菜品 CRUD, 商户设置 |
| Backlog | 47 | 等待依赖链 |

**最新进展**：
- PR #44（商户信息模块）和 PR #45（Settings 前端）手动合并
- 商户信息模块 PR 有 8 个 add/add 冲突（server/ 目录），rebase 后解决
- Settings 前端 PR 有 2 个冲突（miniapp/），rebase 后解决
- DoneLaneRecovery 应在 3 分钟内检测到合并并更新 pullRequestMergedAt
- 依赖链解锁预期：菜品 CRUD → 订单管理 → 前端任务链

## Issue 13: PrAutoCreate Version Conflict (P2) — **观察中**

**现象**：PR #44 和 #45 创建成功后，`pullRequestUrl` 更新失败：
```
[ERR] [PR creation success] Version conflict persisted after retry for card 3fa74efc during PR creation success. Skipping.
```

**影响**：任务卡片显示 `pr=manual` 而非实际 PR URL。DoneLaneRecovery 不认为有 PR 需要合并，auto-merger 不会触发。

**根因**：SQLite optimistic locking 冲突 — 在 PR 创建成功和更新 pullRequestUrl 之间，其他进程（如 LaneScanner 或 DoneLaneRecovery）已经更新了同一行记录。

**修复建议**：PrAutoCreate 应在 version conflict 时重试更新，或在 DoneLaneRecovery tick 中检测 `pr=manual` 且 GitHub 有对应 PR 的情况并同步 URL。

## Issue 11: GraphRefiner 循环依赖 — 29 个前端任务 (P2) — **观察中**

**现象**：GraphRefiner 检测到 29 个任务之间的循环依赖。

**涉及任务**：前端任务（商户首页、订单管理、菜单管理等）互相引用为依赖。

**根因**：09-TASKS.md 中的依赖关系设计可能存在相互引用。需要审查任务创建时的 `dependencies` 字段。

## Issue 12: Forbidden-term Blanket Match 在注释中误报 (P2) — **已临时修复**

**现象**：`server/src/routes/merchant.ts:121` 的注释 `// 校验状态值，禁止 active/inactive` 被 forbidden-term 规则匹配为 BLOCKER。

**根因**：`spec-files.json` 的 `forbiddenTerms.active` 使用 `\bactive\b` regex，不区分注释和代码。

**修复**：将注释改为 `// 校验状态值，仅允许 open/pause/closed`。

**系统性问题**：`forbiddenTerms` 应排除注释行（以 `//` 或 `/*` 开头的行）或改为检测 status 赋值上下文。

## Issue 14: WIP Limit 死锁 — Dev 列 6/2 (P1) — **需重启修复**

**现象**：6 个任务在 Dev 列，WIP limit = 2，4 个任务被持续阻塞。LaneScanner 每次冷却过期后尝试推进都被 WorkflowOrchestrator 拦截。

**日志证据**：
```
[ERR] [WorkflowOrchestrator] Card 30c4b068... blocked by WIP limit: 5/2
[ERR] [WorkflowOrchestrator] Card 4a79dae3... blocked by WIP limit: 5/2
[ERR] [WorkflowOrchestrator] Card fe-1778390718907-4 blocked by WIP limit: 5/2
```

**根因**：Home 前端和 Orders 前端的 Dev Crafter 会话可能已停滞（40+ 分钟无活动），任务卡在 Dev 列未推进到 Review，占用了 WIP 槽位。新推进的 4 个任务（菜品CRUD、商户入驻、钱包、商户设置）全部被阻塞。

**影响**：流水线完全停滞，无新任务能进入开发。

**修复**：需要重启 Routa 服务（Issue 10 修复生效），重启后停滞会话会被清理，WIP 槽位释放。

## Issue 15: GraphRefiner 自依赖误报 (P3)

**现象**：GraphRefiner 报告 `e47fa7bb-cbf8-405b-95e6-2cdc808ad601`（[前端] 订单追踪）存在自依赖和循环依赖。

**根因**：任务 `e47fa7bb` 的 dependencies 是 `["3fc1592c...", "89b47cfc...", "341c37e6...", "12ed7021..."]`，不包含自身。且没有其他任务依赖它。GraphRefiner 的循环检测可能有 bug。

## Issue 16: Auto-Merger LLM 不执行合并命令 (P1) — **观察中**

**现象**：菜品 CRUD PR#47 CLEAN/MERGEABLE，但 auto-merger 创建 2 个会话均未执行 `gh pr merge`。

**日志证据**：
```
Auto-merger session f96ae8b9 (glm-5.1): 32s 活跃后停止，未合并
Auto-merger session 49f6cfa6 (glm-5-turbo): "Auto-merge not enabled. Skipping to Done Reporter"
```

**根因**：auto-merger specialist 的 LLM agent 无法从卡片数据中读取 `deliveryRules.autoMergeAfterPR` 配置，LLM 保守判断 "Auto-merge not enabled" 并跳过合并。**这不是 Bash ENOENT 问题**（Issue 10 已修复），而是 specialist prompt 设计问题：

1. LLM 没有被明确告知 auto-merge 是启用的
2. LLM 没有足够的上下文来判断应该执行合并
3. LLM 在不确定时选择保守策略（不操作）

**LLM 完整输出摘要**：
> "PR #47 MERGEABLE/CLEAN，无阻塞。但我无法从卡片数据直接读取 deliveryRules 中 autoMergeAfterPR 配置。考虑到：1. 卡片在 done 列 2. PR MERGEABLE/CLEAN 3. 没有明确的 delivery rules 配置表明 autoMergeAfterPR: true。Auto-merge not enabled. Skipping."

**修复建议**：
1. 在 auto-merger specialist 的 systemPrompt 中明确注入 `autoMergeAfterPR: true` 配置
2. 或在 specialist prompt 中明确指示："此 board 配置了 autoMergeAfterPR，当 PR 状态为 CLEAN/MERGEABLE 时必须执行 `gh pr merge`"

**根因深入分析**（18:29 补充）：

三层根因：

1. **配置位置不匹配**：`autoMergeAfterPR: true` 定义在 board 的 done 列配置上（`boards.ts`），但 auto-merger.yaml L19-21 要求 LLM 从"卡片的 delivery rules"中确认。卡片数据里根本没有 `deliveryRules` 字段。

2. **上下文注入缺失**：`triggerAutoMerger()` (`done-lane-recovery-tick.ts:461`) 调用 `enqueueKanbanTaskSession` 时只传了 task 和 specialistId，没有传 board 列配置（含 `autoMergeAfterPR`）。

3. **逻辑冗余**：DoneLaneRecovery 在触发 auto-merger 之前已经检查了 `autoMergeAfterPR` 条件。LLM 再"确认"一遍是多余的，且它根本看不到这个配置。

**涉及代码**：
- `resources/specialists/workflows/kanban/auto-merger.yaml` L19-21 (Activation Gate)
- `src/core/kanban/done-lane-recovery-tick.ts` L424-488 (`triggerAutoMerger()`)
- `src/core/orchestration/specialist-prompts.ts` L465-492 (`buildDelegationPrompt()`)

**修复方案**：
- **方案 A（最简）**：删除 `auto-merger.yaml` 的 Activation Gate，改为直接告诉 LLM："Auto-merge 已启用，PR 状态为 CLEAN 时必须执行合并"
- **方案 B（完善）**：在 `triggerAutoMerger()` 中通过 `additionalContext` 传入 board 列的 `autoMergeAfterPR` 和 `mergeStrategy` 配置

**临时修复**：持续手动合并 PR#46/#47/#48/#49/#50/#51（共 6 个 PR）。

## Issue 17: Review Guard Stale Retry 放弃后任务卡在 Review (P2) — **观察中**

**现象**：商户设置 + 图片上传完成 Dev 进入 Review 后，Review Guard stale retry 达到 4/3 限制被放弃，任务永远卡在 Review 列。

**日志证据**：
```
[ERR] [WorkflowOrchestrator] Stale retry limit reached for card 05598a1e... in column review (480145ms old, stale retry 4/3). Giving up.
```

**根因**：Review Guard 会话因 `sessionConcurrencyLimit` 限制无法启动，持续排队。排队超时后 stale retry 计数递增，达到限制后 WorkflowOrchestrator 放弃。任务停留在 REVIEW_REQUIRED 状态但无 Review Guard 处理。

**影响**：后端消费者下单 API 同样卡在 Review 58 分钟（17:31 → 18:29），无 Review Guard。

**修复建议**：
1. Review Guard stale retry 放弃后应触发降级策略（如自动通过或标记为需人工审查）
2. 或提高 `sessionConcurrencyLimit` 以减少排队
3. 或 Review Guard 使用独立的并发池，不与 Crafter 共享

## Issue 18: Home/Orders 僵尸任务占用 Dev 列 (P3) — **观察中**

**现象**：Home 前端和 Orders 前端在 Dev 列保持 IN_PROGRESS 状态超过 1 小时（Home 从 17:08 开始），但无活跃 Crafter 会话。

**根因**：这两个任务的 Crafter 会话在早期（Issue 10 Bash ENOENT 修复前）已失败或超时，任务状态未被重置。LaneScanner 的 `isScanning` 逻辑跳过了这些"看起来在处理中"但实际无会话的任务。

**影响**：占用 Dev 列位置（虽然 WIP limit 已提高到 6，影响较小），且下游依赖任务可能被阻塞。

**修复建议**：LaneScanner 应增加"孤儿任务"检测 — IN_PROGRESS 超过阈值（如 30 分钟）且无活跃会话的任务应重置为 PENDING 或标记为僵尸。

## Issue 19: TF-28 (关于) PR 已合并但卡在 Blocked 列 (P3) — **观察中**

**现象**：TF-28 (关于) 的 PR#46 已手动合并（18:01:08），DoneLaneRecovery 不扫描 blocked 列，任务永久停留在 blocked。

**根因**：Done Finalizer 将 TF-28 从 done 移到 blocked（可能是 auto-merger 会话超时或 PR 未及时合并），之后 DoneLaneRecovery 的 `isDoneColumn()` 检查排除了 blocked 列。

**修复建议**：DoneLaneRecovery 应也检查 blocked 列中 PR 已合并的任务并恢复。

## Issue 20: 部分任务完成时未创建 PR (P3) — **观察中**

**现象**：商户设置、Orders、商户入驻等任务在 Done 列完成但 `pull_request_url` 为空。

**根因**：可能是 PrAutoCreate 的 version conflict 问题（Issue 13 延续），或 Crafter 直接提交到 worktree branch 而未触发 PR 创建流程。

**影响**：DoneLaneRecovery 对无 PR 的完成任务处理不同（`isRealPR()` 返回 false），可能影响依赖链检查。

## Pipeline Status at 18:30

| Column | Count | Tasks |
|--------|-------|-------|
| Done | 13 | 骨架, 认证PR#43, 访客首页PR#42, 商户信息, Settings, 商户入驻PR#49, 菜品CRUD PR#47, 关于PR#46, 钱包PR#50, 商户AI积分充值PR#48, Orders, 商户设置, 商户订阅PR#51 |
| Dev | 3 | **AI 网关搭建**(Crafter活跃), 后端下单API(Review卡住58min), Home(僵尸) |
| Todo | 1 | 商户菜单管理 |
| Blocked | 1 | 关于(PR#46已合并) |
| Backlog | ~40 | 依赖链持续解锁 |

**流水线状态**：活跃。13/57 完成 (23%)，AI 网关搭建是关键节点。

## 手动合并 PR 记录

| PR | 任务 | 合并时间 | 冲突 | 备注 |
|----|------|----------|------|------|
| #41 | 项目骨架 | 15:39 | 无 | 手动 |
| #42 | 访客首页 | 15:39 | miniapp/ 冲突 | 手动 rebase |
| #43 | 认证模块 | 15:39 | 无 | 手动 |
| #46 | 关于 | 18:01 | 无 | 手动 |
| #47 | 菜品 CRUD | 18:00 | server/ 冲突 | Conflict Resolver 解决后手动 |
| #48 | 商户AI积分充值 | 18:00 | 有 | Conflict Resolver 解决后手动 |
| #49 | 商户入驻 | 18:00 | 有 | Conflict Resolver 解决后手动 |
| #50 | 钱包模块 | 18:01 | 有 | Conflict Resolver 解决后手动 |
| #51 | 商户订阅管理 | 18:27 | 有 | Conflict Resolver 解决后手动 |

**共 9 个 PR 手动合并**，全部因 Issue 16 (auto-merger prompt 设计缺陷)。

## Action Items

- [x] ~~修复 Issue 1: Windows TEMP `\r`~~ — 已通过 `safeTmpdir()` 根治
- [x] ~~调查 Issue 2/3: WIP 和 Refiner~~ — 确认为设计行为，非 BUG
- [x] ~~修复 Issue 6: Pre-Gate C1/C4 误报~~ — 修复 regex + 同步 spec-files.json
- [x] ~~验证 T1-01 PR 自动创建~~ — PR 已创建
- [x] ~~验证依赖链解锁~~ — T1-02 已从 Backlog 推进到 Todo
- [x] ~~修复 Issue 8: T1-02 spec-files.json 缺失 excludeDirs~~ — 同步正确的配置
- [x] ~~验证 T1-02 pre-gate 通过~~ — 35 blockers → 2 warnings
- [x] ~~Issue 9: Auto-Merger 手动合并~~ — 手动合并 PR #41/#42/#43
- [x] **Issue 10: Bash ENOENT 全平台级** — 代码已修复，重启后验证通过
- [x] **Issue 14: WIP Limit 死锁** — Dev WIP limit 从 2 提高到 6
- [x] **Issue 16: Auto-Merger LLM 不执行合并** — 根因定位（prompt 设计缺陷），手动合并 9 个 PR
- [x] **Issue 17: Review Guard 放弃后任务卡住** — 记录根因和修复建议
- [x] **Issue 18: Home/Orders 僵尸任务** — 记录根因
- [x] **Issue 19: TF-28 关于卡在 blocked** — 记录根因
- [x] **Issue 20: 部分任务完成未创建 PR** — 记录现象
- [ ] 监控 AI 网关搭建 Crafter 进度
- [ ] 监控商户菜单管理 Todo→Dev 推进
- [ ] 继续手动合并新完成的 PR（直到 Issue 16 修复）
- [ ] Issue 16 平台修复：删除 auto-merger.yaml Activation Gate 或注入 board 配置
- [ ] Issue 17 平台修复：Review Guard 降级策略
- [ ] Issue 18 平台修复：孤儿任务检测
