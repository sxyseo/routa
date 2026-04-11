# Routa Watch

`routa-watch` is a Rust terminal tool for tracking multiple coding-agent sessions inside one git repository.

It is `TUI-first`: the main path is a live terminal view that answers:

- which sessions are active
- which files each session most likely touched
- which files are still dirty in the worktree
- what changed recently from hooks, git hooks, and watcher events

## Current Hook Setup

This repository already has a repo-local Codex hook config at [`.codex/hooks.json`](/Users/phodal/ai/routa-js/.codex/hooks.json).

It currently forwards:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

And the tool matcher includes:

- `Bash`
- `Read`
- `Write`
- `Edit`
- `MultiEdit`
- `LS`
- `Glob`
- `Grep`
- `Search`
- `WebSearch`

That means a session can stay visible even when it is only reading/searching, not just writing.

## Runtime Model

Routa Watch now starts in TUI mode by default. Running:

```bash
routa-watch --repo .
```

will:

1. open the TUI
2. ensure a repo-local runtime service is running in the background
3. read live events from the local runtime feed

The runtime transport layers are attempted in this order:

1. Unix domain socket
2. Localhost TCP
3. Append-only JSONL feed fallback

The current commands are:

- `routa-watch`
- `routa-watch tui`
- `routa-watch serve`
- `routa-watch hook <client> <event>`
- `routa-watch git-hook <event>`

Recommended local flow:

```bash
cargo build -p routa-watch
target/debug/routa-watch --repo .
```

If local socket/port binding is unavailable, hooks automatically fall back to the JSONL feed. The title bar shows the current runtime mode as `rpc:socket`, `rpc:tcp`, or `rpc:feed`.

## TUI Layout

Example layout:

```text
 RoutaWatch   repo:routa-js  branch:main  agents:2 active:1  dirty:2  unknown:1  synced <1m ago
┌Files───────────────────────────────────────────────────────────────────────────────┐┌File Preview────────────────────┐
│ ALL FILES  2 files  commits:5                                                      ││ 1 fn render(frame: &mut Frame) │
│────────────────────────────────────────────────────────────────────────────────────││{                               │
│> tui.rs                                                   ...h/src  M  +38 -5     4││ 2     // preview               │
│  route.ts                                                 .../card  D  -12        5││ 3 }                            │
│                                                                                    │└────────────────────────────────┘
│                                                                                    │┌Details─────────────────────────┐
│                                                                                    ││tui.rs                          │
│                                                                                    ││crates/routa-watch/src          │
│                                                                                    ││Lines: 387  Size: 16.5 KB       │
│                                                                                    ││Git changes: 3                  │
└────────────────────────────────────────────────────────────────────────────────────┘└────────────────────────────────┘
 Tab focus  ↑↓ select  u unknown  d preview/diff  Pg scroll  f follow:on  T theme  Esc clear  q quit
```

Main regions:

- `Sessions`: active, idle, stopped, and synthetic `Unknown`
- `Files`: `BY SESSION`, `GLOBAL`, `UNKNOWN-CONFLICT`
- `Details`: selected file metadata + preview/diff
- `Event Stream`: hook / git / watch events

## Keybindings

- `Tab`: switch focus
- `j/k` or `↑/↓`: move selection
- `h/l` or `←/→`: switch file pager
- `Enter`: file preview
- `D`: diff view
- `s`: cycle file mode
- `T`: cycle theme
- `/`: start search filter
- `Esc`: clear filter / exit search input
- `r`: follow mode on/off
- `1`: all events
- `2`: hook events
- `3`: git events
- `4`: watch events
- `[` / `]`: previous / next diff hunk
- `q`: quit

## Install Hooks

Build first:

```bash
cargo build -p routa-watch
```

Install templates:

```bash
ROUTA_WATCH_BIN=$PWD/target/debug/routa-watch ./crates/routa-watch/scripts/install-hooks.sh
```

This installs:

- `$HOME/.codex/hooks.json`
- `.git/hooks/post-commit`
- `.git/hooks/post-merge`
- `.git/hooks/post-checkout`

In this repository, the repo-local [`.codex/hooks.json`](/Users/phodal/ai/routa-js/.codex/hooks.json) is already present and is the one you should inspect first.

## Notes

- `routa-watch sessions`, `files`, `who`, and `watch` still exist as legacy/debug commands.
- The SQLite store is still present for fallback/debug paths, but the primary direction is realtime transport plus TUI.
- When multiple sessions touch the same worktree and attribution is ambiguous, Routa Watch intentionally shows `unknown/conflict` instead of faking certainty.
