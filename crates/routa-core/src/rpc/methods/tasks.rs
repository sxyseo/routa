//! RPC methods for task management.
//!
//! Methods:
//! - `tasks.list`         — list tasks with optional filters
//! - `tasks.get`          — get a single task by id
//! - `tasks.create`       — create a new task
//! - `tasks.delete`       — delete a task
//! - `tasks.updateStatus` — update a task's status
//! - `tasks.findReady`    — find tasks ready for execution
//! - `tasks.listArtifacts` — list artifacts attached to a task
//! - `tasks.provideArtifact` — attach an artifact to a task

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::models::artifact::{Artifact, ArtifactStatus, ArtifactType};
use crate::models::task::{Task, TaskStatus};
use crate::rpc::error::RpcError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// tasks.list
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub status: Option<String>,
    pub assigned_to: Option<String>,
}

fn default_workspace_id() -> String {
    "default".into()
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub tasks: Vec<Task>,
}

pub async fn list(state: &AppState, params: ListParams) -> Result<ListResult, RpcError> {
    let tasks = if let Some(session_id) = &params.session_id {
        // Filter by session_id takes priority
        state.task_store.list_by_session(session_id).await?
    } else if let Some(assignee) = &params.assigned_to {
        state.task_store.list_by_assignee(assignee).await?
    } else if let Some(status_str) = &params.status {
        let status = TaskStatus::from_str(status_str)
            .ok_or_else(|| RpcError::BadRequest(format!("Invalid status: {}", status_str)))?;
        state
            .task_store
            .list_by_status(&params.workspace_id, &status)
            .await?
    } else {
        state
            .task_store
            .list_by_workspace(&params.workspace_id)
            .await?
    };

    Ok(ListResult { tasks })
}

// ---------------------------------------------------------------------------
// tasks.get
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetParams {
    pub id: String,
}

pub async fn get(state: &AppState, params: GetParams) -> Result<Task, RpcError> {
    state
        .task_store
        .get(&params.id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Task {} not found", params.id)))
}

// ---------------------------------------------------------------------------
// tasks.create
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateParams {
    pub title: String,
    pub objective: String,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub scope: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub verification_commands: Option<Vec<String>>,
    pub test_cases: Option<Vec<String>>,
    pub dependencies: Option<Vec<String>>,
    pub parallel_group: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateResult {
    pub task: Task,
}

pub async fn create(state: &AppState, params: CreateParams) -> Result<CreateResult, RpcError> {
    let task = Task::new(
        uuid::Uuid::new_v4().to_string(),
        params.title,
        params.objective,
        params.workspace_id,
        params.session_id,
        params.scope,
        params.acceptance_criteria,
        params.verification_commands,
        params.test_cases,
        params.dependencies,
        params.parallel_group,
    );

    state.task_store.save(&task).await?;
    Ok(CreateResult { task })
}

// ---------------------------------------------------------------------------
// tasks.delete
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteParams {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteResult {
    pub deleted: bool,
}

pub async fn delete(state: &AppState, params: DeleteParams) -> Result<DeleteResult, RpcError> {
    state.task_store.delete(&params.id).await?;
    Ok(DeleteResult { deleted: true })
}

// ---------------------------------------------------------------------------
// tasks.updateStatus
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusParams {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct UpdateStatusResult {
    pub updated: bool,
}

pub async fn update_status(
    state: &AppState,
    params: UpdateStatusParams,
) -> Result<UpdateStatusResult, RpcError> {
    let status = TaskStatus::from_str(&params.status)
        .ok_or_else(|| RpcError::BadRequest(format!("Invalid status: {}", params.status)))?;
    state.task_store.update_status(&params.id, &status).await?;
    Ok(UpdateStatusResult { updated: true })
}

// ---------------------------------------------------------------------------
// tasks.findReady
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindReadyParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
}

pub async fn find_ready(state: &AppState, params: FindReadyParams) -> Result<ListResult, RpcError> {
    let tasks = state
        .task_store
        .find_ready_tasks(&params.workspace_id)
        .await?;
    Ok(ListResult { tasks })
}

// ---------------------------------------------------------------------------
// tasks.listArtifacts
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListArtifactsParams {
    pub task_id: String,
    #[serde(rename = "type")]
    pub artifact_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListArtifactsResult {
    pub artifacts: Vec<Artifact>,
}

pub async fn list_artifacts(
    state: &AppState,
    params: ListArtifactsParams,
) -> Result<ListArtifactsResult, RpcError> {
    let artifacts = if let Some(artifact_type) = params.artifact_type.as_deref() {
        let artifact_type = parse_artifact_type(artifact_type)?;
        state
            .artifact_store
            .list_by_task_and_type(&params.task_id, &artifact_type)
            .await?
    } else {
        state.artifact_store.list_by_task(&params.task_id).await?
    };

    Ok(ListArtifactsResult { artifacts })
}

// ---------------------------------------------------------------------------
// tasks.provideArtifact
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvideArtifactParams {
    pub task_id: String,
    pub agent_id: String,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub content: String,
    pub context: Option<String>,
    pub request_id: Option<String>,
    pub metadata: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct ProvideArtifactResult {
    pub artifact: Artifact,
}

pub async fn provide_artifact(
    state: &AppState,
    params: ProvideArtifactParams,
) -> Result<ProvideArtifactResult, RpcError> {
    let task = state
        .task_store
        .get(&params.task_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Task {} not found", params.task_id)))?;

    let agent_id = params.agent_id.trim();
    if agent_id.is_empty() {
        return Err(RpcError::BadRequest(
            "agentId is required for artifact submission".to_string(),
        ));
    }

    let content = params.content.trim();
    if content.is_empty() {
        return Err(RpcError::BadRequest(
            "artifact content cannot be blank".to_string(),
        ));
    }

    let artifact = Artifact {
        id: uuid::Uuid::new_v4().to_string(),
        artifact_type: parse_artifact_type(&params.artifact_type)?,
        task_id: task.id,
        workspace_id: task.workspace_id,
        provided_by_agent_id: Some(agent_id.to_string()),
        requested_by_agent_id: None,
        request_id: params.request_id,
        content: Some(content.to_string()),
        context: params
            .context
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        status: ArtifactStatus::Provided,
        expires_at: None,
        metadata: params.metadata,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    state.artifact_store.save(&artifact).await?;
    Ok(ProvideArtifactResult { artifact })
}

fn parse_artifact_type(value: &str) -> Result<ArtifactType, RpcError> {
    ArtifactType::from_str(value).ok_or_else(|| {
        RpcError::BadRequest(format!(
            "Invalid artifact type: {}. Expected one of: screenshot, test_results, code_diff, logs",
            value
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AppState, AppStateInner, Database};
    use std::sync::Arc;

    async fn setup_state() -> AppState {
        let db = Database::open_in_memory().expect("in-memory db should open");
        let state: AppState = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("default workspace should exist");
        state
    }

    #[tokio::test]
    async fn provide_and_list_artifacts_roundtrip() {
        let state = setup_state().await;
        let created = create(
            &state,
            CreateParams {
                title: "Artifact task".to_string(),
                objective: "Store screenshot evidence".to_string(),
                workspace_id: "default".to_string(),
                session_id: None,
                scope: None,
                acceptance_criteria: None,
                verification_commands: None,
                test_cases: None,
                dependencies: None,
                parallel_group: None,
            },
        )
        .await
        .expect("task should be created");

        let provided = provide_artifact(
            &state,
            ProvideArtifactParams {
                task_id: created.task.id.clone(),
                agent_id: "agent-1".to_string(),
                artifact_type: "screenshot".to_string(),
                content: "base64-content".to_string(),
                context: Some("Verification screenshot".to_string()),
                request_id: None,
                metadata: None,
            },
        )
        .await
        .expect("artifact should be created");

        assert_eq!(provided.artifact.artifact_type, ArtifactType::Screenshot);
        assert_eq!(
            provided.artifact.provided_by_agent_id.as_deref(),
            Some("agent-1")
        );

        let listed = list_artifacts(
            &state,
            ListArtifactsParams {
                task_id: created.task.id,
                artifact_type: Some("screenshot".to_string()),
            },
        )
        .await
        .expect("artifacts should be listed");

        assert_eq!(listed.artifacts.len(), 1);
        assert_eq!(
            listed.artifacts[0].context.as_deref(),
            Some("Verification screenshot")
        );
    }
}
