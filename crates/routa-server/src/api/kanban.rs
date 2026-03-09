use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;

use crate::error::ServerError;
use crate::models::kanban::{default_kanban_board, KanbanColumn};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/boards", get(list_boards).post(create_board))
        .route("/boards/{boardId}", get(get_board).patch(update_board))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardsQuery {
    workspace_id: Option<String>,
}

async fn list_boards(
    State(state): State<AppState>,
    Query(query): Query<BoardsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.unwrap_or_else(|| "default".to_string());
    state.kanban_store.ensure_default_board(&workspace_id).await?;
    let boards = state.kanban_store.list_by_workspace(&workspace_id).await?;
    Ok(Json(serde_json::json!({ "boards": boards })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBoardRequest {
    workspace_id: String,
    name: String,
    is_default: Option<bool>,
}

async fn create_board(
    State(state): State<AppState>,
    Json(body): Json<CreateBoardRequest>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ServerError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ServerError::BadRequest("board name cannot be blank".to_string()));
    }

    let mut board = default_kanban_board(body.workspace_id.clone());
    board.id = uuid::Uuid::new_v4().to_string();
    board.name = name.to_string();
    board.is_default = body.is_default.unwrap_or(false);
    board.created_at = Utc::now();
    board.updated_at = board.created_at;

    state.kanban_store.create(&board).await?;
    if board.is_default {
        state
            .kanban_store
            .set_default_for_workspace(&body.workspace_id, &board.id)
            .await?;
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "board": board })),
    ))
}

async fn get_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let board = state.kanban_store.get(&board_id).await?;
    match board {
        Some(b) => Ok(Json(serde_json::json!({ "board": b }))),
        None => Err(ServerError::NotFound(format!("Board not found: {}", board_id))),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateBoardRequest {
    name: Option<String>,
    columns: Option<Vec<KanbanColumn>>,
    is_default: Option<bool>,
}

async fn update_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<UpdateBoardRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let existing = state.kanban_store.get(&board_id).await?;
    let mut board = match existing {
        Some(b) => b,
        None => return Err(ServerError::NotFound(format!("Board not found: {}", board_id))),
    };

    // Update fields
    if let Some(name) = body.name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            board.name = trimmed.to_string();
        }
    }
    if let Some(columns) = body.columns {
        board.columns = columns;
    }
    if let Some(is_default) = body.is_default {
        board.is_default = is_default;
    }
    board.updated_at = Utc::now();

    state.kanban_store.update(&board).await?;

    // If setting as default, update other boards
    if body.is_default == Some(true) {
        state
            .kanban_store
            .set_default_for_workspace(&board.workspace_id, &board.id)
            .await?;
    }

    Ok(Json(serde_json::json!({ "board": board })))
}