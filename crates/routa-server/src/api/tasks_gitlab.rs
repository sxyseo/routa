//! GitLab API client for the Rust desktop backend.
//!
//! Provides PRIVATE-TOKEN authentication and REST helpers for GitLab v4 API.
//! Supports self-hosted GitLab instances via `GITLAB_URL` env var
//! (defaults to `https://gitlab.com`).

use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};

// ─── Data types ──────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabIssueListItem {
    pub id: String,
    pub iid: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub url: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabMergeRequestListItem {
    pub id: String,
    pub iid: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub url: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub draft: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged_at: Option<String>,
    pub source_branch: String,
    pub target_branch: String,
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

/// Returns the GitLab API base URL.
///
/// Priority:
/// 1. `GITLAB_URL` env var (e.g. `https://gitlab.mycompany.com`)
/// 2. Defaults to `https://gitlab.com`
///
/// The returned value never has a trailing slash.
pub fn gitlab_api_base_url() -> String {
    std::env::var("GITLAB_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "https://gitlab.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

/// Parse a GitLab project path from a source URL or remote string.
///
/// Accepts forms like:
/// - `https://gitlab.com/group/project.git`
/// - `https://gitlab.mycompany.com/group/subgroup/project`
/// - `git@gitlab.com:group/project.git`
/// - `group/project`
pub fn parse_gitlab_project(source_url: &str) -> Option<String> {
    let trimmed = source_url.trim();

    // SSH form: git@gitlab.com:group/project.git
    if let Some(rest) = trimmed.strip_prefix("git@") {
        if let Some(colon) = rest.find(':') {
            let path = rest[colon + 1..].trim_end_matches(".git");
            return validate_project_path(path);
        }
    }

    // HTTPS form — extract path after host
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);

    // Find the first '/' after host to get the project path
    if let Some(slash) = without_scheme.find('/') {
        let path = without_scheme[slash + 1..].trim_end_matches(".git");
        return validate_project_path(path);
    }

    // Bare "group/project" form
    validate_project_path(trimmed)
}

fn validate_project_path(path: &str) -> Option<String> {
    let path = path.trim_end_matches('/');
    let has_separator = path.contains('/');
    let not_empty = !path.is_empty();
    if has_separator && not_empty {
        Some(path.to_string())
    } else {
        None
    }
}

// ─── Token resolution ────────────────────────────────────────────────────────

/// Resolve a GitLab token from a board-level token or environment variable.
///
/// Priority:
/// 1. `board_token` (from kanban board config)
/// 2. `GITLAB_TOKEN` env var
pub fn resolve_gitlab_token(board_token: Option<&str>) -> Option<String> {
    board_token
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::env::var("GITLAB_TOKEN")
                .ok()
                .filter(|v| !v.is_empty())
        })
}

/// Check GitLab access status.
pub fn gitlab_access_status(board_token: Option<&str>) -> (&'static str, bool) {
    if board_token
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some()
    {
        return ("board", true);
    }

    if std::env::var("GITLAB_TOKEN")
        .ok()
        .filter(|v| !v.is_empty())
        .is_some()
    {
        return ("env", true);
    }

    ("none", false)
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

fn gitlab_request(
    request: reqwest::RequestBuilder,
    token: Option<String>,
) -> reqwest::RequestBuilder {
    let builder = request
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "routa-rust-kanban");

    match token {
        Some(t) => builder.header("PRIVATE-TOKEN", t),
        None => builder,
    }
}

// ─── API: List Issues ───────────────────────────────────────────────────────

pub async fn list_gitlab_issues(
    project: &str,
    state: Option<&str>,
    per_page: Option<usize>,
    board_token: Option<&str>,
) -> Result<Vec<GitLabIssueListItem>, String> {
    let client = reqwest::Client::new();
    let token = resolve_gitlab_token(board_token);
    let base = gitlab_api_base_url();
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    let state = state.unwrap_or("opened");

    let project_encoded = url_encode_project(project);
    let url = format!(
        "{base}/api/v4/projects/{project_encoded}/issues?state={state}&order_by=updated_at&sort=desc&per_page={per_page}"
    );

    let response = gitlab_request(client.get(&url), token)
        .send()
        .await
        .map_err(|e| format!("GitLab issue list failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitLab issue list failed: {status} {text}"));
    }

    let data: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("GitLab issue list parse failed: {e}"))?;

    Ok(data
        .into_iter()
        .map(|item| GitLabIssueListItem {
            id: item
                .get("id")
                .and_then(|v| v.as_i64())
                .unwrap_or_default()
                .to_string(),
            iid: item
                .get("iid")
                .and_then(|v| v.as_i64())
                .unwrap_or_default(),
            title: item
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            body: item
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            url: item
                .get("web_url")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            state: item
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("opened")
                .to_string(),
            labels: item
                .get("labels")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|l| {
                            l.as_str()
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(str::to_string)
                                .or_else(|| l.get("name").and_then(|n| n.as_str()).map(str::to_string))
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            assignees: item
                .get("assignees")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| {
                            a.get("username")
                                .and_then(|v| v.as_str())
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            updated_at: item
                .get("updated_at")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
        .collect())
}

// ─── API: List Merge Requests ────────────────────────────────────────────────

pub async fn list_gitlab_merge_requests(
    project: &str,
    state: Option<&str>,
    per_page: Option<usize>,
    board_token: Option<&str>,
) -> Result<Vec<GitLabMergeRequestListItem>, String> {
    let client = reqwest::Client::new();
    let token = resolve_gitlab_token(board_token);
    let base = gitlab_api_base_url();
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    let state = state.unwrap_or("opened");

    let project_encoded = url_encode_project(project);
    let url = format!(
        "{base}/api/v4/projects/{project_encoded}/merge_requests?state={state}&order_by=updated_at&sort=desc&per_page={per_page}"
    );

    let response = gitlab_request(client.get(&url), token)
        .send()
        .await
        .map_err(|e| format!("GitLab merge request list failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitLab merge request list failed: {status} {text}"));
    }

    let data: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("GitLab merge request list parse failed: {e}"))?;

    Ok(data
        .into_iter()
        .map(|item| GitLabMergeRequestListItem {
            id: item
                .get("id")
                .and_then(|v| v.as_i64())
                .unwrap_or_default()
                .to_string(),
            iid: item
                .get("iid")
                .and_then(|v| v.as_i64())
                .unwrap_or_default(),
            title: item
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            body: item
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            url: item
                .get("web_url")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            state: item
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("opened")
                .to_string(),
            labels: item
                .get("labels")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|l| {
                            l.as_str()
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(str::to_string)
                                .or_else(|| l.get("name").and_then(|n| n.as_str()).map(str::to_string))
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            assignees: item
                .get("assignees")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| {
                            a.get("username")
                                .and_then(|v| v.as_str())
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            updated_at: item
                .get("updated_at")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            draft: item
                .get("draft")
                .or_else(|| item.get("work_in_progress"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            merged_at: item
                .get("merged_at")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            source_branch: item
                .get("source_branch")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            target_branch: item
                .get("target_branch")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
        })
        .collect())
}

// ─── URL encoding ────────────────────────────────────────────────────────────

/// URL-encode a GitLab project path for use in API URLs.
/// "group/project" becomes "group%2Fproject".
fn url_encode_project(project: &str) -> String {
    project.replace('/', "%2F")
}

// ─── Resolve GitLab project from codebase ────────────────────────────────────

/// Try to resolve a GitLab project path from a codebase's source URL or local repo path.
pub fn resolve_gitlab_project_for_codebase(
    source_url: Option<&str>,
    repo_path: Option<&str>,
) -> Option<String> {
    source_url
        .and_then(parse_gitlab_project)
        .or_else(|| {
            let repo_path = repo_path?;
            let output = crate::git::git_command()
                .args(["config", "--get", "remote.origin.url"])
                .current_dir(repo_path)
                .output()
                .ok()?;

            if !output.status.success() {
                return None;
            }

            let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
            parse_gitlab_project(&remote)
        })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{gitlab_access_status, parse_gitlab_project, resolve_gitlab_token};
    use std::env;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let previous = env::var(key).ok();
            unsafe { env::set_var(key, value) };
            Self { key, previous }
        }

        fn remove(key: &'static str) -> Self {
            let previous = env::var(key).ok();
            unsafe { env::remove_var(key) };
            Self { key, previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.previous {
                    Some(prev) => env::set_var(self.key, prev),
                    None => env::remove_var(self.key),
                }
            }
        }
    }

    // ── parse_gitlab_project ────────────────────────────────────────────

    #[test]
    fn parse_https_gitlab_com_url() {
        assert_eq!(
            parse_gitlab_project("https://gitlab.com/mygroup/myproject"),
            Some("mygroup/myproject".to_string())
        );
    }

    #[test]
    fn parse_https_gitlab_com_url_with_git_suffix() {
        assert_eq!(
            parse_gitlab_project("https://gitlab.com/mygroup/myproject.git"),
            Some("mygroup/myproject".to_string())
        );
    }

    #[test]
    fn parse_ssh_git_url() {
        assert_eq!(
            parse_gitlab_project("git@gitlab.com:mygroup/myproject.git"),
            Some("mygroup/myproject".to_string())
        );
    }

    #[test]
    fn parse_self_hosted_url() {
        assert_eq!(
            parse_gitlab_project("https://gitlab.mycompany.com/group/subgroup/project"),
            Some("group/subgroup/project".to_string())
        );
    }

    #[test]
    fn parse_bare_project_path() {
        assert_eq!(
            parse_gitlab_project("group/project"),
            Some("group/project".to_string())
        );
    }

    #[test]
    fn parse_rejects_single_segment() {
        assert_eq!(parse_gitlab_project("just-a-name"), None);
    }

    #[test]
    fn parse_rejects_empty() {
        assert_eq!(parse_gitlab_project(""), None);
    }

    // ── resolve_gitlab_token ────────────────────────────────────────────

    #[test]
    fn token_prefers_board_token_over_env() {
        let _lock = env_lock().lock().expect("env lock");
        let _env = EnvGuard::set("GITLAB_TOKEN", "env-token");

        assert_eq!(
            resolve_gitlab_token(Some(" board-token ")),
            Some("board-token".to_string())
        );
    }

    #[test]
    fn token_falls_back_to_env() {
        let _lock = env_lock().lock().expect("env lock");
        let _env = EnvGuard::set("GITLAB_TOKEN", "env-token");

        assert_eq!(
            resolve_gitlab_token(Some("   ")),
            Some("env-token".to_string())
        );
    }

    #[test]
    fn token_returns_none_when_nothing_set() {
        let _lock = env_lock().lock().expect("env lock");
        let _env = EnvGuard::remove("GITLAB_TOKEN");

        assert_eq!(resolve_gitlab_token(None), None);
    }

    // ── gitlab_access_status ────────────────────────────────────────────

    #[test]
    fn access_status_board_token() {
        let _lock = env_lock().lock().expect("env lock");
        let _env = EnvGuard::remove("GITLAB_TOKEN");

        assert_eq!(
            gitlab_access_status(Some("glpat-xxx")),
            ("board", true)
        );
    }

    #[test]
    fn access_status_env_token() {
        let _lock = env_lock().lock().expect("env lock");
        let _env = EnvGuard::set("GITLAB_TOKEN", "glpat-xxx");

        assert_eq!(gitlab_access_status(None), ("env", true));
    }

    #[test]
    fn access_status_none() {
        let _lock = env_lock().lock().expect("env lock");
        let _env = EnvGuard::remove("GITLAB_TOKEN");

        assert_eq!(gitlab_access_status(None), ("none", false));
    }
}
