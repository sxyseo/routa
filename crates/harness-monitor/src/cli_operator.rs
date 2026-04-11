use crate::db::{Db, SessionListRow};
use crate::detect::scan_agents;
use crate::models::{self, DetectedAgent};
use crate::{RunCommand, WorkspaceCommand};
use anyhow::{bail, Context, Result};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone)]
struct CliRunSummary {
    run_id: String,
    client: String,
    cwd: String,
    model: String,
    started_at_ms: i64,
    last_seen_at_ms: i64,
    status: String,
    ended_at_ms: Option<i64>,
    role: &'static str,
    workspace_id: String,
    workspace_path: String,
    workspace_state: String,
    origin: &'static str,
    operator_state: String,
    block_reason: String,
    integrity_warning: Option<String>,
    next_action: String,
    handoff_summary: Option<String>,
    exact_files: usize,
    inferred_files: usize,
    unknown_files: usize,
    changed_files: Vec<String>,
    latest_eval: Option<crate::domain::EvalSnapshot>,
}

#[derive(Debug, Clone, Default)]
struct GitWorktreeRecord {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    detached: bool,
}

#[derive(Debug, Clone)]
struct CliWorkspaceSummary {
    id: String,
    path: String,
    branch: Option<String>,
    head: Option<String>,
    detached: bool,
    state: String,
    dirty_files: usize,
    attached_runs: Vec<String>,
    attached_agents: Vec<String>,
    integrity_warnings: Vec<String>,
    recovery_hint: Option<String>,
}

pub(crate) fn handle_run_command(action: RunCommand, db: &Db, repo_root: &str) -> Result<()> {
    let detected_agents = scan_agents(repo_root).unwrap_or_default();
    let worktrees = load_git_worktree_records(repo_root).unwrap_or_else(|_| {
        vec![GitWorktreeRecord {
            path: repo_root.to_string(),
            head: None,
            branch: Some("main".to_string()),
            detached: false,
        }]
    });
    match action {
        RunCommand::List => {
            let runs = load_cli_run_summaries(db, repo_root, &detected_agents, &worktrees)?;
            if runs.is_empty() {
                println!("No active runs.");
                return Ok(());
            }
            println!(
                "{:<24}  {:<10}  {:<11}  {:<10}  {:<14}  {:>5}",
                "RUN / SESSION", "ROLE", "STATE", "WORKSPACE", "ORIGIN", "FILES"
            );
            println!("{}", "-".repeat(92));
            for run in &runs {
                println!(
                    "{:<24}  {:<10}  {:<11}  {:<10}  {:<14}  {:>5}",
                    run.run_id,
                    run.role,
                    run.operator_state,
                    run.workspace_id,
                    run.origin,
                    run.changed_files.len()
                );
            }
        }
        RunCommand::Show { id } => {
            let runs = load_cli_run_summaries(db, repo_root, &detected_agents, &worktrees)?;
            let found = runs.iter().find(|run| run.run_id == id);
            match found {
                Some(run) => {
                    println!("run_id:      {}", run.run_id);
                    println!("mode:        unmanaged");
                    println!("origin:      {}", run.origin);
                    println!("role:        {}", run.role);
                    println!("state:       {}", run.operator_state);
                    println!("block:       {}", run.block_reason);
                    println!("client:      {}", run.client);
                    println!("status:      {}", run.status);
                    println!("cwd:         {}", run.cwd);
                    println!(
                        "workspace:   {} ({})",
                        run.workspace_id, run.workspace_state
                    );
                    println!("worktree:    {}", run.workspace_path);
                    println!(
                        "files:       {} exact / {} inferred / {} unknown",
                        run.exact_files, run.inferred_files, run.unknown_files
                    );
                    println!("started:     {}", format_timestamp_ms(run.started_at_ms));
                    println!("last_seen:   {}", format_timestamp_ms(run.last_seen_at_ms));
                    if let Some(ended_at_ms) = run.ended_at_ms.filter(|ms| *ms > 0) {
                        println!("ended:       {}", format_timestamp_ms(ended_at_ms));
                    }
                    if !run.model.is_empty() {
                        println!("model:       {}", run.model);
                    }
                    if let Some(eval) = &run.latest_eval {
                        println!("eval:        {}", summarize_eval(eval));
                    } else {
                        println!("eval:        pending");
                    }
                    if let Some(warning) = &run.integrity_warning {
                        println!("integrity:   {}", warning);
                    }
                    println!("next:        {}", run.next_action);
                    if let Some(handoff) = &run.handoff_summary {
                        println!("handoff:     {}", handoff);
                    }
                    if run.changed_files.is_empty() {
                        println!("changed:     -");
                    } else {
                        println!("changed:");
                        for path in &run.changed_files {
                            println!("  - {}", path);
                        }
                    }
                }
                None => println!("Run '{id}' not found."),
            }
        }
        RunCommand::Attach { session } => {
            println!("Attaching observer to session: {session}");
            println!("(Managed attachment is a Phase 3 capability.)");
        }
        RunCommand::Stop { id } => {
            println!("Stop requested for run: {id}");
            println!("(Managed stop/interrupt is a Phase 3 capability.)");
        }
    }
    Ok(())
}

pub(crate) fn handle_workspace_command(
    action: WorkspaceCommand,
    repo_root: &str,
    db: Option<&Db>,
) -> Result<()> {
    let worktrees = load_git_worktree_records(repo_root).unwrap_or_else(|_| {
        vec![GitWorktreeRecord {
            path: repo_root.to_string(),
            head: None,
            branch: Some("main".to_string()),
            detached: false,
        }]
    });
    let detected_agents = scan_agents(repo_root).unwrap_or_default();
    let runs = db
        .and_then(|db| load_cli_run_summaries(db, repo_root, &detected_agents, &worktrees).ok())
        .unwrap_or_default();
    let workspaces = load_cli_workspace_summaries(repo_root, &worktrees, &detected_agents, &runs);
    match action {
        WorkspaceCommand::List => {
            if !workspaces.is_empty() {
                println!(
                    "{:<16}  {:<10}  {:>4}  {:>6}  {:<20}  PATH",
                    "WORKSPACE", "STATE", "RUNS", "AGENTS", "BRANCH"
                );
                println!("{}", "-".repeat(108));
                for workspace in &workspaces {
                    println!(
                        "{:<16}  {:<10}  {:>4}  {:>6}  {:<20}  {}",
                        workspace.id,
                        workspace.state,
                        workspace.attached_runs.len(),
                        workspace.attached_agents.len(),
                        workspace
                            .branch
                            .clone()
                            .unwrap_or_else(|| "<detached>".to_string()),
                        workspace.path
                    );
                }
            } else {
                println!("worktree: {repo_root} (main)");
            }
        }
        WorkspaceCommand::Show { id } => {
            let found = workspaces.iter().find(|workspace| {
                workspace.path == id
                    || workspace.id == id
                    || (id == "main" && workspace.path == repo_root)
            });

            match found {
                Some(workspace) => {
                    println!("workspace:   {}", workspace.id);
                    println!("path:        {}", workspace.path);
                    println!(
                        "branch:      {}",
                        workspace
                            .branch
                            .clone()
                            .unwrap_or_else(|| "<detached>".to_string())
                    );
                    if let Some(head) = &workspace.head {
                        println!("head:        {}", head);
                    }
                    println!("state:       {}", workspace.state);
                    println!("dirty_files: {}", workspace.dirty_files);
                    println!("runs:        {}", workspace.attached_runs.len());
                    if workspace.attached_runs.is_empty() {
                        println!("run_ids:      -");
                    } else {
                        println!("run_ids:     {}", workspace.attached_runs.join(", "));
                    }
                    println!("agents:      {}", workspace.attached_agents.len());
                    if workspace.attached_agents.is_empty() {
                        println!("agent_ids:    -");
                    } else {
                        println!("agent_ids:   {}", workspace.attached_agents.join(", "));
                    }
                    if workspace.integrity_warnings.is_empty() {
                        println!("integrity:   ok");
                    } else {
                        println!("integrity:   {}", workspace.integrity_warnings.join("; "));
                    }
                    if let Some(hint) = &workspace.recovery_hint {
                        println!("recovery:    {}", hint);
                    }
                    println!("detached:    {}", workspace.detached);
                }
                None => println!("Workspace '{id}' not found."),
            }
        }
    }
    Ok(())
}

pub(crate) fn summarize_eval(eval: &crate::domain::EvalSnapshot) -> String {
    let status = if eval.hard_gate_blocked {
        "blocked(hard)"
    } else if eval.score_blocked {
        "blocked(score)"
    } else {
        "pass"
    };
    format!(
        "{} {} {:.1}%",
        eval.mode.as_str(),
        status,
        eval.overall_score
    )
}

fn format_timestamp_ms(timestamp_ms: i64) -> String {
    if timestamp_ms <= 0 {
        return "unknown".to_string();
    }

    chrono::DateTime::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| timestamp_ms.to_string())
}

fn load_cli_run_summaries(
    db: &Db,
    repo_root: &str,
    detected_agents: &[DetectedAgent],
    worktrees: &[GitWorktreeRecord],
) -> Result<Vec<CliRunSummary>> {
    let sessions = db.list_active_sessions(repo_root)?;
    let dirty_files = db.file_state_all_dirty(repo_root)?;
    let latest_eval_by_run = load_latest_eval_by_run(db, &sessions)?;
    Ok(build_cli_run_summaries(
        repo_root,
        sessions,
        dirty_files,
        detected_agents,
        worktrees,
        &latest_eval_by_run,
    ))
}

fn build_cli_run_summaries(
    repo_root: &str,
    sessions: Vec<SessionListRow>,
    dirty_files: Vec<models::FileStateRow>,
    detected_agents: &[DetectedAgent],
    worktrees: &[GitWorktreeRecord],
    latest_eval_by_run: &BTreeMap<String, crate::domain::EvalSnapshot>,
) -> Vec<CliRunSummary> {
    let mut dirty_by_session: BTreeMap<String, Vec<models::FileStateRow>> = BTreeMap::new();
    let mut unknown_rows = Vec::new();
    let matched_agent_keys = matched_agent_keys_for_sessions(&sessions, detected_agents);

    for row in dirty_files {
        if let Some(session_id) = row.session_id.clone() {
            dirty_by_session.entry(session_id).or_default().push(row);
        } else {
            unknown_rows.push(row);
        }
    }

    let mut runs = Vec::new();
    for (session_id, cwd, model, started_at_ms, last_seen_at_ms, client, status, ended_at_ms) in
        &sessions
    {
        let rows = dirty_by_session.remove(session_id).unwrap_or_default();
        let exact_files = rows
            .iter()
            .filter(|row| row.confidence.as_deref() == Some("exact"))
            .count();
        let inferred_files = rows
            .iter()
            .filter(|row| row.confidence.as_deref() == Some("inferred"))
            .count();
        let unknown_files = rows
            .iter()
            .filter(|row| row.confidence.as_deref() != Some("exact"))
            .filter(|row| row.confidence.as_deref() != Some("inferred"))
            .count();
        let changed_files = rows
            .iter()
            .map(|row| row.rel_path.clone())
            .collect::<Vec<_>>();
        let latest_eval = latest_eval_by_run.get(session_id).cloned();
        let role = infer_cli_run_role(session_id, client, status);
        let (workspace_id, workspace_path, workspace_detached) =
            workspace_identity_for(Some(cwd), repo_root, worktrees);
        let workspace_state = infer_cli_workspace_state(
            dirty_by_workspace_count(&workspace_id, repo_root, &workspace_path, &rows),
            latest_eval.as_ref(),
            workspace_detached,
            false,
        );
        let integrity_warning =
            infer_cli_integrity_warning(workspace_detached, false, unknown_files, false);
        let block_reason = infer_cli_run_block_reason(
            latest_eval.as_ref(),
            unknown_files,
            integrity_warning.as_deref(),
        );
        let operator_state =
            infer_cli_run_state(status, latest_eval.as_ref(), block_reason.as_str());
        let next_action = infer_cli_next_action(
            false,
            false,
            block_reason.as_str(),
            integrity_warning.as_deref(),
        );
        let handoff_summary =
            infer_cli_handoff_summary(role, operator_state.as_str(), Some(&block_reason));

        runs.push(CliRunSummary {
            run_id: session_id.clone(),
            client: client.clone(),
            cwd: cwd.clone(),
            model: model.clone(),
            started_at_ms: *started_at_ms,
            last_seen_at_ms: *last_seen_at_ms,
            status: status.clone(),
            ended_at_ms: *ended_at_ms,
            role,
            workspace_id,
            workspace_path,
            workspace_state: workspace_state.to_string(),
            origin: "hook-backed",
            operator_state,
            block_reason,
            integrity_warning,
            next_action,
            handoff_summary,
            exact_files,
            inferred_files,
            unknown_files,
            changed_files,
            latest_eval,
        });
    }

    for agent in detected_agents
        .iter()
        .filter(|agent| is_repo_local_agent_cli(agent, repo_root))
        .filter(|agent| !matched_agent_keys.contains(&agent.key))
    {
        let (workspace_id, workspace_path, workspace_detached) =
            workspace_identity_for(agent.cwd.as_deref(), repo_root, worktrees);
        let workspace_state =
            infer_cli_workspace_state(0, None, workspace_detached, false).to_string();
        let integrity_warning = infer_cli_integrity_warning(workspace_detached, false, 0, true);
        let operator_state = if agent.status.eq_ignore_ascii_case("ACTIVE") {
            "executing".to_string()
        } else {
            "observing".to_string()
        };
        let block_reason = infer_cli_run_block_reason(None, 0, integrity_warning.as_deref());
        let role = infer_cli_run_role(&agent.key, &agent.name, &agent.status);
        let next_action = infer_cli_next_action(
            true,
            false,
            block_reason.as_str(),
            integrity_warning.as_deref(),
        );
        let handoff_summary =
            infer_cli_handoff_summary(role, operator_state.as_str(), Some(&block_reason));

        runs.push(CliRunSummary {
            run_id: format!("agent:{}:{}", agent.name.to_ascii_lowercase(), agent.pid),
            client: agent.name.to_ascii_lowercase(),
            cwd: agent.cwd.clone().unwrap_or_else(|| repo_root.to_string()),
            model: String::new(),
            started_at_ms: 0,
            last_seen_at_ms: chrono::Utc::now().timestamp_millis(),
            status: agent.status.to_ascii_lowercase(),
            ended_at_ms: None,
            role,
            workspace_id,
            workspace_path,
            workspace_state,
            origin: "process-scan",
            operator_state,
            block_reason,
            integrity_warning,
            next_action,
            handoff_summary,
            exact_files: 0,
            inferred_files: 0,
            unknown_files: 0,
            changed_files: Vec::new(),
            latest_eval: None,
        });
    }

    if !unknown_rows.is_empty() {
        let (workspace_id, workspace_path, workspace_detached) =
            workspace_identity_for(Some(repo_root), repo_root, worktrees);
        let integrity_warning =
            infer_cli_integrity_warning(workspace_detached, false, unknown_rows.len(), false);
        runs.push(CliRunSummary {
            run_id: "unknown".to_string(),
            client: "unknown".to_string(),
            cwd: repo_root.to_string(),
            model: String::new(),
            started_at_ms: 0,
            last_seen_at_ms: unknown_rows
                .iter()
                .map(|row| row.last_seen_ms)
                .max()
                .unwrap_or(0),
            status: "unknown".to_string(),
            ended_at_ms: None,
            role: "reviewer",
            workspace_id,
            workspace_path,
            workspace_state: infer_cli_workspace_state(
                unknown_rows.len(),
                None,
                workspace_detached,
                false,
            )
            .to_string(),
            origin: "attribution-review",
            operator_state: "attention".to_string(),
            block_reason: "ownership ambiguity".to_string(),
            integrity_warning,
            next_action: "resolve file ownership before continuing".to_string(),
            handoff_summary: Some("handoff reviewer -> fixer".to_string()),
            exact_files: 0,
            inferred_files: 0,
            unknown_files: unknown_rows.len(),
            changed_files: unknown_rows
                .iter()
                .map(|row| row.rel_path.clone())
                .collect::<Vec<_>>(),
            latest_eval: None,
        });
    }

    runs.sort_by(|a, b| {
        b.last_seen_at_ms
            .cmp(&a.last_seen_at_ms)
            .then_with(|| a.run_id.cmp(&b.run_id))
    });
    runs
}

fn infer_cli_run_role(session_id: &str, client: &str, status: &str) -> &'static str {
    let mut haystack = session_id.to_ascii_lowercase();
    haystack.push(' ');
    haystack.push_str(&client.to_ascii_lowercase());
    haystack.push(' ');
    haystack.push_str(&status.to_ascii_lowercase());
    if haystack.contains("plan") {
        "planner"
    } else if haystack.contains("review") || haystack.contains("test") {
        "reviewer"
    } else if haystack.contains("fix") {
        "fixer"
    } else if haystack.contains("release") {
        "release"
    } else {
        "builder"
    }
}

fn infer_cli_run_block_reason(
    latest_eval: Option<&crate::domain::EvalSnapshot>,
    unknown_files: usize,
    integrity_warning: Option<&str>,
) -> String {
    if unknown_files > 0 {
        "ownership ambiguity".to_string()
    } else if integrity_warning.is_some_and(|warning| {
        warning.contains("path missing") || warning.contains("detached HEAD")
    }) {
        "workspace attention".to_string()
    } else if let Some(eval) = latest_eval {
        if eval.hard_gate_blocked {
            "hard gate failure".to_string()
        } else if eval.score_blocked {
            "score threshold failed".to_string()
        } else {
            "ready".to_string()
        }
    } else {
        "eval pending".to_string()
    }
}

fn infer_cli_run_state(
    status: &str,
    latest_eval: Option<&crate::domain::EvalSnapshot>,
    block_reason: &str,
) -> String {
    if block_reason.contains("ambiguity") {
        "attention".to_string()
    } else if block_reason.contains("hard gate") || block_reason.contains("score") {
        "failed".to_string()
    } else if status == "active" {
        "executing".to_string()
    } else if latest_eval.is_some() {
        "evaluating".to_string()
    } else {
        "observing".to_string()
    }
}

fn infer_cli_workspace_state(
    dirty_files: usize,
    latest_eval: Option<&crate::domain::EvalSnapshot>,
    _detached: bool,
    missing_path: bool,
) -> &'static str {
    if missing_path {
        "corrupted"
    } else if dirty_files > 0 {
        "dirty"
    } else if latest_eval.is_some_and(|eval| !eval.hard_gate_blocked && !eval.score_blocked) {
        "validated"
    } else {
        "ready"
    }
}

fn infer_cli_integrity_warning(
    detached: bool,
    missing_path: bool,
    unknown_files: usize,
    synthetic: bool,
) -> Option<String> {
    if missing_path {
        Some("workspace path missing".to_string())
    } else if unknown_files > 0 {
        Some(format!("{unknown_files} file(s) need ownership review"))
    } else if detached {
        Some("workspace is on detached HEAD".to_string())
    } else if synthetic {
        Some("process detected without hook-backed session".to_string())
    } else {
        None
    }
}

fn infer_cli_next_action(
    synthetic: bool,
    unknown_bucket: bool,
    block_reason: &str,
    integrity_warning: Option<&str>,
) -> String {
    if block_reason.contains("hard gate") {
        "fix failing hard gates and rerun fast eval".to_string()
    } else if block_reason.contains("score") {
        "improve fitness score before continuing".to_string()
    } else if unknown_bucket {
        "resolve file ownership before continuing".to_string()
    } else if integrity_warning.is_some_and(|warning| warning.contains("detached HEAD")) {
        "inspect worktree branch/head before continuing".to_string()
    } else if integrity_warning.is_some_and(|warning| warning.contains("path missing")) {
        "repair or recreate the workspace path".to_string()
    } else if synthetic {
        "attach hooks or keep observing unmanaged run".to_string()
    } else {
        "handoff to reviewer or continue execution".to_string()
    }
}

fn infer_cli_handoff_summary(
    role: &'static str,
    operator_state: &str,
    block_reason: Option<&str>,
) -> Option<String> {
    let next_role = if block_reason.is_some_and(|reason| {
        reason.contains("hard gate")
            || reason.contains("score")
            || reason.contains("ownership")
            || reason.contains("attention")
    }) {
        Some("fixer")
    } else if matches!(operator_state, "evaluating" | "ready") {
        Some("reviewer")
    } else if role == "planner" && operator_state == "executing" {
        Some("builder")
    } else {
        None
    }?;

    (next_role != role).then(|| format!("handoff {role} -> {next_role}"))
}

fn load_latest_eval_by_run(
    db: &Db,
    sessions: &[SessionListRow],
) -> Result<BTreeMap<String, crate::domain::EvalSnapshot>> {
    let mut latest_eval_by_run = BTreeMap::new();
    for (session_id, _, _, _, _, _, _, _) in sessions {
        if let Some(eval) = db
            .list_eval_snapshots_for_run(session_id, 1)?
            .into_iter()
            .next()
        {
            latest_eval_by_run.insert(session_id.clone(), eval);
        }
    }
    Ok(latest_eval_by_run)
}

fn load_cli_workspace_summaries(
    repo_root: &str,
    worktrees: &[GitWorktreeRecord],
    detected_agents: &[DetectedAgent],
    runs: &[CliRunSummary],
) -> Vec<CliWorkspaceSummary> {
    let worktrees = if worktrees.is_empty() {
        vec![GitWorktreeRecord {
            path: repo_root.to_string(),
            head: None,
            branch: Some("main".to_string()),
            detached: false,
        }]
    } else {
        worktrees.to_vec()
    };

    worktrees
        .into_iter()
        .map(|record| {
            let workspace_id = workspace_id_for(&record.path, repo_root);
            let attached_runs = runs
                .iter()
                .filter(|run| run.workspace_id == workspace_id)
                .map(|run| run.run_id.clone())
                .collect::<Vec<_>>();
            let attached_agents = detected_agents
                .iter()
                .filter(|agent| is_repo_local_agent_cli(agent, repo_root))
                .filter(|agent| {
                    workspace_identity_for(
                        agent.cwd.as_deref(),
                        repo_root,
                        std::slice::from_ref(&record),
                    )
                    .0 == workspace_id
                })
                .map(|agent| format!("{}#{}", agent.name.to_ascii_lowercase(), agent.pid))
                .collect::<Vec<_>>();
            let dirty_files = runs
                .iter()
                .filter(|run| run.workspace_id == workspace_id)
                .map(|run| run.changed_files.len())
                .sum::<usize>();
            let latest_eval = runs
                .iter()
                .filter(|run| run.workspace_id == workspace_id)
                .filter_map(|run| run.latest_eval.as_ref())
                .max_by_key(|eval| eval.evaluated_at_ms);
            let missing_path = !Path::new(&record.path).exists();
            let mut integrity_warnings = Vec::new();
            if record.detached {
                integrity_warnings.push("workspace is on detached HEAD".to_string());
            }
            if missing_path {
                integrity_warnings.push("workspace path missing".to_string());
            }

            CliWorkspaceSummary {
                id: workspace_id,
                path: record.path,
                branch: record.branch,
                head: record.head,
                detached: record.detached,
                state: infer_cli_workspace_state(
                    dirty_files,
                    latest_eval,
                    record.detached,
                    missing_path,
                )
                .to_string(),
                dirty_files,
                attached_runs,
                attached_agents,
                integrity_warnings: integrity_warnings.clone(),
                recovery_hint: integrity_warnings.first().map(|warning| {
                    if warning.contains("detached HEAD") {
                        "reattach to a branch or validate before continuing".to_string()
                    } else {
                        "repair or recreate the worktree path".to_string()
                    }
                }),
            }
        })
        .collect()
}

fn load_git_worktree_records(repo_root: &str) -> Result<Vec<GitWorktreeRecord>> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .context("run git worktree list")?;
    if !output.status.success() {
        bail!("git worktree list failed");
    }
    Ok(parse_git_worktree_records(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_git_worktree_records(raw: &str) -> Vec<GitWorktreeRecord> {
    let mut records = Vec::new();
    let mut current = GitWorktreeRecord::default();

    for line in raw.lines() {
        if line.trim().is_empty() {
            if !current.path.is_empty() {
                records.push(current);
            }
            current = GitWorktreeRecord::default();
            continue;
        }
        if let Some(value) = line.strip_prefix("worktree ") {
            current.path = value.to_string();
        } else if let Some(value) = line.strip_prefix("HEAD ") {
            current.head = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("branch ") {
            current.branch = Some(
                value
                    .strip_prefix("refs/heads/")
                    .unwrap_or(value)
                    .to_string(),
            );
        } else if line == "detached" {
            current.detached = true;
        }
    }

    if !current.path.is_empty() {
        records.push(current);
    }
    records
}

fn workspace_id_for(path: &str, repo_root: &str) -> String {
    if path == repo_root {
        "main".to_string()
    } else {
        Path::new(path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string())
    }
}

fn workspace_identity_for(
    cwd: Option<&str>,
    repo_root: &str,
    worktrees: &[GitWorktreeRecord],
) -> (String, String, bool) {
    let normalized_repo_root = normalize_match_path(repo_root);
    let Some(cwd) = cwd else {
        return ("main".to_string(), repo_root.to_string(), false);
    };
    let normalized_cwd = normalize_match_path(cwd);
    let matching = worktrees.iter().find(|record| {
        let normalized_path = normalize_match_path(&record.path);
        normalized_path == normalized_cwd || path_contains(&normalized_path, &normalized_cwd)
    });
    if let Some(record) = matching {
        return (
            workspace_id_for(&record.path, repo_root),
            record.path.clone(),
            record.detached,
        );
    }
    if normalized_cwd == normalized_repo_root
        || path_contains(&normalized_repo_root, &normalized_cwd)
    {
        ("main".to_string(), repo_root.to_string(), false)
    } else {
        (
            Path::new(cwd)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "external".to_string()),
            cwd.to_string(),
            false,
        )
    }
}

fn dirty_by_workspace_count(
    workspace_id: &str,
    repo_root: &str,
    workspace_path: &str,
    rows: &[models::FileStateRow],
) -> usize {
    if workspace_id == "main" || workspace_path == repo_root {
        rows.len()
    } else {
        0
    }
}

fn matched_agent_keys_for_sessions(
    sessions: &[SessionListRow],
    detected_agents: &[DetectedAgent],
) -> std::collections::BTreeSet<String> {
    let mut matched = std::collections::BTreeSet::new();
    for (session_id, cwd, _model, _started, _last, client, _status, _ended) in sessions {
        let best = detected_agents
            .iter()
            .filter(|agent| {
                agent.cwd.as_deref().is_some_and(|agent_cwd| {
                    normalize_match_path(agent_cwd) == normalize_match_path(cwd)
                })
            })
            .find(|agent| {
                let client = client.to_ascii_lowercase();
                let vendor = agent.vendor.to_ascii_lowercase();
                let name = agent.name.to_ascii_lowercase();
                let session_id = session_id.to_ascii_lowercase();
                client == name
                    || client == vendor
                    || session_id.contains(&name)
                    || agent.command.to_ascii_lowercase().contains(&session_id)
            });
        if let Some(agent) = best {
            matched.insert(agent.key.clone());
        }
    }
    matched
}

fn normalize_match_path(path: &str) -> String {
    path.trim_end_matches('/').to_string()
}

fn path_contains(base: &str, candidate: &str) -> bool {
    candidate
        .strip_prefix(base)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

fn canonical_repo_identity(path: &str) -> String {
    let normalized = normalize_match_path(path);
    let basename = normalized.rsplit('/').next().unwrap_or(normalized.as_str());

    basename
        .split_once("-broken-")
        .map(|(prefix, _)| prefix)
        .or_else(|| basename.split_once("-remote-").map(|(prefix, _)| prefix))
        .unwrap_or(basename)
        .to_string()
}

fn is_repo_local_agent_cli(agent: &DetectedAgent, repo_root: &str) -> bool {
    agent.cwd.as_deref().is_some_and(|cwd| {
        let repo_root = normalize_match_path(repo_root);
        let cwd = normalize_match_path(cwd);
        cwd == repo_root
            || path_contains(&repo_root, &cwd)
            || canonical_repo_identity(&cwd) == canonical_repo_identity(&repo_root)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{EvalMode, EvalSnapshot};

    #[test]
    fn parse_git_worktree_records_reads_multiple_entries() {
        let records = parse_git_worktree_records(
            "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD def456\nbranch refs/heads/feature/x\n",
        );

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].path, "/repo");
        assert_eq!(records[0].branch.as_deref(), Some("main"));
        assert_eq!(records[1].path, "/repo-wt");
        assert_eq!(records[1].branch.as_deref(), Some("feature/x"));
    }

    #[test]
    fn workspace_id_maps_repo_root_to_main() {
        assert_eq!(workspace_id_for("/repo", "/repo"), "main");
        assert_eq!(workspace_id_for("/repo-worktree", "/repo"), "repo-worktree");
    }

    #[test]
    fn cli_run_state_prefers_failed_over_active() {
        let eval = crate::domain::EvalSnapshot {
            run_id: None,
            mode: crate::domain::EvalMode::Fast,
            overall_score: 62.0,
            hard_gate_blocked: true,
            score_blocked: false,
            dimensions: Vec::new(),
            evidence: Vec::new(),
            recommendations: Vec::new(),
            evaluated_at_ms: 0,
            duration_ms: 0.0,
        };

        assert_eq!(
            infer_cli_run_state("active", Some(&eval), "hard gate failure"),
            "failed"
        );
    }

    #[test]
    fn cli_run_summaries_include_repo_local_process_scan_runs() {
        let runs = build_cli_run_summaries(
            "/repo",
            Vec::new(),
            Vec::new(),
            &[DetectedAgent {
                key: "OpenAI:42".to_string(),
                name: "Codex".to_string(),
                vendor: "OpenAI".to_string(),
                icon: "◈".to_string(),
                pid: 42,
                cwd: Some("/repo".to_string()),
                cpu_percent: 0.0,
                mem_mb: 32.0,
                uptime_seconds: 90,
                status: "IDLE".to_string(),
                confidence: 80,
                project: "repo".to_string(),
                command: "codex --cwd /repo".to_string(),
            }],
            &[GitWorktreeRecord {
                path: "/repo".to_string(),
                head: Some("abc123".to_string()),
                branch: Some("main".to_string()),
                detached: false,
            }],
            &BTreeMap::new(),
        );

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].run_id, "agent:codex:42");
        assert_eq!(runs[0].origin, "process-scan");
        assert_eq!(runs[0].workspace_id, "main");
        assert_eq!(runs[0].workspace_state, "ready");
        assert_eq!(runs[0].operator_state, "observing");
    }

    #[test]
    fn workspace_summaries_count_attached_runs_and_agents() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path().to_string_lossy().to_string();
        let mut evals = BTreeMap::new();
        evals.insert(
            "run-1".to_string(),
            EvalSnapshot {
                run_id: Some(crate::domain::RunId::new("run-1")),
                mode: EvalMode::Fast,
                overall_score: 96.0,
                hard_gate_blocked: false,
                score_blocked: false,
                dimensions: Vec::new(),
                evidence: Vec::new(),
                recommendations: Vec::new(),
                evaluated_at_ms: 100,
                duration_ms: 10.0,
            },
        );
        let runs = build_cli_run_summaries(
            &repo_root,
            vec![(
                "run-1".to_string(),
                repo_root.clone(),
                "gpt-5.4".to_string(),
                10,
                100,
                "codex".to_string(),
                "idle".to_string(),
                None,
            )],
            Vec::new(),
            &[DetectedAgent {
                key: "OpenAI:42".to_string(),
                name: "Codex".to_string(),
                vendor: "OpenAI".to_string(),
                icon: "◈".to_string(),
                pid: 42,
                cwd: Some(repo_root.clone()),
                cpu_percent: 0.0,
                mem_mb: 32.0,
                uptime_seconds: 90,
                status: "IDLE".to_string(),
                confidence: 80,
                project: temp
                    .path()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                command: format!("codex --cwd {repo_root}"),
            }],
            &[GitWorktreeRecord {
                path: repo_root.clone(),
                head: Some("abc123".to_string()),
                branch: Some("main".to_string()),
                detached: false,
            }],
            &evals,
        );
        let workspaces = load_cli_workspace_summaries(
            &repo_root,
            &[GitWorktreeRecord {
                path: repo_root.clone(),
                head: Some("abc123".to_string()),
                branch: Some("main".to_string()),
                detached: false,
            }],
            &[DetectedAgent {
                key: "OpenAI:42".to_string(),
                name: "Codex".to_string(),
                vendor: "OpenAI".to_string(),
                icon: "◈".to_string(),
                pid: 42,
                cwd: Some(repo_root.clone()),
                cpu_percent: 0.0,
                mem_mb: 32.0,
                uptime_seconds: 90,
                status: "IDLE".to_string(),
                confidence: 80,
                project: temp
                    .path()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                command: format!("codex --cwd {repo_root}"),
            }],
            &runs,
        );

        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].id, "main");
        assert_eq!(workspaces[0].state, "validated");
        assert_eq!(workspaces[0].attached_runs, vec!["run-1".to_string()]);
        assert_eq!(workspaces[0].attached_agents, vec!["codex#42".to_string()]);
    }

    #[test]
    fn format_timestamp_ms_marks_zero_as_unknown() {
        assert_eq!(format_timestamp_ms(0), "unknown");
        assert_eq!(format_timestamp_ms(-1), "unknown");
    }

    #[test]
    fn format_timestamp_ms_formats_valid_timestamp() {
        assert_eq!(
            format_timestamp_ms(1_700_000_000_000),
            "2023-11-14T22:13:20+00:00"
        );
    }
}
