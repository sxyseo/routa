//! GitLab Virtual Workspace API - /api/gitlab
//!
//! Provides in-memory virtual file system for GitLab repos.
//! Mirrors the GitHub REST surface for desktop mode with GitLab v4 API endpoints.
//!
//! GET    /api/gitlab                - List active imported GitLab workspaces
//! POST   /api/gitlab/import         - Import a GitLab repo as a virtual workspace
//! GET    /api/gitlab/tree           - Get file tree for an imported repo
//! GET    /api/gitlab/file           - Read a file from an imported repo
//! GET    /api/gitlab/search         - Search files in an imported repo
//! GET    /api/gitlab/access         - Check GitLab token access status
//! GET    /api/gitlab/issues         - List GitLab issues for a project
//! GET    /api/gitlab/merge-requests - List GitLab merge requests for a project
//! POST   /api/gitlab/mr-note       - Post a note on a merge request

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::api::tasks_gitlab::{
    gitlab_access_status, list_gitlab_issues, list_gitlab_merge_requests,
    resolve_gitlab_project_for_codebase,
};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_workspaces))
        .route("/access", get(gitlab_access))
        .route("/import", post(import_repo))
        .route("/issues", get(list_issues))
        .route("/merge-requests", get(list_merge_requests))
        .route("/tree", get(get_tree))
        .route("/file", get(get_file))
        .route("/search", get(search_files))
        .route("/mr-note", post(post_mr_note))
}

// ─── List workspaces ─────────────────────────────────────────────────────────

async fn list_workspaces() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "workspaces": [] }))
}

async fn load_board_token(
    state: &AppState,
    board_id: Option<&str>,
) -> Result<Option<String>, ServerError> {
    let Some(board_id) = board_id.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };

    Ok(state
        .kanban_store
        .get(board_id)
        .await?
        .and_then(|board| board.github_token))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessQuery {
    board_id: Option<String>,
}

async fn gitlab_access(
    State(state): State<AppState>,
    Query(q): Query<AccessQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let board_token = load_board_token(&state, q.board_id.as_deref()).await?;
    let (source, available) = gitlab_access_status(board_token.as_deref());
    Ok(Json(serde_json::json!({
        "available": available,
        "source": source,
    })))
}

// ─── Import ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ImportRequest {
    project: Option<String>,
    #[serde(rename = "ref")]
    git_ref: Option<String>,
    url: Option<String>,
}

async fn import_repo(Json(body): Json<ImportRequest>) -> Json<serde_json::Value> {
    let project = if let Some(project) = &body.project {
        project.clone()
    } else if let Some(url) = &body.url {
        match crate::api::tasks_gitlab::parse_gitlab_project(url) {
            Some(p) => p,
            None => {
                return Json(serde_json::json!({
                    "error": "Invalid GitLab URL. Expected: https://gitlab.com/group/project or group/project",
                    "code": "BAD_REQUEST"
                }));
            }
        }
    } else {
        return Json(serde_json::json!({
            "error": "Missing 'project' field (or provide 'url')",
            "code": "BAD_REQUEST"
        }));
    };

    let git_ref = body.git_ref.as_deref().unwrap_or("HEAD");

    Json(serde_json::json!({
        "error": "GitLab virtual workspace import is not available in desktop mode. Use POST /api/clone to work with local repositories.",
        "code": "NOT_IMPLEMENTED",
        "hint": {
            "project": project,
            "ref": git_ref,
            "alternative": "/api/clone"
        }
    }))
}

// ─── Shared query params ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ProjectQuery {
    project: Option<String>,
    #[serde(rename = "ref")]
    git_ref: Option<String>,
}

fn not_imported(project: &str) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "error": format!(
            "Workspace not imported. POST /api/gitlab/import first for {project}"
        ),
        "code": "NOT_FOUND"
    }))
}

// ─── Tree ────────────────────────────────────────────────────────────────────

async fn get_tree(Query(q): Query<ProjectQuery>) -> Json<serde_json::Value> {
    let project = q.project.as_deref().unwrap_or("");
    if project.is_empty() {
        return Json(serde_json::json!({
            "error": "Missing 'project' query parameter",
            "code": "BAD_REQUEST"
        }));
    }
    not_imported(project)
}

// ─── File ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FileQuery {
    project: Option<String>,
    path: Option<String>,
    #[serde(rename = "ref")]
    _git_ref: Option<String>,
}

async fn get_file(Query(q): Query<FileQuery>) -> Json<serde_json::Value> {
    let project = q.project.as_deref().unwrap_or("");
    if project.is_empty() || q.path.is_none() {
        return Json(serde_json::json!({
            "error": "Missing 'project' or 'path' query parameters",
            "code": "BAD_REQUEST"
        }));
    }
    not_imported(project)
}

// ─── Search ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SearchQuery {
    project: Option<String>,
    q: Option<String>,
    #[serde(rename = "ref")]
    _git_ref: Option<String>,
    limit: Option<usize>,
}

async fn search_files(Query(q): Query<SearchQuery>) -> Json<serde_json::Value> {
    let project = q.project.as_deref().unwrap_or("");
    if project.is_empty() {
        return Json(serde_json::json!({
            "error": "Missing 'project' query parameter",
            "code": "BAD_REQUEST"
        }));
    }
    Json(serde_json::json!({
        "files": [],
        "total": 0,
        "query": q.q.as_deref().unwrap_or(""),
        "note": "GitLab virtual workspaces are not available in desktop mode."
    }))
}

// ─── Issues ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    board_id: Option<String>,
    state: Option<String>,
}

async fn list_issues(
    State(state): State<AppState>,
    Query(q): Query<IssueQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = q
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?;

    // Map "open"/"closed"/"all" to GitLab equivalents "opened"/"closed"/"all"
    let state_filter = match q.state.as_deref().unwrap_or("open") {
        "open" | "opened" => "opened",
        "closed" => "closed",
        "all" => "all",
        _ => {
            return Err(ServerError::BadRequest(
                "state must be one of: open, closed, all".to_string(),
            ))
        }
    };

    let workspace_codebases = state.codebase_store.list_by_workspace(workspace_id).await?;
    if workspace_codebases.is_empty() {
        return Err(ServerError::NotFound(
            "No codebases linked to this workspace".to_string(),
        ));
    }

    let codebase = match q.codebase_id.as_deref() {
        Some(codebase_id) => workspace_codebases
            .iter()
            .find(|item| item.id == codebase_id)
            .cloned(),
        None => workspace_codebases
            .iter()
            .find(|item| item.is_default)
            .cloned()
            .or_else(|| workspace_codebases.first().cloned()),
    }
    .ok_or_else(|| ServerError::NotFound("Codebase not found in this workspace".to_string()))?;

    let project = resolve_gitlab_project_for_codebase(
        codebase.source_url.as_deref(),
        Some(codebase.repo_path.as_str()),
    )
    .ok_or_else(|| {
        ServerError::BadRequest(
            "Selected codebase is not linked to a GitLab repository.".to_string(),
        )
    })?;

    let board_token = load_board_token(&state, q.board_id.as_deref()).await?;

    let issues = list_gitlab_issues(&project, Some(state_filter), Some(50), board_token.as_deref())
        .await
        .map_err(ServerError::Internal)?;

    Ok(Json(serde_json::json!({
        "project": project,
        "codebase": {
            "id": codebase.id,
            "label": codebase.label.clone().unwrap_or_else(|| {
                std::path::Path::new(&codebase.repo_path)
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or(&codebase.repo_path)
                    .to_string()
            }),
        },
        "issues": issues,
    })))
}

// ─── Merge Requests ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeRequestQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    board_id: Option<String>,
    state: Option<String>,
}

async fn list_merge_requests(
    State(state): State<AppState>,
    Query(q): Query<MergeRequestQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = q
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?;

    let state_filter = match q.state.as_deref().unwrap_or("open") {
        "open" | "opened" => "opened",
        "closed" => "closed",
        "merged" => "merged",
        "all" => "all",
        _ => {
            return Err(ServerError::BadRequest(
                "state must be one of: open, closed, merged, all".to_string(),
            ))
        }
    };

    let workspace_codebases = state.codebase_store.list_by_workspace(workspace_id).await?;
    if workspace_codebases.is_empty() {
        return Err(ServerError::NotFound(
            "No codebases linked to this workspace".to_string(),
        ));
    }

    let codebase = match q.codebase_id.as_deref() {
        Some(codebase_id) => workspace_codebases
            .iter()
            .find(|item| item.id == codebase_id)
            .cloned(),
        None => workspace_codebases
            .iter()
            .find(|item| item.is_default)
            .cloned()
            .or_else(|| workspace_codebases.first().cloned()),
    }
    .ok_or_else(|| ServerError::NotFound("Codebase not found in this workspace".to_string()))?;

    let project = resolve_gitlab_project_for_codebase(
        codebase.source_url.as_deref(),
        Some(codebase.repo_path.as_str()),
    )
    .ok_or_else(|| {
        ServerError::BadRequest(
            "Selected codebase is not linked to a GitLab repository.".to_string(),
        )
    })?;

    let board_token = load_board_token(&state, q.board_id.as_deref()).await?;

    let merge_requests = list_gitlab_merge_requests(
        &project,
        Some(state_filter),
        Some(50),
        board_token.as_deref(),
    )
    .await
    .map_err(ServerError::Internal)?;

    Ok(Json(serde_json::json!({
        "project": project,
        "codebase": {
            "id": codebase.id,
            "label": codebase.label.clone().unwrap_or_else(|| {
                std::path::Path::new(&codebase.repo_path)
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or(&codebase.repo_path)
                    .to_string()
            }),
        },
        "mergeRequests": merge_requests,
    })))
}

// ─── MR Note ─────────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct MrNoteRequest {
    project: Option<String>,
    #[serde(rename = "mrIid")]
    mr_iid: Option<i64>,
    body: Option<String>,
}

/// POST /api/gitlab/mr-note — Post a note on a GitLab merge request
async fn post_mr_note(Json(body): Json<MrNoteRequest>) -> Json<serde_json::Value> {
    let project = body.project.as_deref().unwrap_or("");
    let mr_iid = body.mr_iid.unwrap_or(0);

    if project.is_empty() || mr_iid == 0 || body.body.is_none() {
        return Json(serde_json::json!({
            "error": "Missing required fields: project, mrIid, body",
            "code": "BAD_REQUEST"
        }));
    }

    Json(serde_json::json!({
        "error": "GitLab MR notes are not available in desktop mode. Configure GITLAB_TOKEN and use the web backend.",
        "code": "NOT_IMPLEMENTED",
        "hint": {
            "project": project,
            "mrIid": mr_iid,
        }
    }))
}
