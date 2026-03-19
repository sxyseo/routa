use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::application::sessions::{
    ListSessionsQuery as SessionListQuery, SessionApplicationService,
};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_sessions))
        .route(
            "/{session_id}",
            get(get_session)
                .patch(rename_session)
                .delete(delete_session),
        )
        .route("/{session_id}/history", get(get_session_history))
        .route("/{session_id}/context", get(get_session_context))
        .route("/{session_id}/disconnect", post(disconnect_session))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListSessionsQuery {
    workspace_id: Option<String>,
    parent_session_id: Option<String>,
    limit: Option<usize>,
}

/// GET /api/sessions — List ACP sessions.
/// Compatible with the Next.js frontend's session-panel.tsx and chat-panel.tsx.
///
/// Merges in-memory sessions with persisted sessions from the database.
async fn list_sessions(
    State(state): State<AppState>,
    Query(query): Query<ListSessionsQuery>,
) -> Json<serde_json::Value> {
    let service = SessionApplicationService::new(state);
    let sessions = service
        .list_sessions(SessionListQuery {
            workspace_id: query.workspace_id,
            parent_session_id: query.parent_session_id,
            limit: query.limit,
        })
        .await;

    Json(serde_json::json!({ "sessions": sessions }))
}

/// GET /api/sessions/{session_id} — Get session metadata.
///
/// First tries to get session from in-memory AcpManager.
/// Falls back to database if session is not in memory (e.g. after server restart).
async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let service = SessionApplicationService::new(state);
    let session = service.get_session(&session_id).await?;

    Ok(Json(serde_json::json!({
        "session": session
    })))
}

#[derive(Debug, Deserialize)]
struct RenameSessionRequest {
    name: String,
}

/// PATCH /api/sessions/{session_id} — Rename a session.
async fn rename_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(body): Json<RenameSessionRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ServerError::BadRequest("Invalid name".to_string()));
    }

    // Update in-memory (may be None if session is DB-only after restart)
    let in_memory_found = state
        .acp_manager
        .rename_session(&session_id, name)
        .await
        .is_some();

    // Always persist the rename to the database
    state.acp_session_store.rename(&session_id, name).await?;

    // If neither memory nor DB had the session, return 404
    if !in_memory_found {
        // Verify it exists in DB (rename is idempotent, so check row count via get)
        if state.acp_session_store.get(&session_id).await?.is_none() {
            return Err(ServerError::NotFound("Session not found".to_string()));
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// DELETE /api/sessions/{session_id} — Delete a session.
async fn delete_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Try to kill in-memory process (may be None if DB-only after restart)
    let in_memory_found = state
        .acp_manager
        .delete_session(&session_id)
        .await
        .is_some();

    // Always delete from the database
    state.acp_session_store.delete(&session_id).await?;

    // If neither memory nor DB had the session, return 404
    if !in_memory_found {
        // We already deleted from DB; if 0 rows, it was already gone
        // Return 404 only when we have confirmation it doesn't exist
        // (delete is idempotent, so we just return ok even if not found)
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /api/sessions/{session_id}/disconnect — Disconnect and kill an active session process.
///
/// Persists history to the database, then kills the in-memory process.
/// Unlike DELETE, this does not remove the session from the database.
async fn disconnect_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Check if session exists in memory
    let session = state.acp_manager.get_session(&session_id).await;
    if session.is_none() {
        return Err(ServerError::NotFound(format!(
            "Session {} not found",
            session_id
        )));
    }

    // Persist history before killing
    if let Some(history) = state.acp_manager.get_session_history(&session_id).await {
        if !history.is_empty() {
            let _ = state
                .acp_session_store
                .save_history(&session_id, &history)
                .await;
        }
    }

    // Kill the process
    state.acp_manager.kill_session(&session_id).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryQuery {
    consolidated: Option<bool>,
}

/// GET /api/sessions/{session_id}/history — Get session message history.
///
/// First tries to get history from in-memory AcpManager.
/// Falls back to database if in-memory is empty (e.g. after server restart).
async fn get_session_history(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let service = SessionApplicationService::new(state);
    let result = service
        .get_session_history(&session_id, query.consolidated.unwrap_or(false))
        .await?;

    Ok(Json(serde_json::json!({ "history": result })))
}

/// GET /api/sessions/{session_id}/context — Get hierarchical context for a session.
///
/// Returns the session's parent, children, siblings, and recent workspace sessions.
/// Mirrors the Next.js `GET /api/sessions/[sessionId]/context` route.
async fn get_session_context(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let service = SessionApplicationService::new(state);
    let context = service.get_session_context(&session_id).await?;

    Ok(Json(serde_json::json!({
        "current": context.current,
        "parent": context.parent,
        "children": context.children,
        "siblings": context.siblings,
        "recentInWorkspace": context.recent_in_workspace,
    })))
}

#[cfg(test)]
mod tests {
    use crate::application::sessions::consolidate_message_history;
    use serde_json::json;

    #[test]
    fn consolidate_message_history_merges_chunks_for_same_session() {
        let notifications = vec![
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"Hel"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"lo"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_done","content": {"text":"!"}}}),
        ];

        let merged = consolidate_message_history(notifications);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0]["sessionId"].as_str(), Some("s1"));
        assert_eq!(
            merged[0]["update"]["sessionUpdate"].as_str(),
            Some("agent_message")
        );
        assert_eq!(
            merged[0]["update"]["content"]["text"].as_str(),
            Some("Hello")
        );
    }

    #[test]
    fn consolidate_message_history_handles_session_switches() {
        let notifications = vec![
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"A"}}}),
            json!({"sessionId":"s2","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"B"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"C"}}}),
        ];

        let merged = consolidate_message_history(notifications);

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0]["update"]["content"]["text"].as_str(), Some("A"));
        assert_eq!(merged[1]["update"]["content"]["text"].as_str(), Some("B"));
        assert_eq!(merged[2]["update"]["content"]["text"].as_str(), Some("C"));
    }
}
