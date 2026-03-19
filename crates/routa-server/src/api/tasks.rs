use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use routa_core::events::{AgentEvent, AgentEventType};
use routa_core::kanban::set_task_column;
use routa_core::models::artifact::{Artifact, ArtifactType};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::process::Command;

use crate::application::tasks::{CreateTaskCommand, TaskApplicationService, UpdateTaskCommand};
use crate::error::ServerError;
use crate::models::task::{Task, TaskStatus};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(list_tasks).post(create_task).delete(delete_all_tasks),
        )
        .route(
            "/{id}",
            get(get_task).patch(update_task).delete(delete_task),
        )
        .route(
            "/{id}/artifacts",
            get(list_task_artifacts).post(create_task_artifact),
        )
        .route("/{id}/status", axum::routing::post(update_task_status))
        .route("/ready", get(find_ready_tasks))
}

async fn emit_kanban_workspace_event(
    state: &AppState,
    workspace_id: &str,
    entity: &str,
    action: &str,
    resource_id: Option<&str>,
    source: &str,
) {
    state
        .event_bus
        .emit(AgentEvent {
            event_type: AgentEventType::WorkspaceUpdated,
            agent_id: format!("kanban-{}", source),
            workspace_id: workspace_id.to_string(),
            data: serde_json::json!({
                "scope": "kanban",
                "entity": entity,
                "action": action,
                "resourceId": resource_id,
                "source": source,
            }),
            timestamp: Utc::now(),
        })
        .await;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskArtifactRequest {
    agent_id: Option<String>,
    #[serde(rename = "type")]
    artifact_type: Option<String>,
    content: Option<String>,
    context: Option<String>,
    request_id: Option<String>,
    metadata: Option<BTreeMap<String, String>>,
}

async fn list_task_artifacts(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;

    let artifacts = state.artifact_store.list_by_task(&task.id).await?;

    Ok(Json(serde_json::json!({
        "artifacts": artifacts,
    })))
}

async fn create_task_artifact(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<CreateTaskArtifactRequest>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;

    let artifact_type = body
        .artifact_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("A valid artifact type is required".to_string()))?;
    let artifact_type = ArtifactType::from_str(artifact_type)
        .ok_or_else(|| ServerError::BadRequest("A valid artifact type is required".to_string()))?;

    let agent_id = body
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ServerError::BadRequest("agentId is required for agent artifact submission".to_string())
        })?;

    let content = body
        .content
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Artifact content is required".to_string()))?;

    let now = Utc::now();
    let artifact = Artifact {
        id: uuid::Uuid::new_v4().to_string(),
        artifact_type,
        task_id: task.id.clone(),
        workspace_id: task.workspace_id.clone(),
        provided_by_agent_id: Some(agent_id.to_string()),
        requested_by_agent_id: None,
        request_id: body
            .request_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        content: Some(content.to_string()),
        context: body
            .context
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        status: routa_core::models::artifact::ArtifactStatus::Provided,
        expires_at: None,
        metadata: body.metadata,
        created_at: now,
        updated_at: now,
    };
    state.artifact_store.save(&artifact).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "updated",
        Some(&task.id),
        "agent",
    )
    .await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "artifact": artifact })),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListTasksQuery {
    workspace_id: Option<String>,
    session_id: Option<String>,
    status: Option<String>,
    assigned_to: Option<String>,
}

async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");

    let tasks = if let Some(session_id) = &query.session_id {
        // Filter by session_id takes priority
        state.task_store.list_by_session(session_id).await?
    } else if let Some(assignee) = &query.assigned_to {
        state.task_store.list_by_assignee(assignee).await?
    } else if let Some(status_str) = &query.status {
        let status = TaskStatus::from_str(status_str)
            .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {}", status_str)))?;
        state
            .task_store
            .list_by_status(workspace_id, &status)
            .await?
    } else {
        state.task_store.list_by_workspace(workspace_id).await?
    };

    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

async fn get_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;

    Ok(Json(serde_json::json!({ "task": task })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskRequest {
    title: String,
    objective: String,
    workspace_id: Option<String>,
    session_id: Option<String>,
    scope: Option<String>,
    acceptance_criteria: Option<Vec<String>>,
    verification_commands: Option<Vec<String>>,
    test_cases: Option<Vec<String>>,
    dependencies: Option<Vec<String>>,
    parallel_group: Option<String>,
    board_id: Option<String>,
    column_id: Option<String>,
    position: Option<i64>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
    assignee: Option<String>,
    assigned_provider: Option<String>,
    assigned_role: Option<String>,
    assigned_specialist_id: Option<String>,
    assigned_specialist_name: Option<String>,
    create_github_issue: Option<bool>,
    repo_path: Option<String>,
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<CreateTaskRequest>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let service = TaskApplicationService::new(state.clone());
    let plan = service.create_task(create_task_command(body)).await?;
    let mut task = plan.task;
    let codebase = resolve_codebase(&state, &task.workspace_id, plan.repo_path.as_deref()).await?;

    if plan.create_github_issue {
        match resolve_github_repo(codebase.as_ref().map(|item| item.repo_path.as_str())) {
            Some(repo) => match create_github_issue(
                &repo,
                &task.title,
                Some(&build_task_issue_body(
                    &task.objective,
                    task.test_cases.as_ref(),
                )),
                &task.labels,
                task.assignee.as_deref(),
            )
            .await
            {
                Ok(issue) => {
                    task.github_id = Some(issue.id);
                    task.github_number = Some(issue.number);
                    task.github_url = Some(issue.url);
                    task.github_repo = Some(issue.repo);
                    task.github_state = Some(issue.state);
                    task.github_synced_at = Some(Utc::now());
                    task.last_sync_error = None;
                }
                Err(error) => {
                    task.last_sync_error = Some(error);
                }
            },
            None => {
                task.last_sync_error =
                    Some("Selected codebase is not linked to a GitHub repository.".to_string());
            }
        }
    }

    state.task_store.save(&task).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "created",
        Some(&task.id),
        "user",
    )
    .await;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "task": task })),
    ))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UpdateTaskRequest {
    title: Option<String>,
    objective: Option<String>,
    scope: Option<String>,
    acceptance_criteria: Option<Vec<String>>,
    verification_commands: Option<Vec<String>>,
    test_cases: Option<Vec<String>>,
    assigned_to: Option<String>,
    status: Option<String>,
    board_id: Option<String>,
    column_id: Option<String>,
    position: Option<i64>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
    assignee: Option<String>,
    assigned_provider: Option<String>,
    assigned_role: Option<String>,
    assigned_specialist_id: Option<String>,
    assigned_specialist_name: Option<String>,
    trigger_session_id: Option<String>,
    github_id: Option<String>,
    github_number: Option<i64>,
    github_url: Option<String>,
    github_repo: Option<String>,
    github_state: Option<String>,
    last_sync_error: Option<String>,
    dependencies: Option<Vec<String>>,
    parallel_group: Option<String>,
    completion_summary: Option<String>,
    verification_report: Option<String>,
    sync_to_github: Option<bool>,
    retry_trigger: Option<bool>,
    repo_path: Option<String>,
    codebase_ids: Option<Vec<String>>,
    worktree_id: Option<serde_json::Value>,
}

fn create_task_command(body: CreateTaskRequest) -> CreateTaskCommand {
    CreateTaskCommand {
        title: body.title,
        objective: body.objective,
        workspace_id: body.workspace_id,
        session_id: body.session_id,
        scope: body.scope,
        acceptance_criteria: body.acceptance_criteria,
        verification_commands: body.verification_commands,
        test_cases: body.test_cases,
        dependencies: body.dependencies,
        parallel_group: body.parallel_group,
        board_id: body.board_id,
        column_id: body.column_id,
        position: body.position,
        priority: body.priority,
        labels: body.labels,
        assignee: body.assignee,
        assigned_provider: body.assigned_provider,
        assigned_role: body.assigned_role,
        assigned_specialist_id: body.assigned_specialist_id,
        assigned_specialist_name: body.assigned_specialist_name,
        create_github_issue: body.create_github_issue,
        repo_path: body.repo_path,
    }
}

fn update_task_command(body: UpdateTaskRequest) -> UpdateTaskCommand {
    UpdateTaskCommand {
        title: body.title,
        objective: body.objective,
        scope: body.scope,
        acceptance_criteria: body.acceptance_criteria,
        verification_commands: body.verification_commands,
        test_cases: body.test_cases,
        assigned_to: body.assigned_to,
        status: body.status,
        board_id: body.board_id,
        column_id: body.column_id,
        position: body.position,
        priority: body.priority,
        labels: body.labels,
        assignee: body.assignee,
        assigned_provider: body.assigned_provider,
        assigned_role: body.assigned_role,
        assigned_specialist_id: body.assigned_specialist_id,
        assigned_specialist_name: body.assigned_specialist_name,
        trigger_session_id: body.trigger_session_id,
        github_id: body.github_id,
        github_number: body.github_number,
        github_url: body.github_url,
        github_repo: body.github_repo,
        github_state: body.github_state,
        last_sync_error: body.last_sync_error,
        dependencies: body.dependencies,
        parallel_group: body.parallel_group,
        completion_summary: body.completion_summary,
        verification_report: body.verification_report,
        sync_to_github: body.sync_to_github,
        retry_trigger: body.retry_trigger,
        repo_path: body.repo_path,
        codebase_ids: body.codebase_ids,
        worktree_id: body.worktree_id,
    }
}

async fn update_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateTaskRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    ensure_transition_artifacts(&state, &id, &body).await?;
    let service = TaskApplicationService::new(state.clone());
    let plan = service.update_task(&id, update_task_command(body)).await?;
    let mut task = plan.task;

    if plan.should_sync_github {
        if let (Some(repo), Some(issue_number)) = (task.github_repo.clone(), task.github_number) {
            match update_github_issue(
                &repo,
                issue_number,
                &task.title,
                Some(&build_task_issue_body(
                    &task.objective,
                    task.test_cases.as_ref(),
                )),
                &task.labels,
                if task.status == TaskStatus::Completed {
                    "closed"
                } else {
                    "open"
                },
                task.assignee.as_deref(),
            )
            .await
            {
                Ok(()) => {
                    task.github_state = Some(if task.status == TaskStatus::Completed {
                        "closed".to_string()
                    } else {
                        "open".to_string()
                    });
                    task.github_synced_at = Some(Utc::now());
                    task.last_sync_error = None;
                }
                Err(error) => {
                    task.last_sync_error = Some(error);
                }
            }
        }
    }

    if plan.should_trigger_agent {
        let codebase = if plan.repo_path.is_some() {
            resolve_codebase(&state, &task.workspace_id, plan.repo_path.as_deref()).await?
        } else if let Some(first_id) = task.codebase_ids.first() {
            state.codebase_store.get(first_id).await.ok().flatten()
        } else {
            resolve_codebase(&state, &task.workspace_id, None).await?
        };

        // Auto-create worktree when entering dev column (mirrors Next.js behavior)
        if plan.entering_dev {
            if let (Some(ref cb), None) = (&codebase, &task.worktree_id) {
                match auto_create_worktree(&state, &task, cb).await {
                    Ok(worktree_id) => {
                        task.worktree_id = Some(worktree_id);
                    }
                    Err(err) => {
                        set_task_column(&mut task, "blocked");
                        task.last_sync_error = Some(format!("Worktree creation failed: {}", err));
                        state.task_store.save(&task).await?;
                        emit_kanban_workspace_event(
                            &state,
                            &task.workspace_id,
                            "task",
                            "updated",
                            Some(&task.id),
                            "system",
                        )
                        .await;
                        return Ok(Json(serde_json::json!({ "task": task })));
                    }
                }
            }
        }

        let trigger_result = trigger_assigned_task_agent(
            &state,
            &task,
            codebase.as_ref().map(|item| item.repo_path.as_str()),
            codebase.as_ref().and_then(|item| item.branch.as_deref()),
        )
        .await;

        match trigger_result {
            Ok(session_id) => {
                task.trigger_session_id = Some(session_id);
                task.last_sync_error = None;
            }
            Err(error) => {
                task.last_sync_error = Some(error);
            }
        }
    }

    state.task_store.save(&task).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "updated",
        Some(&task.id),
        "user",
    )
    .await;
    Ok(Json(serde_json::json!({ "task": task })))
}

async fn ensure_transition_artifacts(
    state: &AppState,
    task_id: &str,
    body: &UpdateTaskRequest,
) -> Result<(), ServerError> {
    let Some(target_column_id) = body.column_id.as_deref() else {
        return Ok(());
    };
    let existing = state
        .task_store
        .get(task_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", task_id)))?;
    if existing.column_id.as_deref() == Some(target_column_id) {
        return Ok(());
    }

    let Some(board_id) = body.board_id.as_deref().or(existing.board_id.as_deref()) else {
        return Ok(());
    };
    let Some(board) = state.kanban_store.get(board_id).await? else {
        return Ok(());
    };
    let Some(target_column) = board.columns.iter().find(|column| column.id == target_column_id) else {
        return Ok(());
    };
    let Some(required_artifacts) = target_column
        .automation
        .as_ref()
        .and_then(|automation| automation.required_artifacts.as_ref())
    else {
        return Ok(());
    };

    let mut missing_artifacts = Vec::new();
    for artifact_name in required_artifacts {
        let artifact_type = ArtifactType::from_str(artifact_name).ok_or_else(|| {
            ServerError::BadRequest(format!(
                "Invalid required artifact type configured on column {}: {}",
                target_column.id, artifact_name
            ))
        })?;
        let artifacts = state
            .artifact_store
            .list_by_task_and_type(task_id, &artifact_type)
            .await?;
        if artifacts.is_empty() {
            missing_artifacts.push(artifact_name.clone());
        }
    }

    if missing_artifacts.is_empty() {
        return Ok(());
    }

    Err(ServerError::BadRequest(format!(
        "Cannot move task to \"{}\": missing required artifacts: {}. Please provide these artifacts before moving the task.",
        target_column.name,
        missing_artifacts.join(", ")
    )))
}

async fn delete_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;
    state.task_store.delete(&id).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "deleted",
        Some(&id),
        "user",
    )
    .await;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(Debug, Deserialize)]
struct UpdateStatusRequest {
    status: String,
}

async fn update_task_status(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateStatusRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let status = TaskStatus::from_str(&body.status)
        .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {}", body.status)))?;
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {} not found", id)))?;
    state.task_store.update_status(&id, &status).await?;
    emit_kanban_workspace_event(
        &state,
        &task.workspace_id,
        "task",
        "updated",
        Some(&id),
        "user",
    )
    .await;
    Ok(Json(serde_json::json!({ "updated": true })))
}

async fn find_ready_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");
    let tasks = state.task_store.find_ready_tasks(workspace_id).await?;
    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

/// DELETE /api/tasks — Bulk delete all tasks for a workspace
async fn delete_all_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    let count = tasks.len();
    for task in &tasks {
        state.task_store.delete(&task.id).await?;
    }
    if count > 0 {
        emit_kanban_workspace_event(&state, workspace_id, "task", "deleted", None, "user").await;
    }
    Ok(Json(serde_json::json!({ "deleted": count })))
}

#[derive(Clone)]
struct GitHubIssueRef {
    id: String,
    number: i64,
    url: String,
    state: String,
    repo: String,
}

async fn resolve_codebase(
    state: &AppState,
    workspace_id: &str,
    repo_path: Option<&str>,
) -> Result<Option<crate::models::codebase::Codebase>, ServerError> {
    if let Some(path) = repo_path {
        state
            .codebase_store
            .find_by_repo_path(workspace_id, path)
            .await
    } else {
        state.codebase_store.get_default(workspace_id).await
    }
}

async fn auto_create_worktree(
    state: &AppState,
    task: &crate::models::task::Task,
    codebase: &crate::models::codebase::Codebase,
) -> Result<String, String> {
    let slugified = task
        .title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let short_id = &task.id[..task.id.len().min(8)];
    let slug = format!("{}-{}", short_id, &slugified[..slugified.len().min(40)]);
    let branch = format!("issue/{}", slug);

    let workspace = state
        .workspace_store
        .get(&task.workspace_id)
        .await
        .ok()
        .flatten();
    let worktree_root = workspace
        .as_ref()
        .and_then(|ws| ws.metadata.get("worktreeRoot"))
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| crate::git::get_default_workspace_worktree_root(&task.workspace_id));

    let codebase_label = codebase
        .label
        .as_ref()
        .map(|l| crate::git::branch_to_safe_dir_name(l))
        .unwrap_or_else(|| crate::git::branch_to_safe_dir_name(&codebase.id));

    let worktree_path = worktree_root
        .join(&codebase_label)
        .join(crate::git::branch_to_safe_dir_name(&slug));

    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create worktree parent dir: {}", e))?;
    }

    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    let base_branch = codebase
        .branch
        .clone()
        .unwrap_or_else(|| "main".to_string());

    let worktree = crate::models::worktree::Worktree::new(
        uuid::Uuid::new_v4().to_string(),
        codebase.id.clone(),
        task.workspace_id.clone(),
        worktree_path_str.clone(),
        branch.clone(),
        base_branch.clone(),
        Some(slug),
    );
    state
        .worktree_store
        .save(&worktree)
        .await
        .map_err(|e| format!("Failed to save worktree: {}", e))?;

    let _ = crate::git::worktree_prune(&codebase.repo_path);
    crate::git::worktree_add(
        &codebase.repo_path,
        &worktree_path_str,
        &branch,
        &base_branch,
        false,
    )
    .map_err(|e| format!("git worktree add failed: {}", e))?;

    Ok(worktree.id)
}

fn resolve_github_repo(repo_path: Option<&str>) -> Option<String> {
    let repo_path = repo_path?;
    let output = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(repo_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = crate::git::parse_github_url(&remote)?;
    Some(format!("{}/{}", parsed.owner, parsed.repo))
}

fn github_token() -> Option<String> {
    std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var("GH_TOKEN")
                .ok()
                .filter(|value| !value.is_empty())
        })
}

async fn create_github_issue(
    repo: &str,
    title: &str,
    body: Option<&str>,
    labels: &[String],
    assignee: Option<&str>,
) -> Result<GitHubIssueRef, String> {
    let token = github_token().ok_or_else(|| "GITHUB_TOKEN is not configured.".to_string())?;
    let client = reqwest::Client::new();
    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
        "labels": labels,
    });

    if let Some(assignee) = assignee {
        payload["assignees"] = serde_json::json!([assignee]);
    }

    let response = client
        .post(format!("https://api.github.com/repos/{}/issues", repo))
        .header(AUTHORIZATION, format!("token {}", token))
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "routa-rust-kanban")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("GitHub issue create failed: {}", error))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub issue create failed: {} {}", status, text));
    }

    let data = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("GitHub issue create failed: {}", error))?;

    Ok(GitHubIssueRef {
        id: data
            .get("id")
            .and_then(|value| value.as_i64())
            .unwrap_or_default()
            .to_string(),
        number: data
            .get("number")
            .and_then(|value| value.as_i64())
            .unwrap_or_default(),
        url: data
            .get("html_url")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        state: data
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("open")
            .to_string(),
        repo: repo.to_string(),
    })
}

async fn update_github_issue(
    repo: &str,
    issue_number: i64,
    title: &str,
    body: Option<&str>,
    labels: &[String],
    state: &str,
    assignee: Option<&str>,
) -> Result<(), String> {
    let token = github_token().ok_or_else(|| "GITHUB_TOKEN is not configured.".to_string())?;
    let client = reqwest::Client::new();
    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
        "labels": labels,
        "state": state,
    });

    if let Some(assignee) = assignee {
        payload["assignees"] = serde_json::json!([assignee]);
    }

    let response = client
        .patch(format!(
            "https://api.github.com/repos/{}/issues/{}",
            repo, issue_number
        ))
        .header(AUTHORIZATION, format!("token {}", token))
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "routa-rust-kanban")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("GitHub issue update failed: {}", error))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        Err(format!("GitHub issue update failed: {} {}", status, text))
    }
}

fn build_task_issue_body(objective: &str, test_cases: Option<&Vec<String>>) -> String {
    let normalized_test_cases: Vec<&str> = test_cases
        .into_iter()
        .flatten()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect();

    if normalized_test_cases.is_empty() {
        return objective.trim().to_string();
    }

    let mut sections = Vec::new();
    if !objective.trim().is_empty() {
        sections.push(objective.trim().to_string());
    }
    sections.push(format!(
        "## Test Cases\n{}",
        normalized_test_cases
            .into_iter()
            .map(|value| format!("- {}", value))
            .collect::<Vec<_>>()
            .join("\n")
    ));
    sections.join("\n\n")
}

fn build_task_prompt(task: &Task) -> String {
    let labels = if task.labels.is_empty() {
        "Labels: none".to_string()
    } else {
        format!("Labels: {}", task.labels.join(", "))
    };
    let mut sections = vec![
        format!("You are assigned to Kanban task: {}", task.title),
        String::new(),
        "## Context".to_string(),
        String::new(),
        "**IMPORTANT**: You are working in Kanban context. Use MCP tools (update_card, move_card, etc.) to manage this card.".to_string(),
        "Do NOT use `gh issue create` or other GitHub CLI commands — those are for GitHub issue context only.".to_string(),
        String::new(),
        "## Task Details".to_string(),
        String::new(),
        format!("**Card ID:** {}", task.id),
        format!(
            "**Priority:** {}",
            task.priority.as_ref().map(|value| value.as_str()).unwrap_or("medium")
        ),
        labels,
        task.github_url
            .as_ref()
            .map(|url| format!("**GitHub Issue:** {}", url))
            .unwrap_or_else(|| "**GitHub Issue:** local-only".to_string()),
        String::new(),
        "## Objective".to_string(),
        String::new(),
        task.objective.clone(),
        String::new(),
    ];

    if let Some(test_cases) = task.test_cases.as_ref().filter(|value| !value.is_empty()) {
        sections.push("## Test Cases".to_string());
        sections.push(String::new());
        sections.push(
            test_cases
                .iter()
                .map(|value| format!("- {}", value))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        sections.push(String::new());
    }

    sections.extend([
        "## Available MCP Tools".to_string(),
        String::new(),
        "You have access to the following MCP tools for task management:".to_string(),
        String::new(),
        format!("- **update_card**: Update this card's title, description, priority, or labels. Use cardId: \"{}\"", task.id),
        "- **move_card**: Move this card to a different column (e.g., 'in-progress', 'done')".to_string(),
        "- **report_to_parent**: Report completion status to the parent agent when done".to_string(),
        "- **create_note**: Create notes for documentation or progress tracking".to_string(),
        String::new(),
        "## Instructions".to_string(),
        String::new(),
        "1. Start implementation work immediately".to_string(),
        "2. Use `update_card` to track progress in the card description".to_string(),
        "3. Use `move_card` to move the card to 'in-progress' when starting".to_string(),
        "4. Keep changes focused on this task".to_string(),
        "5. When complete, use `move_card` to move to 'done' and `report_to_parent` to report completion".to_string(),
    ]);

    sections.join("\n")
}

async fn trigger_assigned_task_agent(
    state: &AppState,
    task: &Task,
    cwd: Option<&str>,
    branch: Option<&str>,
) -> Result<String, String> {
    let provider = task
        .assigned_provider
        .clone()
        .unwrap_or_else(|| "opencode".to_string());
    let role = task
        .assigned_role
        .clone()
        .unwrap_or_else(|| "CRAFTER".to_string())
        .to_uppercase();
    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = cwd
        .map(|value| value.to_string())
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| ".".to_string());

    state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            task.workspace_id.clone(),
            Some(provider.clone()),
            Some(role.clone()),
            None,
            None,
        )
        .await
        .map_err(|error| format!("Failed to create ACP session: {}", error))?;

    state
        .acp_session_store
        .create(
            &session_id,
            &cwd,
            &task.workspace_id,
            Some(provider.as_str()),
            Some(role.as_str()),
            None,
        )
        .await
        .map_err(|error| format!("Failed to persist ACP session: {}", error))?;

    let prompt = build_task_prompt(task);
    let state_clone = state.clone();
    let session_id_clone = session_id.clone();
    let task_workspace = task.workspace_id.clone();
    let provider_clone = provider.clone();
    let cwd_clone = cwd.clone();
    let _branch = branch.map(|value| value.to_string());

    tokio::spawn(async move {
        if let Err(error) = state_clone
            .acp_manager
            .prompt(&session_id_clone, &prompt)
            .await
        {
            tracing::error!(
                "[kanban] Failed to auto-prompt ACP task session {} in workspace {} with provider {} at {}: {}",
                session_id_clone,
                task_workspace,
                provider_clone,
                cwd_clone,
                error
            );
            return;
        }

        let _ = state_clone
            .acp_session_store
            .set_first_prompt_sent(&session_id_clone)
            .await;
        if let Some(history) = state_clone
            .acp_manager
            .get_session_history(&session_id_clone)
            .await
        {
            let _ = state_clone
                .acp_session_store
                .save_history(&session_id_clone, &history)
                .await;
        }
    });

    Ok(session_id)
}
