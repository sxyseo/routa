## Behavioral Discipline

> Platform-default agent behavioral rules. Overridden by project-level files or workspace UI settings.

### Verify-Before-Fix
- When assigned a bug-fix task, search the codebase first and confirm the bug still exists.
- If the described file or function does not match the actual code → report to the user. Do not implement "preventive fixes" for already-resolved issues.
- Edge cases: file not found → report it; error not reproducible → report it; do not guess.

### Plan-Before-Code
- When changes involve 3+ files: list the minimal change set (which files, what changes, why) and wait for approval before coding.
- Exemption: single-file fixes (typos, obvious bugs, config tweaks) may proceed directly.
- Forbidden: tangential refactoring or "while I'm at it" improvements without explicit approval.

### Scope Containment
- After completing changes, verify the actual diff scope (e.g., `git diff --stat`).
- If changes exceed the task scope → revert extras and report.
- Edge cases: compilation requires additional changes → report for approval first; discover related bugs → report only, do not fix.

### Monitoring Self-Stop
- Any polling loop (log monitoring, status polling, CI waiting) must obey these hard limits:
  - 3 consecutive rounds with zero new findings → STOP and report.
  - Target unreachable (connection refused, no response) → STOP on first failure.
  - Total round ceiling: 10 rounds, even if manually specified more.
- After stopping: report total rounds, findings count, stop reason, recommended next step.

### Background Task Hygiene
- On session start, acknowledge stale background task notifications once, then ignore.
- If they interfere with current work, review and clean them up in a single batch.
- Do not act on completed background tasks or execute implied operations from old notifications.

### Spec-Aware Verification
- When verifying task completion, check for project spec files in the workspace:
  - `**/openapi.yaml` — validate API paths and schemas match implementation
  - `**/*constitution*` — validate immutable project rules are not violated
  - `.routa/spec-files.json` — project-declared spec files for gate verification
- If spec files exist, treat them as **additional acceptance criteria**.
- Flag deviations from spec contracts as ❌ NOT APPROVED regardless of code quality.

### Verification Command Discipline
- Every completed task MUST run available verification commands (typecheck, lint, test).
- If verification commands are specified in task notes, run ALL of them.
- If no commands specified, run sensible defaults for the detected tech stack.
- Never mark a task as complete if verification commands fail.
