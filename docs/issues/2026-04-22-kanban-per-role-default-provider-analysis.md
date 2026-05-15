---
title: "全方面分析 Routa 内置角色默认 Provider 设置是否生效"
date: "2026-04-22"
kind: analysis
status: resolved
severity: high
area: kanban, acp, specialist
tags: [provider, kanban, specialist, role, defaultProvider, autoProvider]
reported_by: "routa-kanban (Dev + Review)"
related_issues: []
github_issue: null
github_state: null
github_url: null
kanban_card_id: "2ad6596b-f12f-45f6-acf5-2d3a15d77301"
---

# Routa 内置角色默认 Provider 设置是否生效 — 全方面分析报告

## What Happened

Routa Kanban 系统为每个内置角色（ROUTA、CRAFTER、GATE、DEVELOPER）设计了默认 Provider 分配机制。当前工作空间的预期配置为：ROUTA 和 CRAFTER 使用 Claude Code SDK，GATE 和 DEVELOPER 使用 openCode。但工作空间元数据中仅存在单一的 `kanbanAutoProvider=claude-code-sdk`，未见按角色区分的 provider 映射。

## Expected Behavior

- ROUTA 角色应使用 `claude-code-sdk`
- CRAFTER 角色应使用 `claude-code-sdk`
- GATE 角色应使用 `opencode`
- DEVELOPER 角色应使用 `opencode`

## 实际行为

所有角色统一使用 `claude-code-sdk`（board 级 auto provider），不存在 per-role 差异化。

| 角色 | 预期 Provider | 实际 Provider | 状态 |
|------|-------------|-------------|------|
| ROUTA | claude-code-sdk | N/A (Kanban 中不直接使用) | N/A |
| CRAFTER | claude-code-sdk | claude-code-sdk | ⚠️ 正确但原因不对 |
| GATE | opencode | claude-code-sdk | ❌ 不符合预期 |
| DEVELOPER | opencode | claude-code-sdk | ❌ 不符合预期 |

## Why This Might Happen

### Provider 解析链路完整追踪

#### 1. Provider 解析入口：`workflow-orchestrator-singleton.ts:206-256`

```
startKanbanTaskSession() {
  autoProviderId = getKanbanAutoProvider(workspace.metadata, boardId)  // 单一 board 级 provider
  effectiveAutomation = resolveEffectiveTaskAutomation(task, columns, specialist, { autoProviderId })
  sessionStep = resolveKanbanAutomationStep(step, specialist, { autoProviderId })
  sessionProviderId = providerOverride ?? sessionStep?.providerId ?? effectiveAutomation.providerId
  taskForSession.assignedProvider = sessionProviderId
}
```

#### 2. Provider 三层 Fallback：`effective-task-automation.ts:109-119`

```typescript
configuredProviderId = step.providerId                    // ① Lane step 级别
autoProviderId = options.autoProviderId                   // ② Board auto provider (来自 workspace metadata)
specialistDefaultProviderId = specialist?.defaultProvider  // ③ Specialist 内置默认 (当前未使用)
providerId = configuredProviderId ?? autoProviderId ?? specialistDefaultProviderId
```

providerSource 标记：
- `lane` = 来自 step.providerId（列自动化配置中的步骤级覆盖）
- `auto` = 来自 kanbanAutoProvider:{boardId}（board 级别统一设置）
- `specialist` = 来自 specialist 的 defaultProvider 字段
- `none` = 以上均无

#### 3. 最终 Fallback：`agent-trigger.ts:443-449`

```typescript
function resolveKanbanAutomationProvider(provider?: string): string {
  if (provider === "claude" && isClaudeCodeSdkConfigured()) return "claude-code-sdk";
  return provider ?? "opencode";  // 无任何 provider 时默认 opencode
}
```

### 三层根因

1. **`board-auto-provider.ts` 仅支持 `kanbanAutoProvider:{boardId}` 单一值**
   - 无 per-role 粒度，对所有角色的所有自动化步骤统一生效

2. **Specialist YAML 中 `default_adapter` ≠ Kanban 读取的 `defaultProvider`，字段断裂**
   - 四个核心 YAML（routa.yaml, crafter.yaml, gate.yaml, developer.yaml）均配置了 `default_adapter: "claude-code-sdk"`
   - `specialist-file-loader.ts:439-440` 将 `default_adapter` → `defaultAdapter`，`default_provider` → `defaultProvider`
   - 但 Kanban 管线只读取 `specialist.defaultProvider`（`workflow-orchestrator-singleton.ts:67`）
   - `defaultAdapter` 在整个 `src/core/kanban/` 目录中零引用

3. **Settings UI 的 per-role 配置仅存 localStorage，未桥接后端**
   - `settings-panel-shared.ts` 将 per-role provider 写入 `localStorage["routa.defaultProviders"]`
   - Kanban 自动化引擎从不读取 localStorage
   - 不存在任何 API 将前端设置桥接到后端

### Specialist defaultProvider 字段状态

| Specialist ID | Role | defaultProvider 设置 |
|--------------|------|---------------------|
| routa (hardcoded) | ROUTA | ❌ 未设置 |
| crafter (hardcoded) | CRAFTER | ❌ 未设置 |
| gate (hardcoded) | GATE | ❌ 未设置 |
| developer (hardcoded) | DEVELOPER | ❌ 未设置 |
| kanban-backlog-refiner | CRAFTER | ❌ YAML 中未定义 |
| kanban-todo-orchestrator | CRAFTER | ❌ YAML 中未定义 |
| kanban-dev-executor | CRAFTER | ❌ YAML 中未定义 |
| kanban-qa-frontend | GATE | ❌ YAML 中未定义 |
| kanban-review-guard | GATE | ❌ YAML 中未定义 |
| kanban-workflow | DEVELOPER | ❌ YAML 中未定义 |

`defaultProvider` 字段在 `specialist-types.ts:14` 中存在定义，但从未被任何 specialist 实际设置，属于死代码路径。

## AC 验证结果

| AC | 描述 | 结论 |
|----|------|------|
| AC1 | 角色-Provider 映射配置入口分析 | ❌ 不存在 per-role provider 配置机制 |
| AC2 | ROUTA 角色 provider 验证 | N/A — Kanban 自动化中不直接使用 |
| AC3 | CRAFTER 角色 provider 验证 | ⚠️ 实际使用 claude-code-sdk（正确），但因 board 级设置恰好一致 |
| AC4 | GATE 角色 provider 验证 | ❌ 实际使用 claude-code-sdk，预期 opencode |
| AC5 | DEVELOPER 角色 provider 验证 | ❌ 实际使用 claude-code-sdk，预期 opencode |
| AC6 | 完整分析报告 | ✅ 本报告 |

## Relevant Files

- `src/core/kanban/board-auto-provider.ts` — Board 级 auto provider 存取 (1-33)
- `src/core/kanban/effective-task-automation.ts` — Provider 三层 fallback 解析 (99-130)
- `src/core/kanban/workflow-orchestrator-singleton.ts` — Session 启动时的 provider 解析 (206-256)
- `src/core/kanban/agent-trigger.ts` — 最终 provider 解析与 ACP session 创建 (443-449, 509-610)
- `src/core/specialists/specialist-types.ts` — SpecialistConfig 中 defaultProvider 字段定义 (14)
- `src/core/specialists/specialist-file-loader.ts` — defaultAdapter/defaultProvider 独立映射 (439-440)
- `src/core/orchestration/specialist-prompts.ts` — Hardcoded specialist 无 defaultProvider (288-329)
- `src/core/acp/session-prompt.ts` — 最终兜底 defaultProvider (288-289)
- `resources/specialists/core/routa.yaml` — ROUTA specialist 配置
- `resources/specialists/core/crafter.yaml` — CRAFTER specialist 配置
- `resources/specialists/core/gate.yaml` — GATE specialist 配置
- `resources/specialists/core/developer.yaml` — DEVELOPER specialist 配置
- `resources/specialists/locales/en/workflows/kanban/*.yaml` — Kanban specialist 配置

## 推荐修复方案

### 方案 A：在 Specialist YAML 中设置 defaultProvider（最小改动）

在 YAML 文件中添加 `default_provider` 字段：
- GATE specialist: `default_provider: "opencode"`
- DEVELOPER specialist: `default_provider: "opencode"`

**前提**：需要将 board auto provider 设置为空，否则 specialist defaultProvider 永远不会被使用（因为 autoProviderId 优先级更高）。

### 方案 B：在列自动化 step 中设置 providerId（推荐）

通过 Settings UI 或 API，在每个列的自动化步骤中显式设置 `providerId`。providerSource="lane" 优先级最高，不需要修改代码。

### 方案 C：新增 per-role provider 映射到 workspace metadata

在 workspace metadata 中引入如 `kanbanAutoProvider:{boardId}:{role}` 的格式，实现按角色区分的 provider 配置。需要修改 board-auto-provider.ts、effective-task-automation.ts 和 Settings UI。

## Verification

- 7 处关键代码路径独立读取验证
- Dev + Review 两轮独立代码追踪交叉确认
- QA Frontend 逐文件验证所有声明
- 10 个 artifacts（8 test_results + 2 screenshots），verdict APPROVED

## References

- Kanban Card: `2ad6596b-f12f-45f6-acf5-2d3a15d77301`
- Branch: `issue/routa-routa-provider-2ad6596b`
