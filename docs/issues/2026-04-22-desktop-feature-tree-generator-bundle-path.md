---
title: "Desktop release build resolves feature-tree generator to compile-time builder path"
date: "2026-04-22"
kind: issue
status: resolved
resolved_at: "2026-04-22"
severity: high
area: "desktop-feature-tree"
tags: ["desktop", "feature-tree", "tauri", "release"]
reported_by: "codex"
github_issue: 522
github_state: open
github_url: "https://github.com/phodal/routa/issues/522"
---

# What Happened

The Rust feature-tree bridge resolved `scripts/docs/feature-tree-generator.ts` from `env!("CARGO_MANIFEST_DIR")`.

That works in local source checkouts, but Tauri release builds preserve the compile-time manifest path from the build machine. In shipped desktop binaries, feature-tree generation therefore tried to read paths such as:

- `/Users/runner/work/routa/routa/crates/routa-server/../../scripts/docs/feature-tree-generator.ts`

Those paths do not exist on end-user machines, so feature-tree generation failed before any repo scanning started.

# Why It Mattered

- Desktop release users could not generate or commit `FEATURE_TREE.md`.
- The failure happened inside the Rust backend, so both the desktop UI flow and Rust CLI bridge inherited the same brittle path assumption.
- The error message pointed at a build-machine path, which obscured the actual release packaging gap.

# Resolution

- Bundle a release-safe `feature-tree-generator.mjs` into Tauri resources during `scripts/prepare-frontend.mjs`.
- Expose the Tauri resource directory to the Rust backend through `ROUTA_FEATURE_TREE_RESOURCE_DIR`.
- Make Rust feature-tree execution prefer runtime-provided generator paths and execute JavaScript bundles without `tsx`.
- Run the generator with the target `repo_root` as `current_dir` so release builds no longer depend on a compile-time workspace path existing locally.
