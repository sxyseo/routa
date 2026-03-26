---
name: entrix
description: Bootstrap a new entrix fitness configuration for a project, run fitness checks, graph-backed impact analysis, test radius estimation, and review context generation. Use when the user needs to set up entrix for a new project, validate code quality gates, assess blast radius before changes, find impacted tests, generate a PR review context, or evaluate whether human review is required. Triggers include "set up entrix", "bootstrap fitness", "add fitness config", "run fitness", "check quality gates", "what's the blast radius", "find impacted tests", "generate review context", or any task requiring architecture fitness validation or structural impact analysis.
argument-hint: "[init | tier: fast|normal|deep] [--changed-only] [graph impact|test-radius|review-context|review-trigger]"
---

# Entrix — Fitness & Graph Analysis

Entrix turns quality rules, architecture constraints, and validation steps into
executable guardrails. It answers three questions continuously:

- Should this change pass baseline quality gates?
- What level of confidence do we have in the current change?
- When should the system route the change to deeper validation or human review?

---

## Step 0: Installation

```bash
# Install from PyPI (recommended for CI and global use)
pip install entrix
# or with uv
uv tool install entrix

# Run without installing globally
uvx entrix --help
uvx entrix run --tier fast

# For graph-backed analysis
pip install entrix[graph]

# Development install from this repo
pip install -e tools/entrix
```

---

## Step 1: Bootstrap a New Project (Automated)

When setting up entrix for a **new repo**, use `claude -p` to generate the
`docs/fitness/` config automatically. Run this from the project root:

```bash
claude -p "
You are setting up entrix fitness configuration for this project.

Study the project structure, tech stack, and existing quality tooling (linters,
test runners, build scripts) by reading key files: package.json / pyproject.toml /
Cargo.toml, CI workflows (.github/workflows/), and any existing docs/fitness/ files.

Then create the following files under docs/fitness/:

1. README.md — overview of the fitness setup: local usage commands, dimension list,
   execution policy (fast/normal/deep), and a file inventory.

2. One dimension file per concern, for example:
   - code-quality.md  (weight 35, covers lint + no debug prints)
   - testability.md   (weight 40, covers test runner must pass)
   - release-readiness.md (weight 25, covers build smoke test)
   Each file must have YAML front-matter with: dimension, weight, tier, threshold,
   and metrics (name, command, hard_gate, tier, description). Weights must sum to 100.

3. review-triggers.yaml — escalation rules with types: changed_paths,
   sensitive_file_change, cross_boundary_change, diff_size.

4. manifest.yaml — schema: fitness-manifest-v1, listing all evidence files.

Use the actual tool commands found in the project (e.g. npm run lint, cargo test,
pytest, ruff check). Set hard_gate: true for commands that must always pass.
Do not invent commands that do not exist in the project.
"
```

After generation, validate and do a dry run:

```bash
entrix validate
entrix run --dry-run
entrix run --tier fast
```

### Expected Output Structure

```
docs/fitness/
  README.md               # local usage guide + dimension inventory
  manifest.yaml           # evidence file index
  code-quality.md         # lint, type-check, style (weight ~35)
  testability.md          # test suite (weight ~40)
  release-readiness.md    # build + CLI smoke (weight ~25)
  review-triggers.yaml    # human-review escalation rules
```

### Dimension File Format

```yaml
---
dimension: code_quality
weight: 35
tier: normal
threshold:
  pass: 100
  warn: 90
metrics:
  - name: lint_pass
    command: npm run lint 2>&1
    hard_gate: true
    tier: fast
    description: "ESLint must pass with no errors."

  - name: typecheck_pass
    command: npm run typecheck 2>&1
    hard_gate: true
    tier: fast
    description: "TypeScript type check must pass."
---

# Code Quality
...
```

### review-triggers.yaml Format

```yaml
review_triggers:
  - name: core_engine_change
    type: changed_paths
    paths:
      - src/lib/engine/**
    severity: high
    action: require_human_review

  - name: oversized_change
    type: diff_size
    max_files: 10
    max_added_lines: 400
    max_deleted_lines: 250
    severity: medium
    action: require_human_review
```

---

## Step 2: Run Fitness Checks

```bash
# After any source edit — fast tier
entrix run --tier fast

# After behavior, shared module, API, or workflow changes — normal tier
entrix run --tier normal

# Incremental: only check files changed since HEAD~1
entrix run --tier fast --changed-only --base HEAD~1

# Dry-run: see what would run without executing
entrix run --dry-run

# Validate that config weights sum to 100%
entrix validate
```

Results print `✅ PASS` / `❌ FAIL` / `⏭️ SKIPPED` per metric.
Hard-gate failures exit with code 1 — fix these before proceeding.

---

## Step 3: Graph Impact Analysis

Use before large refactors or when touching shared core modules.

```bash
# Build/update the code graph (incremental by default)
entrix graph build

# Blast radius for current diff vs main
entrix graph impact --base main

# Blast radius for specific files
entrix graph impact src/lib/session.ts src/lib/workspace.ts

# Test files in the radius of the current diff
entrix graph test-radius --base main

# AI-friendly review context for the current diff
entrix graph review-context --base main

# Save review context to a file
entrix graph review-context --base main --json --output /tmp/review-context.json
```

| Field | Meaning |
|---|---|
| `changed_files` | Files directly modified |
| `impacted_files` | Files that depend on changed files |
| `impacted_test_files` | Test files in the blast radius |
| `wide_blast_radius` | High-risk: many dependents affected |

When `wide_blast_radius` is `yes`, run `entrix run --tier normal` and request
human review before merging.

---

## Step 4: Review Trigger Evaluation

```bash
# Evaluate current diff vs HEAD~1
entrix review-trigger

# Evaluate against a specific base
entrix review-trigger --base main

# Block CI if human review is required
entrix review-trigger --base main --fail-on-trigger
```

---

## Tier Reference

| Tier | When to Use |
|---|---|
| `fast` | Every source edit — lint, type, budget |
| `normal` | Behavior / shared module / API changes |
| `deep` | Pre-PR or full CI validation |

## Common Flags

| Flag | Description |
|---|---|
| `--tier fast\|normal\|deep` | Execution tier |
| `--changed-only` | Restrict to git-changed files |
| `--base <ref>` | Git base for diff (default: `HEAD~1`) |
| `--dry-run` | Print what would run without executing |
| `--dimension <name>` | Restrict to named dimension(s) |
| `--verbose` | Show full output for failures |
| `--json` | Machine-readable output |
| `--output <file>` | Write report to file |

## Troubleshooting

- **`fitness directory not found`** — Run from the repo root (must contain `package.json` or `Cargo.toml`).
- **`Weights sum to N%, expected 100%`** — Run `entrix validate` and fix weights in `docs/fitness/`.
- **Graph commands return `unavailable`** — Run `pip install entrix[graph]`, then `entrix graph build`.
- **Hard-gate failure** — Re-run with `--verbose` to see the first 10 lines of the failing command output.
