use crate::observe::codex_transcript::{task_identity_from_prompt, transcript_display_name};
use crate::observe::hooks::extract_file_paths_for_repo;
use crate::observe::repo::detect_repo_root;
use crate::shared::db::Db;
use crate::shared::models::{
    AttributionConfidence, FileEventRecord, HookEvent, RuntimeMessage, SessionRecord,
};
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

struct AuggieSessionBackfill {
    session_id: String,
    cwd: String,
    model: Option<String>,
    transcript_path: String,
    source: Option<String>,
    last_seen_at_ms: i64,
    status: String,
    turn_id: Option<String>,
    prompt: Option<String>,
    turn_started_at_ms: i64,
    recovered_events: Vec<RuntimeMessage>,
}

pub fn bootstrap_auggie_session_messages(repo_root: &Path) -> Result<Vec<RuntimeMessage>> {
    let summaries = collect_recent_auggie_session_summaries(repo_root)?;
    let repo_root_text = repo_root.to_string_lossy().to_string();
    let mut messages = Vec::new();
    for summary in summaries {
        let task_identity = summary.prompt.as_deref().and_then(|prompt| {
            task_identity_from_prompt(&summary.session_id, summary.turn_id.as_deref(), prompt)
        });
        let session_display_name = Some(
            task_identity
                .as_ref()
                .map(|(_, title, _)| title.clone())
                .unwrap_or_else(|| {
                    transcript_display_name(&summary.transcript_path)
                        .unwrap_or_else(|| summary.session_id.clone())
                }),
        );
        messages.push(RuntimeMessage::Hook(HookEvent {
            repo_root: repo_root_text.clone(),
            observed_at_ms: summary.turn_started_at_ms,
            status: Some(summary.status.clone()),
            client: "auggie".to_string(),
            session_id: summary.session_id.clone(),
            session_display_name,
            turn_id: summary.turn_id.clone(),
            cwd: summary.cwd.clone(),
            model: summary.model.clone(),
            transcript_path: Some(summary.transcript_path.clone()),
            session_source: summary.source.clone(),
            event_name: "TranscriptRecover".to_string(),
            tool_name: None,
            tool_command: None,
            file_paths: Vec::new(),
            task_id: task_identity
                .as_ref()
                .map(|(task_id, _, _)| task_id.clone()),
            task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
            prompt_preview: task_identity
                .as_ref()
                .map(|(_, _, preview)| preview.clone()),
            recovered_from_transcript: true,
            tmux_session: None,
            tmux_window: None,
            tmux_pane: None,
        }));
        messages.extend(summary.recovered_events);
    }

    messages.sort_by_key(RuntimeMessage::observed_at_ms);
    Ok(messages)
}

pub fn backfill_auggie_sessions_to_db(repo_root: &Path, db: &Db) -> Result<usize> {
    let repo_root_text = repo_root.to_string_lossy().to_string();
    let mut recovered_session_count = 0;
    for summary in collect_active_auggie_session_summaries(repo_root)? {
        apply_auggie_session_summary_to_db(db, &repo_root_text, &summary)?;
        recovered_session_count += 1;
    }
    Ok(recovered_session_count)
}

pub fn recent_prompt_previews_from_auggie_session(session_path: &str, limit: usize) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }
    let Ok(text) = std::fs::read_to_string(session_path) else {
        return Vec::new();
    };
    let Ok(payload) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };

    let mut prompts = payload
        .get("chatHistory")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(session_prompt_from_entry)
        .collect::<Vec<_>>();

    prompts.reverse();
    dedupe_prompt_previews(prompts, limit)
}

fn collect_active_auggie_session_summaries(repo_root: &Path) -> Result<Vec<AuggieSessionBackfill>> {
    const BACKFILL_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;
    const ACTIVE_WINDOW_MS: i64 = 30 * 60 * 1000;
    const FAST_RECENT_SESSIONS: usize = 12;

    let Some(sessions_root) = auggie_sessions_root() else {
        return Ok(Vec::new());
    };

    let now_ms = Utc::now().timestamp_millis();
    let mut sessions = collect_recent_session_files(&sessions_root)?;
    sessions.retain(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= BACKFILL_WINDOW_MS);
    sessions.sort_by(|a, b| b.1.cmp(&a.1));

    let recent_candidates = sessions
        .iter()
        .filter(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= ACTIVE_WINDOW_MS)
        .take(FAST_RECENT_SESSIONS)
        .cloned()
        .collect::<Vec<_>>();

    Ok(parse_matching_auggie_session_summaries(
        &recent_candidates,
        repo_root,
        now_ms,
        ACTIVE_WINDOW_MS,
    ))
}

fn collect_recent_auggie_session_summaries(repo_root: &Path) -> Result<Vec<AuggieSessionBackfill>> {
    const BACKFILL_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;
    const ACTIVE_WINDOW_MS: i64 = 30 * 60 * 1000;
    const FAST_RECENT_SESSIONS: usize = 12;
    const MAX_SESSIONS: usize = 48;

    let Some(sessions_root) = auggie_sessions_root() else {
        return Ok(Vec::new());
    };

    let now_ms = Utc::now().timestamp_millis();
    let mut sessions = collect_recent_session_files(&sessions_root)?;
    sessions.retain(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= BACKFILL_WINDOW_MS);
    sessions.sort_by(|a, b| b.1.cmp(&a.1));

    let recent_candidates = sessions
        .iter()
        .filter(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= ACTIVE_WINDOW_MS)
        .take(FAST_RECENT_SESSIONS)
        .cloned()
        .collect::<Vec<_>>();
    let recent_matches = parse_matching_auggie_session_summaries(
        &recent_candidates,
        repo_root,
        now_ms,
        ACTIVE_WINDOW_MS,
    );
    if !recent_matches.is_empty() {
        return Ok(recent_matches);
    }

    sessions.truncate(MAX_SESSIONS);
    Ok(parse_matching_auggie_session_summaries(
        &sessions,
        repo_root,
        now_ms,
        ACTIVE_WINDOW_MS,
    ))
}

fn auggie_sessions_root() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".augment").join("sessions"))
        .filter(|path| path.exists())
}

fn collect_recent_session_files(sessions_root: &Path) -> Result<Vec<(PathBuf, i64)>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(sessions_root)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|it| it.to_str()) != Some("json") {
            continue;
        }
        let modified_ms = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|dur| dur.as_millis() as i64)
            .unwrap_or_default();
        files.push((path, modified_ms));
    }
    Ok(files)
}

fn parse_matching_auggie_session_summaries(
    sessions: &[(PathBuf, i64)],
    repo_root: &Path,
    now_ms: i64,
    active_window_ms: i64,
) -> Vec<AuggieSessionBackfill> {
    let mut summaries = Vec::new();
    for (path, modified_ms) in sessions {
        let Some(summary) = parse_auggie_session_backfill(path, *modified_ms, repo_root) else {
            continue;
        };
        if summary.status != "active"
            && now_ms.saturating_sub(summary.last_seen_at_ms) > active_window_ms
        {
            continue;
        }
        summaries.push(summary);
    }
    summaries
}

fn parse_auggie_session_backfill(
    session_path: &Path,
    fallback_modified_ms: i64,
    repo_root: &Path,
) -> Option<AuggieSessionBackfill> {
    let text = std::fs::read_to_string(session_path).ok()?;
    let payload: Value = serde_json::from_str(&text).ok()?;
    let session_id = payload.get("sessionId")?.as_str()?.trim().to_string();
    if session_id.is_empty() {
        return None;
    }

    let cwd = extract_session_repo_root(&payload)?;
    let cwd_path = Path::new(&cwd);
    let matches_repo = cwd_path == repo_root
        || cwd_path.starts_with(repo_root)
        || detect_repo_root(cwd_path)
            .ok()
            .is_some_and(|detected_root| detected_root == repo_root);
    if !matches_repo {
        return None;
    }

    let model = payload
        .pointer("/agentState/modelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let created_ms = payload
        .get("created")
        .and_then(Value::as_str)
        .and_then(parse_iso_timestamp_ms)
        .unwrap_or(fallback_modified_ms);
    let modified_ms = payload
        .get("modified")
        .and_then(Value::as_str)
        .and_then(parse_iso_timestamp_ms)
        .unwrap_or(fallback_modified_ms);
    let chat_history = payload
        .get("chatHistory")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let latest_entry = chat_history
        .iter()
        .rev()
        .find(|entry| session_prompt_from_entry(entry).is_some())?;

    let prompt = session_prompt_from_entry(latest_entry);
    let turn_id = entry_turn_id(latest_entry);
    let turn_started_at_ms = latest_entry
        .get("finishedAt")
        .and_then(Value::as_str)
        .and_then(parse_iso_timestamp_ms)
        .or_else(|| latest_entry.get("sequenceId").and_then(Value::as_i64))
        .unwrap_or(modified_ms.max(created_ms));
    let recovered_events = recovered_runtime_messages_from_chat_history(
        &chat_history,
        &session_id,
        &cwd,
        model.clone(),
        repo_root,
    );

    Some(AuggieSessionBackfill {
        session_id,
        cwd,
        model,
        transcript_path: session_path.to_string_lossy().to_string(),
        source: Some("auggie-session".to_string()),
        last_seen_at_ms: modified_ms.max(turn_started_at_ms),
        status: "active".to_string(),
        turn_id,
        prompt,
        turn_started_at_ms,
        recovered_events,
    })
}

fn recovered_runtime_messages_from_chat_history(
    chat_history: &[Value],
    session_id: &str,
    cwd: &str,
    model: Option<String>,
    repo_root: &Path,
) -> Vec<RuntimeMessage> {
    let mut messages = Vec::new();
    for entry in chat_history {
        let changed_files = entry
            .get("changedFiles")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()));
        let file_paths = extract_file_paths_for_repo(&changed_files, repo_root);
        if file_paths.is_empty() {
            continue;
        }
        let observed_at_ms = entry
            .get("finishedAt")
            .and_then(Value::as_str)
            .and_then(parse_iso_timestamp_ms)
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        let prompt = session_prompt_from_entry(entry);
        let task_identity = prompt.as_deref().and_then(|message| {
            task_identity_from_prompt(session_id, entry_turn_id(entry).as_deref(), message)
        });
        messages.push(RuntimeMessage::Hook(HookEvent {
            repo_root: repo_root.to_string_lossy().to_string(),
            observed_at_ms,
            status: Some("active".to_string()),
            client: "auggie".to_string(),
            session_id: session_id.to_string(),
            session_display_name: None,
            turn_id: entry_turn_id(entry),
            cwd: cwd.to_string(),
            model: model.clone(),
            transcript_path: None,
            session_source: Some("auggie-session".to_string()),
            event_name: "PostToolUse".to_string(),
            tool_name: Some("session-files".to_string()),
            tool_command: None,
            file_paths,
            task_id: task_identity
                .as_ref()
                .map(|(task_id, _, _)| task_id.clone()),
            task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
            prompt_preview: task_identity
                .as_ref()
                .map(|(_, _, preview)| preview.clone()),
            recovered_from_transcript: true,
            tmux_session: None,
            tmux_window: None,
            tmux_pane: None,
        }));
    }
    messages
}

fn apply_auggie_session_summary_to_db(
    db: &Db,
    repo_root: &str,
    summary: &AuggieSessionBackfill,
) -> Result<()> {
    let existing_last_seen = db
        .session_last_seen_at_ms(&summary.session_id)?
        .unwrap_or_default();
    if existing_last_seen > summary.last_seen_at_ms {
        return Ok(());
    }

    let task_identity = summary.prompt.as_deref().and_then(|prompt| {
        task_identity_from_prompt(&summary.session_id, summary.turn_id.as_deref(), prompt)
    });
    let active_task_id = db
        .active_task_for_session(repo_root, &summary.session_id)?
        .map(|task| task.task_id);
    let recovered_task_id = task_identity
        .as_ref()
        .map(|(task_id, _, _)| task_id.as_str());
    let should_record_recover_turn = existing_last_seen < summary.turn_started_at_ms
        || active_task_id.as_deref() != recovered_task_id;

    db.upsert_session(&SessionRecord {
        session_id: summary.session_id.clone(),
        repo_root: repo_root.to_string(),
        client: "auggie".to_string(),
        cwd: summary.cwd.clone(),
        model: summary.model.clone(),
        started_at_ms: summary.turn_started_at_ms,
        last_seen_at_ms: summary.last_seen_at_ms,
        ended_at_ms: None,
        status: summary.status.clone(),
        tmux_session: None,
        tmux_window: None,
        tmux_pane: None,
        metadata_json: json!({
            "source": "auggie_session_recovery",
            "transcript_path": summary.transcript_path,
            "session_display_name": transcript_display_name(&summary.transcript_path),
            "recovered_from_transcript": true,
        })
        .to_string(),
    })?;

    if let Some((task_id, title, prompt_preview)) = task_identity.as_ref() {
        let objective = summary.prompt.as_deref().unwrap_or(title.as_str());
        let _ = db.upsert_task_from_prompt(
            repo_root,
            &summary.session_id,
            summary.turn_id.as_deref(),
            Some(summary.transcript_path.as_str()),
            task_id,
            title,
            objective,
            Some(prompt_preview.as_str()),
            true,
            summary.last_seen_at_ms,
        )?;
    }

    if should_record_recover_turn {
        db.record_turn(
            &summary.session_id,
            repo_root,
            summary.turn_id.as_deref(),
            "auggie",
            "TranscriptRecover",
            None,
            None,
            summary.turn_started_at_ms,
            &json!({
                "transcript_path": summary.transcript_path,
                "source": summary.source,
                "status": summary.status,
                "recovered_from_transcript": true,
            })
            .to_string(),
        )?;
    }

    for message in summary
        .recovered_events
        .iter()
        .filter(|message| message.observed_at_ms() > existing_last_seen)
    {
        apply_recovered_runtime_message_to_db(db, repo_root, message)?;
    }

    Ok(())
}

fn apply_recovered_runtime_message_to_db(
    db: &Db,
    repo_root: &str,
    message: &RuntimeMessage,
) -> Result<()> {
    if let RuntimeMessage::Hook(event) = message {
        db.record_turn(
            &event.session_id,
            repo_root,
            event.turn_id.as_deref(),
            &event.client,
            &event.event_name,
            event.tool_name.as_deref(),
            event.tool_command.as_deref(),
            event.observed_at_ms,
            &serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string()),
        )?;

        for rel_path in &event.file_paths {
            let task_id = event.task_id.clone().or_else(|| {
                db.resolve_task_id(repo_root, Some(&event.session_id), event.turn_id.as_deref())
                    .ok()
                    .flatten()
            });
            let _ = db.insert_file_event(&FileEventRecord {
                id: None,
                repo_root: repo_root.to_string(),
                rel_path: rel_path.clone(),
                event_kind: "hook-file".to_string(),
                observed_at_ms: event.observed_at_ms,
                session_id: Some(event.session_id.clone()),
                turn_id: event.turn_id.clone(),
                task_id,
                confidence: AttributionConfidence::Exact,
                source: "transcript_recovery".to_string(),
                metadata_json: json!({
                    "raw_event": event.event_name,
                    "recovered_from_transcript": true,
                })
                .to_string(),
            })?;
        }
    }
    Ok(())
}

fn extract_session_repo_root(payload: &Value) -> Option<String> {
    let chat_history = payload.get("chatHistory")?.as_array()?;
    for entry in chat_history.iter().rev() {
        let nodes = entry.pointer("/exchange/request_nodes")?.as_array()?;
        for node in nodes {
            let ide_state = node.get("ide_state_node")?;
            if let Some(repo_root) = ide_state
                .get("workspace_folders")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|folder| {
                    folder
                        .get("repository_root")
                        .and_then(Value::as_str)
                        .or_else(|| folder.get("folder_root").and_then(Value::as_str))
                })
                .map(str::trim)
                .find(|path| !path.is_empty())
            {
                return Some(repo_root.to_string());
            }
            if let Some(cwd) = ide_state
                .get("current_terminal")
                .and_then(Value::as_object)
                .and_then(|terminal| terminal.get("current_working_directory"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|path| !path.is_empty())
            {
                return Some(cwd.to_string());
            }
        }
    }
    None
}

fn session_prompt_from_entry(entry: &Value) -> Option<String> {
    entry
        .pointer("/exchange/request_message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(str::to_string)
}

fn entry_turn_id(entry: &Value) -> Option<String> {
    entry
        .pointer("/exchange/request_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            entry
                .get("sequenceId")
                .and_then(Value::as_i64)
                .map(|value| value.to_string())
        })
}

fn parse_iso_timestamp_ms(raw: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|value| value.timestamp_millis())
}

fn summarize_prompt_preview(prompt: &str) -> String {
    let normalized = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_text(&normalized, 180)
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

fn dedupe_prompt_previews(prompts: Vec<String>, limit: usize) -> Vec<String> {
    let mut deduped = Vec::new();
    let mut seen = BTreeSet::new();
    for prompt in prompts {
        let normalized = summarize_prompt_preview(&prompt);
        if normalized.is_empty() || !seen.insert(normalized.clone()) {
            continue;
        }
        deduped.push(normalized);
        if deduped.len() >= limit {
            break;
        }
    }
    deduped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::Db;
    use tempfile::tempdir;

    #[test]
    fn parse_auggie_session_backfill_extracts_repo_prompt_and_model() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path().join("repo");
        std::fs::create_dir_all(&repo_root).expect("repo");
        let session = dir.path().join("session.json");
        std::fs::write(
            &session,
            format!(
                r#"{{
  "sessionId":"sess-1",
  "created":"2026-04-13T02:09:41.851Z",
  "modified":"2026-04-13T02:11:22.963Z",
  "customTitle":"Harness review",
  "agentState":{{"modelId":"claude-sonnet-4"}},
  "chatHistory":[
    {{
      "sequenceId":1,
      "finishedAt":"2026-04-13T02:10:00.000Z",
      "exchange":{{
        "request_id":"req-1",
        "request_message":"analyze harness monitor",
        "request_nodes":[
          {{
            "id":2,
            "type":4,
            "ide_state_node":{{
              "workspace_folders":[{{"repository_root":"{}","folder_root":"{}"}}],
              "current_terminal":{{"current_working_directory":"{}"}}
            }}
          }}
        ]
      }},
      "changedFiles":[]
    }}
  ]
}}"#,
                repo_root.display(),
                repo_root.display(),
                repo_root.display(),
            ),
        )
        .expect("session");

        let summary = parse_auggie_session_backfill(&session, 0, &repo_root).expect("summary");
        assert_eq!(summary.session_id, "sess-1");
        assert_eq!(summary.cwd, repo_root.to_string_lossy());
        assert_eq!(summary.model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(summary.turn_id.as_deref(), Some("req-1"));
        assert_eq!(summary.prompt.as_deref(), Some("analyze harness monitor"));
        assert_eq!(summary.source.as_deref(), Some("auggie-session"));
    }

    #[test]
    fn recent_prompt_previews_from_auggie_session_returns_latest_first() {
        let dir = tempdir().expect("tempdir");
        let session = dir.path().join("session.json");
        std::fs::write(
            &session,
            r#"{
  "chatHistory":[
    {"sequenceId":1,"exchange":{"request_message":"first prompt"}},
    {"sequenceId":2,"exchange":{"request_message":"second prompt"}},
    {"sequenceId":3,"exchange":{"request_message":"second prompt"}},
    {"sequenceId":4,"exchange":{"request_message":"third prompt"}}
  ]
}"#,
        )
        .expect("session");

        let prompts =
            recent_prompt_previews_from_auggie_session(session.to_str().expect("path"), 3);
        assert_eq!(
            prompts,
            vec!["third prompt", "second prompt", "first prompt"]
        );
    }

    #[test]
    fn auggie_session_db_backfill_recovers_session_and_task() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let repo_root = dir.path().join("repo");
        std::fs::create_dir_all(home.join(".augment").join("sessions")).expect("sessions");
        std::fs::create_dir_all(&repo_root).expect("repo");
        let session_file = home.join(".augment").join("sessions").join("sess-1.json");
        std::fs::write(
            &session_file,
            format!(
                r#"{{
  "sessionId":"sess-1",
  "created":"2026-04-13T02:09:41.851Z",
  "modified":"2026-04-13T02:11:22.963Z",
  "agentState":{{"modelId":"claude-sonnet-4"}},
  "chatHistory":[
    {{
      "sequenceId":1,
      "finishedAt":"2026-04-13T02:10:00.000Z",
      "exchange":{{
        "request_id":"req-1",
        "request_message":"analyze harness monitor",
        "request_nodes":[
          {{
            "id":2,
            "type":4,
            "ide_state_node":{{
              "workspace_folders":[{{"repository_root":"{}","folder_root":"{}"}}],
              "current_terminal":{{"current_working_directory":"{}"}}
            }}
          }}
        ]
      }},
      "changedFiles":[]
    }}
  ]
}}"#,
                repo_root.display(),
                repo_root.display(),
                repo_root.display(),
            ),
        )
        .expect("session");

        let previous_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);
        let db = Db::open(&dir.path().join("monitor.sqlite")).expect("db");
        let recovered = backfill_auggie_sessions_to_db(&repo_root, &db).expect("backfill");
        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        assert_eq!(recovered, 1);
        let task = db
            .list_tasks(&repo_root.to_string_lossy())
            .expect("tasks")
            .into_iter()
            .find(|entry| entry.session_id == "sess-1")
            .expect("recovered task");
        assert!(task.recovered_from_transcript);
        assert_eq!(
            task.prompt_preview.as_deref(),
            Some("analyze harness monitor")
        );
        assert_eq!(
            task.transcript_path.as_deref(),
            Some(session_file.to_str().expect("path"))
        );
    }
}
