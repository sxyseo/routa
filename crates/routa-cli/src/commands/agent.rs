//! `routa agent` — Agent management commands.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use dialoguer::{theme::ColorfulTheme, Input, Select};
use routa_core::acp::{get_preset_by_id_with_registry, AcpPreset, SessionLaunchOptions};
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use routa_core::workflow::specialist::{SpecialistDef, SpecialistLoader};

use super::print_json;
use super::tui::TuiRenderer;
use chrono::Local;

const JOURNEY_EVALUATOR_ID: &str = "ui-journey-evaluator";
const DEFAULT_SCENARIO_ID: &str = "unknown-scenario";
const DEFAULT_BASE_URL: &str = "http://localhost:3000";
const DEFAULT_ARTIFACT_DIR: &str = "artifacts/ui-journey";

#[derive(Debug, Clone)]
struct UiJourneyPromptParams {
    scenario_id: Option<String>,
    base_url: String,
    artifact_dir: String,
}

#[derive(Debug, Clone)]
struct UiJourneyRunContext {
    specialist_id: String,
    provider: String,
    run_id: String,
    prompt: UiJourneyPromptParams,
}

#[derive(Debug, Clone)]
struct UiJourneyRunMetrics {
    attempts: u32,
    provider_timeout_ms: Option<u64>,
    provider_retries: u8,
    elapsed_ms: u128,
    initialization_elapsed_ms: Option<u128>,
}

pub async fn list(state: &AppState, workspace_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.list",
            "params": { "workspaceId": workspace_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn create(
    state: &AppState,
    name: &str,
    role: &str,
    workspace_id: &str,
    parent_id: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "name": name,
        "role": role,
        "workspaceId": workspace_id
    });
    if let Some(pid) = parent_id {
        params["parentId"] = serde_json::json!(pid);
    }
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn status(state: &AppState, agent_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.get",
            "params": { "id": agent_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn summary(state: &AppState, agent_id: &str) -> Result<(), String> {
    // Agent summary uses agents.get since there's no separate summary RPC method
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.get",
            "params": { "id": agent_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn run(
    state: &AppState,
    specialist: Option<&str>,
    specialist_file: Option<&str>,
    prompt: Option<&str>,
    workspace_id: &str,
    provider: Option<&str>,
    specialist_dir: Option<&str>,
    provider_timeout_ms: Option<u64>,
    provider_retries: u8,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());

    let selected_specialist = if let Some(path) = specialist_file {
        load_specialist_from_file(path)?
    } else {
        let specialists = load_specialists(specialist_dir);
        if specialists.is_empty() {
            return Err(
                "No specialists available. Add files under specialists/ or resources/specialists/."
                    .to_string(),
            );
        }

        let (prompt_specialist, prompt_remainder) = parse_prompt_mention(prompt);
        let selected = if let Some(id) = specialist.or(prompt_specialist.as_deref()) {
            find_specialist(&specialists, id)
                .ok_or_else(|| format!("Unknown specialist: {}", id))?
        } else {
            select_specialist(&specialists)?
        };

        let user_prompt = match prompt_remainder.or(prompt.map(|value| value.to_string())) {
            Some(existing_prompt) if !existing_prompt.trim().is_empty() => existing_prompt,
            _ => prompt_for_user_request(&selected)?,
        };

        return run_selected_specialist(
            state,
            &router,
            selected,
            user_prompt,
            workspace_id,
            provider,
            provider_timeout_ms,
            provider_retries,
        )
        .await;
    };

    let user_prompt = match prompt.map(|value| value.to_string()) {
        Some(existing_prompt) if !existing_prompt.trim().is_empty() => existing_prompt,
        _ => prompt_for_user_request(&selected_specialist)?,
    };

    run_selected_specialist(
        state,
        &router,
        selected_specialist,
        user_prompt,
        workspace_id,
        provider,
        provider_timeout_ms,
        provider_retries,
    )
    .await
}

async fn run_selected_specialist(
    state: &AppState,
    router: &RpcRouter,
    selected_specialist: SpecialistConfig,
    user_prompt: String,
    workspace_id: &str,
    provider: Option<&str>,
    provider_timeout_ms: Option<u64>,
    provider_retries: u8,
) -> Result<(), String> {
    let effective_provider = provider
        .map(str::to_string)
        .or_else(|| selected_specialist.default_provider.clone())
        .unwrap_or_else(|| "opencode".to_string());
    let run_start = Instant::now();
    let journey_context =
        build_ui_journey_context(&selected_specialist.id, &user_prompt, &effective_provider);
    let mut metrics = UiJourneyRunMetrics {
        attempts: 0,
        provider_timeout_ms,
        provider_retries,
        elapsed_ms: 0,
        initialization_elapsed_ms: None,
    };

    let verify_provider = verify_provider_readiness(&effective_provider).await;
    if let Err(error) = verify_provider {
        if let Some(context) = journey_context.as_ref() {
            metrics.elapsed_ms = run_start.elapsed().as_millis();
            write_ui_journey_failure_artifacts(context, "provider_readiness", &error, &metrics);
        }
        return Err(format!("Failed to verify provider: {}", error));
    }

    let workspace_id = ensure_workspace(router, workspace_id).await?;
    let agent_role = selected_specialist.role.as_str();
    let agent_name = format!("cli-{}", selected_specialist.id);
    let create_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": {
                "name": agent_name,
                "role": agent_role,
                "workspaceId": &workspace_id
            }
        }))
        .await;

    let agent_id = create_response
        .get("result")
        .and_then(|r| r.get("agentId"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            let error_msg = create_response
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            let err = format!("Failed to create agent: {}", error_msg);
            if let Some(context) = journey_context.as_ref() {
                metrics.elapsed_ms = run_start.elapsed().as_millis();
                write_ui_journey_failure_artifacts(context, "agent_creation", &err, &metrics);
            }
            err
        })?
        .to_string();

    let _session_id = uuid::Uuid::new_v4().to_string();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Routa CLI — Specialist Run                            ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    println!("║  Specialist: {:<42} ║", selected_specialist.id);
    println!("║  Role      : {:<42} ║", agent_role);
    println!("║  Workspace : {:<42} ║", &workspace_id);
    println!("║  Provider  : {:<42} ║", &effective_provider);
    println!(
        "║  CWD       : {:<42} ║",
        super::prompt::truncate_path(&cwd, 42)
    );
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("📋 Prompt: {}", user_prompt);
    println!();

    let mut launch_options = SessionLaunchOptions::default();
    launch_options.initialize_timeout_ms = provider_timeout_ms;
    launch_options.specialist_id = Some(selected_specialist.id.clone());

    let max_attempts = 1usize + usize::from(provider_retries);
    let mut final_session_id: Option<String> = None;
    let mut last_session_error = String::new();

    for attempt in 1..=max_attempts {
        metrics.attempts = attempt as u32;
        let attempt_start = Instant::now();
        let attempt_session_id = uuid::Uuid::new_v4().to_string();
        let create_result = state
            .acp_manager
            .create_session_with_options(
                attempt_session_id.clone(),
                cwd.clone(),
                workspace_id.clone(),
                Some(effective_provider.clone()),
                Some(agent_role.to_string()),
                selected_specialist.default_model.clone(),
                None,
                None, // tool_mode
                None, // mcp_profile
                launch_options.clone(),
            )
            .await;

        match create_result {
            Ok((_, _)) => {
                metrics.initialization_elapsed_ms = Some(attempt_start.elapsed().as_millis());
                final_session_id = Some(attempt_session_id);
                break;
            }
            Err(err) => {
                let reason = format!("Attempt {} failed: {}", attempt, err);
                last_session_error = reason.clone();

                if attempt < max_attempts {
                    println!("⚠️  {}. Retrying in 1 second...", reason);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }

                let error = format!("Failed to create ACP session: {}", err);
                if let Some(context) = journey_context.as_ref() {
                    metrics.elapsed_ms = run_start.elapsed().as_millis();
                    write_ui_journey_failure_artifacts(
                        context,
                        "session_creation",
                        &error,
                        &metrics,
                    );
                }
                return Err(error);
            }
        }
    }

    let session_id = final_session_id.ok_or_else(|| {
        format!(
            "Failed to create ACP session after {} attempts: {}",
            max_attempts, last_session_error
        )
    })?;

    let acp = Arc::new(state.acp_manager.clone());
    let orchestrator = RoutaOrchestrator::new(
        OrchestratorConfig::default(),
        acp,
        state.agent_store.clone(),
        state.task_store.clone(),
        state.event_bus.clone(),
    );
    orchestrator
        .register_agent_session(&agent_id, &session_id)
        .await;

    let mut rx = state
        .acp_manager
        .subscribe(&session_id)
        .await
        .ok_or("Failed to subscribe to session updates")?;

    let initial_prompt =
        build_specialist_prompt(&selected_specialist, &agent_id, &workspace_id, &user_prompt);

    println!("🚀 Sending prompt to specialist...");
    println!();

    if let Err(err) = state.acp_manager.prompt(&session_id, &initial_prompt).await {
        let error = format!("Failed to send prompt: {}", err);
        if let Some(context) = journey_context.as_ref() {
            metrics.elapsed_ms = run_start.elapsed().as_millis();
            write_ui_journey_failure_artifacts(context, "prompt_submission", &error, &metrics);
        }
        state.acp_manager.kill_session(&session_id).await;
        orchestrator.cleanup(&session_id).await;
        return Err(error);
    }

    let mut renderer = TuiRenderer::new();
    let mut idle_count = 0u32;
    let max_idle = 600;
    let mut failure_reason: Option<String> = None;

    loop {
        match tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv()).await {
            Ok(Ok(update)) => {
                idle_count = 0;
                renderer.handle_update(&update);
            }
            Ok(Err(_)) => {
                renderer.finish();
                println!("═══ Specialist session ended ═══");
                break;
            }
            Err(_) => {
                idle_count += 1;
                if idle_count >= max_idle {
                    renderer.finish();
                    println!("⏰ Timeout: no activity for {} seconds", max_idle);
                    failure_reason = Some("session_idle_timeout".to_string());
                    break;
                }

                if !state.acp_manager.is_alive(&session_id).await {
                    renderer.finish();
                    println!("═══ Specialist process exited ═══");
                    failure_reason = Some("provider_process_exited".to_string());
                    break;
                }
            }
        }
    }

    println!();
    super::prompt::print_session_summary(router, &workspace_id).await;

    state.acp_manager.kill_session(&session_id).await;
    orchestrator.cleanup(&session_id).await;

    if let Some(context) = journey_context.as_ref() {
        if let Some(reason) = failure_reason {
            metrics.elapsed_ms = run_start.elapsed().as_millis();
            let failure_summary = if reason == "session_idle_timeout" {
                "Session timed out with no activity"
            } else {
                "Provider process exited unexpectedly"
            };
            write_ui_journey_failure_artifacts(context, reason.as_str(), failure_summary, &metrics);
            return Err(format!(
                "Failed to complete specialist run: {}",
                failure_summary
            ));
        }
    }

    metrics.elapsed_ms = run_start.elapsed().as_millis();
    if let Some(context) = journey_context.as_ref() {
        write_ui_journey_success_artifacts(context, &metrics);
    }

    Ok(())
}

fn load_specialist_from_file(path: &str) -> Result<SpecialistConfig, String> {
    let specialist = SpecialistDef::from_path(path)?;
    SpecialistConfig::from_specialist_def(specialist)
        .ok_or_else(|| format!("Failed to resolve specialist from file: {}", path))
}

fn build_ui_journey_context(
    specialist_id: &str,
    prompt: &str,
    provider: &str,
) -> Option<UiJourneyRunContext> {
    if specialist_id != JOURNEY_EVALUATOR_ID {
        return None;
    }

    let parsed = parse_ui_journey_prompt(prompt);
    Some(UiJourneyRunContext {
        specialist_id: specialist_id.to_string(),
        provider: provider.to_string(),
        run_id: generate_run_id(),
        prompt: parsed,
    })
}

fn generate_run_id() -> String {
    let now = Local::now();
    format!(
        "{}-{:03}",
        now.format("%Y%m%d-%H%M%S"),
        now.timestamp_subsec_millis()
    )
}

fn parse_ui_journey_prompt(prompt: &str) -> UiJourneyPromptParams {
    let mut values = HashMap::new();

    for pair in prompt.split(',') {
        let section = pair.trim();
        if section.is_empty() {
            continue;
        }

        let Some((raw_key, raw_value)) = section.split_once(':') else {
            continue;
        };

        let key = raw_key.trim().to_lowercase();
        let value = raw_value.trim();
        if value.is_empty() {
            continue;
        }

        values.insert(key, value.to_string());
    }

    UiJourneyPromptParams {
        scenario_id: values.remove("scenario"),
        base_url: values
            .remove("base_url")
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
        artifact_dir: values
            .remove("artifact_dir")
            .unwrap_or_else(|| DEFAULT_ARTIFACT_DIR.to_string()),
    }
}

fn write_ui_journey_failure_artifacts(
    context: &UiJourneyRunContext,
    failure_stage: &str,
    failure_message: &str,
    metrics: &UiJourneyRunMetrics,
) {
    if let Err(err) = write_ui_journey_artifact_set(
        context,
        failure_stage,
        failure_message,
        "incomplete",
        metrics,
    ) {
        eprintln!("⚠️  Failed to write failure artifacts: {}", err);
    }
}

fn write_ui_journey_success_artifacts(
    context: &UiJourneyRunContext,
    metrics: &UiJourneyRunMetrics,
) {
    if let Err(err) = write_ui_journey_artifact_set(
        context,
        "completed",
        "Session completed",
        "completed",
        metrics,
    ) {
        eprintln!("⚠️  Failed to write success artifacts: {}", err);
    }
}

fn write_ui_journey_artifact_set(
    context: &UiJourneyRunContext,
    stage: &str,
    message: &str,
    status: &str,
    metrics: &UiJourneyRunMetrics,
) -> Result<(), String> {
    let scenario_id = context
        .prompt
        .scenario_id
        .clone()
        .unwrap_or_else(|| DEFAULT_SCENARIO_ID.to_string());
    let artifact_dir = Path::new(&context.prompt.artifact_dir)
        .join(&scenario_id)
        .join(&context.run_id);
    let screenshot_dir = artifact_dir.join("screenshots");

    std::fs::create_dir_all(&screenshot_dir)
        .map_err(|err| format!("Failed to create {}: {}", screenshot_dir.display(), err))?;

    let evaluation = serde_json::json!({
        "result": status,
        "specialist_id": context.specialist_id,
        "provider": context.provider,
        "scenario_id": context.prompt.scenario_id,
        "run_id": context.run_id,
        "task_fit_score": if status == "completed" { 100 } else { 0 },
        "verdict": if status == "completed" { "Good Fit" } else { "Incomplete" },
        "findings": if status == "completed" {
            serde_json::json!([])
        } else {
            serde_json::json!([{
                "type": "issue",
                "description": format!("{} (stage: {})", message, stage),
                "severity": "high"
            }])
        },
        "evidence_summary": if status == "completed" {
            "Specialist run finished. Follow-up evaluator files can be emitted by specialist."
        } else {
            "Run failed before producing full specialist outputs."
        },
        "run_metadata": {
            "attempts": metrics.attempts,
            "provider_timeout_ms": metrics.provider_timeout_ms,
            "provider_retries": metrics.provider_retries,
            "elapsed_ms": metrics.elapsed_ms,
            "initialize_elapsed_ms": metrics.initialization_elapsed_ms,
            "failure_stage": stage,
        }
    });

    let summary = format!(
        "# UI Journey Evaluation\n\n- Specialist: {specialist}\n- Provider: {provider}\n- Scenario: {scenario}\n- Run ID: {run_id}\n- Stage: {stage}\n- Base URL: {base_url}\n- Status: {status}\n- Message: {message}\n- Attempts: {attempts}\n- Provider timeout (ms): {timeout}\n- Retries: {retries}\n- Total elapsed (ms): {elapsed}\n",
        specialist = context.specialist_id,
        provider = context.provider,
        scenario = scenario_id.as_str(),
        run_id = context.run_id,
        stage = stage,
        base_url = context.prompt.base_url,
        status = status,
        message = message,
        attempts = metrics.attempts,
        timeout = metrics
            .provider_timeout_ms
            .map_or_else(|| "unset".to_string(), |value| value.to_string()),
        retries = metrics.provider_retries,
        elapsed = metrics.elapsed_ms
    );

    let evaluation_path = artifact_dir.join("evaluation.json");
    let summary_path = artifact_dir.join("summary.md");
    let evaluation_json = serde_json::to_string_pretty(&evaluation)
        .map_err(|err| format!("Failed to serialize evaluation JSON: {}", err))?;

    std::fs::write(&evaluation_path, evaluation_json)
        .map_err(|err| format!("Failed to write {}: {}", evaluation_path.display(), err))?;
    std::fs::write(&summary_path, summary)
        .map_err(|err| format!("Failed to write {}: {}", summary_path.display(), err))?;

    println!(
        "📁 UI journey artifacts written to {}",
        artifact_dir.display()
    );

    Ok(())
}

async fn verify_provider_readiness(provider: &str) -> Result<(), String> {
    let normalized_provider = provider.trim().to_lowercase();
    if normalized_provider.is_empty() {
        return Err("Provider is empty".to_string());
    }

    let preset = get_preset_by_id_with_registry(&normalized_provider)
        .await
        .map_err(|err| format!("Unsupported provider '{}': {}", normalized_provider, err))?;
    let command = resolve_preset_command(&preset);

    if !command_exists(&command) {
        return Err(format!(
            "Provider '{}' requires '{}' but command not found. Is it installed and in PATH?",
            normalized_provider, command
        ));
    }

    if normalized_provider == "opencode" {
        verify_opencode_config_directory()?;
    }

    if normalized_provider == "claude" {
        if std::env::var("ANTHROPIC_AUTH_TOKEN").is_err()
            && std::env::var("ANTHROPIC_API_KEY").is_err()
        {
            println!(
                "⚠️  Claude may require authentication (no ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY)."
            );
        }
    }

    Ok(())
}

fn resolve_preset_command(preset: &AcpPreset) -> String {
    if let Some(env_var) = &preset.env_bin_override {
        if let Ok(custom_command) = std::env::var(env_var) {
            let trimmed = custom_command.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    preset.command.clone()
}

fn command_exists(command: &str) -> bool {
    if command.trim().is_empty() {
        return false;
    }

    if Path::new(command).is_file() || command.contains(std::path::MAIN_SEPARATOR) {
        Path::new(command).is_file()
    } else {
        routa_core::shell_env::which(command).is_some()
    }
}

fn verify_opencode_config_directory() -> Result<(), String> {
    let config_base = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".config")))
        .ok_or_else(|| "Failed to resolve config directory".to_string())?;
    let config_dir: PathBuf = config_base.join("opencode");
    std::fs::create_dir_all(&config_dir)
        .map_err(|err| format!("Failed to ensure {}: {}", config_dir.display(), err))?;

    let check_file = config_dir.join(format!(".routa-acp-{}-check", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&check_file)
        .map_err(|err| format!("Failed to write {}: {}", check_file.display(), err))?;
    file.write_all(b"routa cli provider health check")
        .map_err(|err| format!("Failed to write {}: {}", check_file.display(), err))?;
    std::fs::remove_file(check_file)
        .map_err(|err| format!("Failed to clean {}: {}", config_dir.display(), err))?;
    Ok(())
}

fn load_specialists(specialist_dir: Option<&str>) -> Vec<SpecialistConfig> {
    let mut specialists = SpecialistConfig::list_available();

    if let Some(dir) = specialist_dir {
        let mut loader = SpecialistLoader::new();
        if loader.load_dir(dir).is_ok() {
            for specialist in loader
                .all()
                .values()
                .cloned()
                .filter_map(SpecialistConfig::from_specialist_def)
            {
                if let Some(index) = specialists
                    .iter()
                    .position(|current| current.id == specialist.id)
                {
                    specialists[index] = specialist;
                } else {
                    specialists.push(specialist);
                }
            }
        }
    }

    specialists.sort_by(|left, right| left.id.cmp(&right.id));
    specialists
}

fn parse_prompt_mention(prompt: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(prompt) = prompt.map(str::trim) else {
        return (None, None);
    };

    let Some(without_marker) = prompt.strip_prefix('@') else {
        return (None, None);
    };

    let mut parts = without_marker.splitn(2, char::is_whitespace);
    let specialist = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());
    let remainder = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    (specialist, remainder)
}

fn prompt_for_user_request(specialist: &SpecialistConfig) -> Result<String, String> {
    let theme = ColorfulTheme::default();
    let prompt = Input::with_theme(&theme)
        .with_prompt(format!("Prompt for {}", specialist.name))
        .interact_text()
        .map_err(|e| format!("Failed to read prompt: {}", e))?;

    Ok(prompt)
}

fn select_specialist(specialists: &[SpecialistConfig]) -> Result<SpecialistConfig, String> {
    let theme = ColorfulTheme::default();
    let items = specialists
        .iter()
        .map(|specialist| {
            format!(
                "{} ({}){}",
                specialist.id,
                specialist.role.as_str(),
                specialist
                    .description
                    .as_ref()
                    .map(|description| format!(" - {}", description))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>();

    let index = Select::with_theme(&theme)
        .with_prompt("Select a specialist")
        .items(&items)
        .default(0)
        .interact()
        .map_err(|e| format!("Failed to select specialist: {}", e))?;

    Ok(specialists[index].clone())
}

fn find_specialist(specialists: &[SpecialistConfig], id: &str) -> Option<SpecialistConfig> {
    let target = id.to_lowercase();
    specialists
        .iter()
        .find(|specialist| specialist.id == target)
        .cloned()
}

fn build_specialist_prompt(
    specialist: &SpecialistConfig,
    agent_id: &str,
    workspace_id: &str,
    prompt: &str,
) -> String {
    format!(
        "{}\n\n---\n\n**Your Agent ID:** {}\n**Workspace ID:** {}\n\n## User Request\n\n{}\n\n---\n**Reminder:** {}\n",
        specialist.system_prompt,
        agent_id,
        workspace_id,
        prompt,
        specialist.role_reminder
    )
}

async fn ensure_workspace(router: &RpcRouter, workspace_id: &str) -> Result<String, String> {
    if workspace_id == "default" {
        return Ok("default".to_string());
    }

    let ws_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspaces.get",
            "params": { "id": workspace_id }
        }))
        .await;

    if ws_response.get("error").is_none() {
        return Ok(workspace_id.to_string());
    }

    let create_resp = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "workspaces.create",
            "params": {
                "title": workspace_id
            }
        }))
        .await;

    if let Some(err) = create_resp.get("error") {
        let err_msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Failed to create workspace: {}", err_msg));
    }

    let created_ws_id = create_resp
        .get("result")
        .and_then(|r| r.get("workspace"))
        .and_then(|w| w.get("id"))
        .and_then(|id| id.as_str())
        .ok_or("Failed to get created workspace ID")?
        .to_string();

    println!("Created workspace: {}", created_ws_id);
    Ok(created_ws_id)
}

#[cfg(test)]
mod tests {
    use super::parse_prompt_mention;
    use super::parse_ui_journey_prompt;
    use super::{
        write_ui_journey_artifact_set, UiJourneyPromptParams, UiJourneyRunContext,
        UiJourneyRunMetrics, DEFAULT_ARTIFACT_DIR, DEFAULT_BASE_URL,
    };
    use routa_core::orchestration::SpecialistConfig;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_prompt_mentions_with_inline_prompt() {
        let (specialist, prompt) =
            parse_prompt_mention(Some("@view-git-change summarize the diff"));
        assert_eq!(specialist.as_deref(), Some("view-git-change"));
        assert_eq!(prompt.as_deref(), Some("summarize the diff"));
    }

    #[test]
    fn ignores_plain_prompts() {
        let (specialist, prompt) = parse_prompt_mention(Some("summarize the diff"));
        assert!(specialist.is_none());
        assert!(prompt.is_none());
    }

    #[test]
    fn prefers_specialist_execution_provider_when_cli_provider_missing() {
        let specialist = SpecialistConfig {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: None,
            role: routa_core::models::agent::AgentRole::Developer,
            default_model_tier: routa_core::models::agent::ModelTier::Smart,
            system_prompt: "prompt".to_string(),
            role_reminder: String::new(),
            default_provider: Some("claude".to_string()),
            default_adapter: None,
            default_model: Some("sonnet-4.5".to_string()),
        };

        let effective_provider = None
            .map(str::to_string)
            .or_else(|| specialist.default_provider.clone())
            .unwrap_or_else(|| "opencode".to_string());

        assert_eq!(effective_provider, "claude");
        assert_eq!(specialist.default_model.as_deref(), Some("sonnet-4.5"));
    }

    #[test]
    fn parses_ui_journey_prompt_kv_pairs() {
        let params = parse_ui_journey_prompt(
            "scenario: core-home-session, base_url: http://localhost:3000, artifact_dir: /tmp/artifacts",
        );

        assert_eq!(params.scenario_id.as_deref(), Some("core-home-session"));
        assert_eq!(params.base_url, "http://localhost:3000");
        assert_eq!(params.artifact_dir, "/tmp/artifacts");
    }

    #[test]
    fn writes_ui_journey_failure_artifacts() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-001".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
            },
        };
        let metrics = UiJourneyRunMetrics {
            attempts: 1,
            provider_timeout_ms: Some(3000),
            provider_retries: 1,
            elapsed_ms: 1200,
            initialization_elapsed_ms: Some(100),
        };

        write_ui_journey_artifact_set(
            &context,
            "session_creation",
            "init timeout",
            "incomplete",
            &metrics,
        )
        .unwrap();

        let output_dir = std::path::Path::new(&artifact_dir)
            .join("core-home-session")
            .join("2026-03-25-001");
        let evaluation = output_dir.join("evaluation.json");
        let summary = output_dir.join("summary.md");

        assert!(evaluation.exists());
        assert!(summary.exists());
        assert!(output_dir.join("screenshots").exists());

        let contents = fs::read_to_string(summary).unwrap();
        assert!(contents.contains("Stage: session_creation"));
        assert!(contents.contains("init timeout"));
    }

    #[test]
    fn defaults_ui_journey_prompt_values() {
        let params = parse_ui_journey_prompt("scenario: unknown");
        assert_eq!(params.base_url, DEFAULT_BASE_URL);
        assert_eq!(params.artifact_dir, DEFAULT_ARTIFACT_DIR);
        assert_eq!(params.scenario_id.as_deref(), Some("unknown"));
    }
}
