---
description: "Stage, commit, and push changes with Windows-compatible git commands. Handles hook bypass, credential embedding, and branch type verification automatically."
---

# Commit-Push Skill

## Purpose
Execute a safe git commit + push workflow tailored for Routa on Windows.
Encapsulates all Windows workarounds so each session starts with correct behavior.

## Pre-Flight Checks — ALL MUST PASS BEFORE PROCEEDING

### Check 1: Read Windows pitfalls
- BEFORE any git operation, read `people/yelisheng/windows-pitfalls.md`.
- If the file does not exist → WARN user and ask for guidance. Do NOT proceed without it.

### Check 2: Working tree state
- Run: `git status`
- If clean → report "Nothing to commit" and STOP.
- If dirty → list changed files for user review.

### Check 3: Branch type verification
- Run: `git branch --show-current`
- `private/*` → push to `origin private/<name>`.
- `upstream/*` or `main` → ASK user to confirm target before pushing.
- Ambiguous → ASK user.
- **Never guess. Never auto-detect from context. Always confirm if unsure.**

### Check 4: Untracked file safety
- Run: `git ls-files --others --exclude-standard`
- If untracked files match: `.env`, `*credentials*`, `*secret*`, `*.key`, `*.pem` → WARN and exclude.
- Only stage files user explicitly confirms or clearly belong to the current task.

## Commit Protocol

### Step 1: Stage
- Prefer: `git add <specific-file-1> <specific-file-2> ...`
- Avoid: `git add -A` or `git add .` (risk of staging unintended files).
- If user doesn't specify which files → show diff summary and ask.

### Step 2: Generate commit message
- Analyze staged diff.
- Format: `type(scope): description` (Conventional Commits).
  - Types: feat, fix, refactor, test, docs, chore, style, perf
  - Scope: module/area (kanban, gitlab, session, acp, etc.)
- Subject line ≤ 72 characters.
- If closing a GitHub issue → include `Fixes #<issue-number>` in body.
- Co-author: exactly ONE line, format per CLAUDE.md.
- Show message to user for approval before committing.

### Step 3: Write commit (Windows-specific)
- Write message to temp file first:
  ```bash
  cat > /tmp/commit-msg.txt << 'ENDMSG'
  <commit-message-here>
  ENDMSG
  ```
- Then commit with hook bypass:
  ```bash
  git -c core.hooksPath=/dev/null commit -F /tmp/commit-msg.txt
  ```
- **Forbidden approaches** (will fail on this machine):
  - `git commit -m "..."` with heredoc inline
  - `--no-verify` (unnecessary when hooksPath is /dev/null)
  - Modifying hooksPath in git config
  - `HUSKY=0`, `SKIP_HOOKS=1` environment variables

### Step 4: Push (Windows-specific)
- Extract remote URL: `git remote get-url origin`
- Push with token:
  ```bash
  git -c core.hooksPath=/dev/null push "https://x-access-token:${GH_TOKEN}@github.com/<owner>/<repo>.git" <branch>
  ```
- Replace `<owner>/<repo>` and `<branch>` with actual values.
- Verify exit code is 0.

## Post-Commit Verification
- `git status` → confirm clean.
- `git log --oneline -3` → show recent commits.
- Report: commit hash, branch, push status.

## Error Recovery
- Commit fails → show error, suggest fix. Do NOT retry blindly.
- Push fails (diverged) → suggest `git pull --rebase` first. Do NOT force push.
- Credential fails → verify `GH_TOKEN` env var is set. Suggest `echo $GH_TOKEN` to check.
- If all else fails → refer back to `people/yelisheng/windows-pitfalls.md` for the complete troubleshooting guide.
