---
name: issue-garbage-collector
description: Two-phase cleanup of duplicate and outdated issue files in docs/issues/. Phase 1 uses Python script for fast pattern matching. Phase 2 uses claude -p for semantic analysis on suspects only.
when_to_use: When the issues directory becomes cluttered, after resolving multiple issues, or as periodic maintenance (weekly during active development, monthly otherwise).
version: 1.2.0
---

## Quick Start

```bash
# Phase 1: Run Python scanner (fast, free)
python3 scripts/issue-scanner.py

# Phase 1: Get suspects only (for Phase 2 input)
python3 scripts/issue-scanner.py --suspects-only

# Phase 1: JSON output (for automation)
python3 scripts/issue-scanner.py --json

# Phase 1: Validation check (CI integration, exit 1 if errors)
python3 scripts/issue-scanner.py --check
```

---

## Two-Phase Strategy (Cost Optimization)

**Problem**: Running deep AI analysis on every issue is expensive.

**Solution**: Two-phase approach:
1. **Phase 1 (Fast/Free)** — Python script for pattern matching
2. **Phase 2 (Deep/Expensive)** — `claude -p` only on suspects

```
┌─────────────────────────────────────────────────────────┐
│  All Issues (N files)                                   │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Phase 1: Python Scanner (scripts/issue-scanner.py)│  │
│  │ - Filename keyword extraction                     │  │
│  │ - YAML front-matter validation                    │  │
│  │ - Same area + keyword overlap detection           │  │
│  │ - Age-based staleness check                       │  │
│  │ → Output: Suspect list (M files, M << N)          │  │
│  └───────────────────────────────────────────────────┘  │
│                         ↓                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Phase 2: Deep Analysis (claude -p, only M files)  │  │
│  │ - Content similarity                              │  │
│  │ - Semantic duplicate detection                    │  │
│  │ - Merge recommendations                           │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 1: Python Scanner

Run `python3 scripts/issue-scanner.py` to get:

### 1.1 Formatted Table View

```
====================================================================================================
📋 ISSUE SCANNER REPORT
====================================================================================================

📊 ISSUE TABLE:
----------------------------------------------------------------------------------------------------
Status       Sev  Date         Area               Title
----------------------------------------------------------------------------------------------------
✅ resolv     🟠    2026-03-02   background-worker  HMR 导致 sessionToTask 内存 Map 丢失
🔴 open       🟡    2026-03-04   ui                 Task Execute button disabled
...
----------------------------------------------------------------------------------------------------
Total: 12 issues

📈 SUMMARY BY STATUS:
  🔴 open: 5
  ✅ resolved: 7
```

### 1.2 Validation Errors

If any issue has malformed front-matter, the scanner reports:

```
❌ VALIDATION ERRORS (need AI fix):
------------------------------------------------------------
  2026-03-08-broken-issue.md:
    - Missing required field: area
    - Invalid status: pending (valid: ['open', 'investigating', 'resolved', 'wontfix', 'duplicate'])
```

**Action**: Ask AI to fix the file:
```bash
claude -p "Fix the front-matter in docs/issues/2026-03-08-broken-issue.md. Add missing 'area' field and change status to a valid value."
```

### 1.3 Suspect Detection

The scanner automatically detects:

| Type | Detection Rule | Example |
|------|----------------|---------|
| **Duplicate** | Same area + ≥2 common keywords | `hmr-task` vs `task-hmr-recovery` |
| **Stale** | `open` > 30 days | Issue from 2026-01-15 still open |
| **Stale** | `investigating` > 14 days | Stuck investigation |

Output:
```
⚠️  SUSPECTS (need Phase 2 deep analysis):
------------------------------------------------------------

  🔗 Potential Duplicates:
    - 2026-03-02-hmr-resets-session-to-task-map.md
      ↔ 2026-03-08-background-task-hmr-recovery.md
      Reason: Same area 'background-worker', keywords: {'task', 'hmr'}

  ⏰ Stale Issues:
    - 2026-02-01-old-bug.md: Open for 35 days (>30)
```

### 1.4 JSON Output for Automation

```bash
# Get suspects as JSON for scripting
python3 scripts/issue-scanner.py --suspects-only
```

Output:
```json
[
  {
    "file_a": "2026-03-02-hmr-resets-session-to-task-map.md",
    "file_b": "2026-03-08-background-task-hmr-recovery.md",
    "reason": "Same area 'background-worker', keywords: {'task', 'hmr'}",
    "type": "duplicate"
  }
]
```

---

## Phase 2: Deep Analysis (claude -p)

Only run on suspects from Phase 1. This saves cost.

### 2.1 Duplicate Confirmation

```bash
claude -p "
Compare these two suspect duplicate issues:
- docs/issues/2026-03-02-drizzle-migrate.md
- docs/issues/2026-03-05-drizzle-timeout.md

Check:
1. Are the error messages the same or related?
2. Do they reference the same files in 'Relevant Files'?
3. Is the root cause the same?

Output:
- DUPLICATE: Same issue, recommend merge
- RELATED: Different aspects of same problem, add cross-reference
- DISTINCT: False positive, keep both
"
```

### 2.2 Stale Issue Triage

```bash
claude -p "
Review this stale issue:
- docs/issues/2026-02-01-old-bug.md

Check:
1. Does the referenced code still exist?
2. Has the issue been fixed in recent commits?
3. Is it still relevant to current codebase?

Output:
- CLOSE: Issue resolved, update status
- ESCALATE: Still relevant, create GitHub issue
- ARCHIVE: No longer applicable, move to archive
"
```

### 2.3 Interactive Merge

```bash
claude -p "
Merge these confirmed duplicate issues:
- docs/issues/2026-03-02-drizzle-connection-failure.md (older)
- docs/issues/2026-03-05-drizzle-timeout.md (newer)

Steps:
1. Read both files
2. Identify unique content in older file
3. Propose merged content for newer file
4. Show diff before changes
5. Wait for my approval before executing
"
```

---

## Decision Matrix

| Phase 1 Finding | Phase 2 Action | Final Action |
|-----------------|----------------|--------------|
| Same keywords in filename | Run duplicate check | Merge if confirmed |
| Same area + overlapping tags | Run duplicate check | Cross-reference if related |
| Status: open > 30 days | Run stale triage | Close/Escalate/Archive |
| Status: investigating > 14 days | Ask human | Continue or close |
| Status: resolved | Skip Phase 2 | Keep as knowledge |

---

## Safety Rules

1. **Never delete `_template.md`**
2. **Never delete issues with `status: investigating`** — active work
3. **Always ask for confirmation** before any deletion
4. **Show diff before merge** — let human verify
5. **Commit incrementally** — one logical change per commit
6. **Preserve knowledge** — resolved issues are valuable

---

## Execution Checklist

### Phase 1 (You)
- [ ] List all files in `docs/issues/` (excluding `_template.md`)
- [ ] Extract filename keywords and dates
- [ ] Parse YAML front-matter (status, area, tags)
- [ ] Apply filename similarity rules
- [ ] Apply age-based staleness rules
- [ ] Output suspect list

### Phase 2 (claude -p, only on suspects)
- [ ] For each duplicate suspect pair: run confirmation check
- [ ] For each stale issue: run triage check
- [ ] Collect recommendations

### Cleanup (You, with human approval)
- [ ] Merge confirmed duplicates
- [ ] Update stale issue statuses
- [ ] Generate final report
- [ ] Commit changes

---

## Periodic Maintenance Schedule

| Frequency | Phase 1 | Phase 2 |
|-----------|---------|---------|
| After adding issues | Filename scan only | Skip (too few suspects) |
| Weekly (active dev) | Full scan | On suspects only |
| Monthly (stable) | Full scan + stale check | On all suspects |

---

## Cost Comparison

| Approach | Issues Scanned | Deep Analysis | Relative Cost |
|----------|----------------|---------------|---------------|
| Naive (all deep) | 50 | 50 | 💰💰💰💰💰 |
| Two-phase (this) | 50 | ~5 suspects | 💰 |

**Savings**: ~90% cost reduction by filtering in Phase 1.

