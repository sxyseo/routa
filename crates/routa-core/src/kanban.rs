use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::error::ServerError;
use crate::models::kanban::{column_id_to_task_status, task_status_to_column_id};
use crate::models::task::Task;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCard {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub column_id: String,
    pub position: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    pub labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn ensure_task_board_context(
    state: &AppState,
    task: &mut Task,
) -> Result<(), ServerError> {
    if task.board_id.is_none() {
        let default_board = state
            .kanban_store
            .ensure_default_board(&task.workspace_id)
            .await?;
        task.board_id = Some(default_board.id);
    }

    if task.column_id.is_none() {
        task.column_id = Some(task_status_to_column_id(&task.status).to_string());
    }

    Ok(())
}

pub fn sync_task_status_from_column(task: &mut Task) {
    task.status = column_id_to_task_status(task.column_id.as_deref());
}

pub fn sync_task_column_from_status(task: &mut Task) {
    task.column_id = Some(task_status_to_column_id(&task.status).to_string());
}

pub fn set_task_column(task: &mut Task, column_id: impl Into<String>) {
    task.column_id = Some(column_id.into());
    sync_task_status_from_column(task);
}

pub fn task_to_card(task: &Task) -> KanbanCard {
    KanbanCard {
        id: task.id.clone(),
        title: task.title.clone(),
        description: task.objective.clone(),
        status: task.status.as_str().to_string(),
        column_id: task
            .column_id
            .clone()
            .unwrap_or_else(|| "backlog".to_string()),
        position: task.position,
        priority: task
            .priority
            .as_ref()
            .map(|priority| priority.as_str().to_string()),
        labels: task.labels.clone(),
        assignee: task.assignee.clone(),
        created_at: task.created_at,
        updated_at: task.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::models::task::{Task, TaskStatus};
    use crate::state::{AppState, AppStateInner};
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
    async fn ensure_task_board_context_backfills_board_and_column() {
        let state = setup_state().await;
        let mut task = Task::new(
            "task-1".to_string(),
            "Legacy card".to_string(),
            "Repair missing board context".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.status = TaskStatus::Pending;
        task.board_id = None;
        task.column_id = None;

        ensure_task_board_context(&state, &mut task)
            .await
            .expect("board context should be filled");

        assert!(task.board_id.is_some());
        assert_eq!(task.column_id.as_deref(), Some("backlog"));
    }
}
