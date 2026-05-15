# Routa.js — Multi-agent coordination platform with dual-backend architecture (Next.js + Rust/Axum).

Routa.js is a workspace-first multi-agent coordination platform with two runtime surfaces:

- Web: Next.js app and API in `src/`
- Desktop: Tauri app in `apps/desktop/` backed by Axum in `crates/routa-server/`

The project is intentionally not "two separate products". Web and desktop differ in deployment model and storage, but they are expected to preserve the same domain semantics, API shape, and agent-coordination behavior.

- `docs/ARCHITECTURE.md`: Canonical architecture boundaries, domain model, protocol stack, and cross-backend invariants.
- `docs/adr/`: Durable architectural decisions. Start here for "why".
- `docs/design-docs/`: Human-reviewed design intent and normalized decisions migrated from `.kiro/specs/`.

## Coding Standards

- General coding style guidance lives in `docs/coding-style.md`; keep this file focused on routing and repo-level guardrails.
- Source of truth for executable gates is `docs/fitness/` + `entrix`; do not restate tool-level checks here.
- Frontend and desktop API calls in `src/app` and `src/client` should use `resolveApiPath` + `desktopAwareFetch` for统一的后端路径组装：
  - `resolveApiPath`（`src/client/config/backend.ts`）：统一补全 `/api` 前缀并在需要时拼接后端 base URL。
  - `desktopAwareFetch`（`src/client/utils/diagnostics.ts`）：在 Tauri 桌面静态运行时自动落到 `http://127.0.0.1:3210` 或配置的后端地址。
  - 避免在前端/桌面再次直接写 `fetch('/api/...')`。
- For long behavior-heavy files, prefer **orchestration shell + domain hooks** over UI-only slicing.
- Apply the same pattern to oversized API routes: thin top-level route, extract workflow branches (session creation, streaming, provider dispatch, etc.).
- Split route refactors by workflow branch before shared helpers; avoid premature generic `utils`.
- Before large behavior refactors, add or extend characterization tests that lock routing/lifecycle/persistence/recovery behavior.
- All UI-facing strings must go through the i18n system (e.g., `t('key')`). Do not hardcode English or Chinese literals in components.

## Testing and Debugging

- Use `agent-browser` (or Electron/browser skills) for manual walkthroughs and visual evidence capture.
- Use Playwright e2e for automated UI coverage.
- Tauri UI smoke path: `npm run tauri dev`, then validate via `http://127.0.0.1:3210/`.
- If Tauri routes look wrong, verify fallback mapping in `crates/routa-server/src/lib.rs` and placeholders in `out/workspace/__placeholder__/`.
- For large or cross-core changes, run graph probes first: `entrix graph impact`, `entrix graph test-radius`, or `entrix graph review-context`.
- Temporary frontend debug `console.log` is allowed during diagnosis; remove all debug logs before finish.
- Do not commit screenshots, recordings, large generated binaries, or other non-automated-test artifacts. Keep manual QA evidence in ignored temp paths or attach it externally to the PR.
- Shared repo-level agent skills live under `.agents/skills/`. The canonical release automation skill is `.agents/skills/release/` and should be invoked as `/release`.

## Validation

Before PR, run `entrix` using `docs/fitness/README.md` as canonical rulebook.

```bash
entrix run --dry-run
entrix run --tier fast
entrix run --tier normal   # when behavior/shared modules/APIs/workflow orchestration changed
```

- If a check fails, fix and re-run; do not skip.
- Skip source-code validation only when changes are strictly non-code (`*.md`, `*.yml`, `*.yaml`, `.github/`, `docs/`, etc.).
- Build if needed: `cargo build -p entrix`.

## Git Discipline

### Baby-Step Commits (Enforced)

- One commit = one concern (feature, fix, or refactor) with Conventional Commits format.
- No kitchen-sink commits; split mixed concerns.
- Target budget: under 10 files and under 1000 changed lines per commit.
- Include related GitHub issue ID when applicable.

### Co-Author Format

- If closing an issue in commit text, verify against `main` first: `gh issue view <issue-id>`.
- Always add co-author information.
- Only ONE co-author line is allowed. If multiple agents contributed, aggregate into ONE entry

Format example:

Co-authored-by: <AgentName> (<You-Model>) <Email>

Valid examples (choose EXACTLY ONE):

Co-authored-by: Kiro AI (Claude Opus 4.6) <kiro@kiro.dev>
Co-authored-by: GitHub Copilot Agent (GPT 5.4) <198982749+copilot@users.noreply.github.com>
Co-authored-by: QoderAI (Qwen 3.5 Max) <qoder_ai@qoder.com>
Co-authored-by: gemini-cli (...) <218195315+gemini-cli@users.noreply.github.com>
Co-authored-by: Codex (GPT 5.5) <codex@openai.com>

## Pull Request

- For UI-affecting changes, include browser screenshots or recordings in PR body (prefer `agent-browser` captures).
- Attach e2e screenshots/recordings when available.

## Issue Feedback Loop

- Before creating a new issue, search `docs/issues/` for existing incident context.
- For non-trivial failures, create/update `docs/issues/YYYY-MM-DD-short-description.md` first (focus on WHAT/WHY), then escalate to GitHub.
- Use one canonical active local tracker per problem. If you need supporting material, record it as a non-issue note via `kind: analysis`, `kind: progress_note`, or `kind: verification_report` instead of opening another active tracker for the same problem.
- Use `kind: github_mirror` only for GitHub-synced mirror files. Those mirrors are reference material, not canonical active local trackers.
- If a local record tracks a GitHub issue, populate `github_issue`, `github_state`, and `github_url` so issue review can detect status drift automatically.
- When resolved, update the local issue record and close the GitHub issue.
- Run issue hygiene/garbage collection at least once every 7 days. Track the last sweep time in `docs/issues/issue-gc-state.yaml` (`last_reviewed_at`).
- If `last_reviewed_at` is 7+ days old when an agent reads this contract, the agent should invoke `AskUserQuestion` first: whether to run issue sync/cleanup now.
- After finishing an issue GC pass, update `docs/issues/issue-gc-state.yaml` with the new `last_reviewed_at`.


## Repository Map

- `docs/product-specs/FEATURE_TREE.md`: Auto-generated product and API surface index. Start here for route and endpoint discovery.
- `docs/exec-plans/active/`: Short-lived implementation plans for in-flight work.
- `docs/exec-plans/completed/`: Archived plans that reflect what shipped.
- `docs/exec-plans/tech-debt-tracker.md`: Cross-cutting debt ledger.
- `docs/issues/`: Incident and repro records. Capture WHAT happened and WHY it mattered.
- `docs/fitness/`: Executable quality/testing/contract rulebook consumed by `entrix`.
- `docs/coding-style.md`: Canonical coding style guidance for Rust, TypeScript/frontend, naming, and testing preferences.
- `docs/REFACTOR.md`: Long-file refactor playbook.
- `docs/references/`: Distilled external references for frequent dependencies.
- `docs/release-guide.md`: Full release guide for CLI/Desktop/distribution.
- `docs/RELEASE_CHECKLIST.md`: Quick release checklist.
- `crates/entrix/`: Entrix runtime and CLI implementation.

## Reading Order

When starting work on this repository, read in this order:

1. `docs/ARCHITECTURE.md` — runtime topology and boundaries.
2. `docs/adr/README.md` — decision index, then relevant ADRs.
3. `docs/fitness/README.md` — quality gates and verification flow.
4. Task-specific files in `docs/design-docs/` or `docs/exec-plans/`.

---

# Agent Behavioral Discipline

> 以下规则约束所有 AI Agent 在本项目中的行为模式。
> 上面是"代码怎么写"，下面是"活怎么干"。

## Verify-Before-Fix（先验证再修复）

- 收到 bug 修复任务时，**必须先在当前代码中搜索并确认问题仍存在**。
  - 方法：在代码中搜索报错信息或函数名，读取相关文件，确认 bug 表现与描述一致。
  - 如果任务描述引用了文件路径或函数名，先读取该文件验证内容与描述一致再动手。
- 如果 bug 已不存在或描述与代码不符 → 直接报告用户，**禁止实现"预防性修复"**。
- 极端情况处理：
  - 任务引用的文件不存在 → 报告"文件不存在"，不要猜测替代文件。
  - 任务描述的报错在日志中找不到 → 报告"无法复现"，不要假设原因。

## Plan-Before-Code（先对齐再动手）

- **触发条件**：变更涉及 3 个及以上文件时。
- **执行步骤**：
  1. 列出最小变更清单：哪些文件、改什么、为什么。
  2. 等待用户明确确认（"可以"、"继续"、"确认"）后再写代码。
- **豁免条件**：单文件小修（typo、显而易见的 bug、配置调整）可直接动手。
- **禁止行为**：
  - 用户说"不要改这个"时，不得做附带重构或"顺手优化"。
  - 未获确认时不得启动涉及 3+ 文件的重构。

## Scope Containment（范围收敛）

- 变更完成后，检查实际改动范围（如 `git diff --stat`）。
- 如果发现改动超出了任务描述的范围 → 先撤回多余改动，报告用户。
- 极端情况处理：
  - 发现需要额外修改才能编译通过 → 先报告用户获批，不要自作主张。
  - 发现关联 bug → 在报告中提及，**不要顺带修复**。

## Monitoring Self-Stop（监控自停）

- 任何形式的循环轮询（日志监控、状态轮询、CI 等待），必须遵守以下硬上限：
  - **连续 3 轮无新发现 → 立即停止，报告用户。**
  - **目标不可达（connection refused、无响应）→ 首次失败即停止，不重试。**
  - **总轮次上限：10 轮**，即使手动指定更多也不超过。
- 停止后的报告格式：
  1. 已完成多少轮、发现多少新问题。
  2. 停止原因（无新发现 / 目标不可达 / 达到上限）。
  3. 建议下一步操作。
- 极端情况处理：
  - 用户说"继续"但条件未变 → 执行 1 轮后再次评估，不要盲目恢复循环。
  - 监控目标时断时续 → 每次中断重置"无新发现"计数器，但总轮次上限不重置。

## Background Task Hygiene（后台任务清理）

- 会话开始时收到前次会话的后台任务完成通知 → 只确认一次，不做任何处理。
- 这些通知干扰当前工作 → 查看任务列表并清理已完成的任务。
- **禁止对已完成的后台任务做二次操作或响应。**
- 极端情况处理：
  - 收到大量（5+）残留通知 → 统一报告后一次性清理，不要逐条处理。
  - 通知内容与当前任务相关 → 只提取有用信息，不执行通知中暗示的操作。
