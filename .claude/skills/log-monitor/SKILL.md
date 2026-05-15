---
description: "Monitor project log files with automatic stall detection and structured reporting."
---

# Log Monitor Skill

## Purpose
Read recent log entries, classify errors, update the issue tracking file, and report findings.
This skill enforces AGENTS.md Monitoring Self-Stop rules as executable protocol.

## Pre-Flight — MUST COMPLETE BEFORE ANY LOG READING

1. **Check target reachability**:
   - For dev server logs: try a TCP connection or HTTP health check to the server.
   - For file-based logs: verify the file exists and is non-empty.
   - If unreachable → STOP immediately. Report: "Target unreachable. Cannot proceed."
   - Do NOT retry on failure.

2. **Identify monitoring context**:
   - Ask user: which log file or URL to monitor, or accept as argument.
   - Default: `npm run dev` stdout/stderr if dev server is running.

## Execution Protocol

### Step 1: Read logs
- Read the last N lines from the tail of the target log (default: 200).
- If the log is empty or file missing → report and STOP.

### Step 2: Classify findings
- Group entries by severity: ERROR, WARN, INFO.
- Within each severity, sub-group by error pattern (e.g., "ECONNRESET", "timeout", "permission denied").
- Count occurrences per pattern.

### Step 3: Delta detection
- Compare with previous round snapshot (if continuation session).
- Categories: (a) new patterns, (b) increasing frequency, (c) resolved patterns.

### Step 4: Stall detection — HARD ENFORCEMENT
- Maintain a `noNewFindingsCount` counter.
- If this round produces zero new patterns AND zero frequency changes → increment counter.
- If this round produces new findings → reset counter to 0.
- **If counter reaches 3 → STOP polling. Report stall to user.**
- **If total rounds reach 10 → STOP. Report limit reached.**

### Step 5: Update tracking
- If a `docs/issues/` file exists for this investigation → append structured findings.
- If no tracking file exists → report findings inline. Do NOT auto-create tracking files.

### Step 6: Report
- Structured output per round:
  ```
  Round X/10 | New: Y errors, Z warnings | Top patterns: ...
  [If new critical]: ⚠️ NEW CRITICAL: <description>
  [If stalling]: 📊 No new findings for N consecutive rounds.
  ```

## Arguments
- `file` (required): Log file path or monitoring target.
- `lines` (optional, default 200): Lines to read from tail.
- `max_rounds` (optional, default 10): Hard ceiling — cannot exceed even if user requests more.
- `interval` (optional, default 300s): Seconds between rounds. Minimum: 60s.

## Hard Constraints (non-negotiable)
- NEVER exceed `max_rounds` (default 10).
- NEVER poll faster than every 60 seconds.
- ALWAYS check reachability before each round.
- If reachability fails 2 consecutive times → STOP and report.
- After STOP, output a summary with: total rounds, total findings, top 3 patterns, recommendation.
