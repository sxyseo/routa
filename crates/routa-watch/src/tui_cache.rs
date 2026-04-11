use super::*;
use ratatui::text::Text;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

#[derive(Clone, Debug, Default)]
pub(super) struct DiffStatSummary {
    pub(super) status: String,
    pub(super) additions: Option<usize>,
    pub(super) deletions: Option<usize>,
}

#[derive(Clone, Debug)]
pub(super) struct DetailCacheEntry {
    pub(super) key: String,
    pub(super) text: String,
}

#[derive(Clone, Debug)]
pub(super) struct FileFactsEntry {
    pub(super) key: String,
    pub(super) entry_kind: crate::models::EntryKind,
    pub(super) line_count: usize,
    pub(super) byte_size: u64,
    pub(super) child_count: Option<usize>,
    pub(super) git_change_count: usize,
}

#[derive(Debug)]
enum BackgroundCommand {
    RefreshStats {
        repo_root: String,
        files: Vec<(String, String, i64)>,
    },
    LoadDetail {
        repo_root: String,
        rel_path: String,
        state_code: String,
        version: i64,
        mode: DetailMode,
    },
    LoadFacts {
        repo_root: String,
        rel_path: String,
        version: i64,
    },
}

#[derive(Debug)]
enum BackgroundResult {
    Stats {
        entries: Vec<(String, DiffStatSummary)>,
    },
    Detail {
        entry: DetailCacheEntry,
        mode: DetailMode,
    },
    Facts {
        entry: FileFactsEntry,
    },
}

#[derive(Debug, Default)]
struct PendingCommands {
    stats: Option<PendingStats>,
    detail: Option<PendingDetail>,
    facts: Option<PendingFacts>,
}

type PendingStats = (String, Vec<(String, String, i64)>);
type PendingDetail = (String, String, String, i64, DetailMode);
type PendingFacts = (String, String, i64);

pub(super) struct AppCache {
    pub(super) diff_stats: BTreeMap<String, DiffStatSummary>,
    pub(super) preview_cache: BTreeMap<String, DetailCacheEntry>,
    pub(super) diff_cache: BTreeMap<String, DetailCacheEntry>,
    pub(super) facts_cache: BTreeMap<String, FileFactsEntry>,
    highlighted_detail_cache: BTreeMap<String, Text<'static>>,
    pending_stats_signature: Option<String>,
    pending_preview_key: Option<String>,
    pending_diff_key: Option<String>,
    pending_facts_key: Option<String>,
    worker_tx: Sender<BackgroundCommand>,
    worker_rx: Receiver<BackgroundResult>,
}

impl AppCache {
    pub(super) fn new() -> Self {
        let (worker_tx, worker_rx_cmd) = mpsc::channel();
        let (result_tx, worker_rx) = mpsc::channel();
        thread::spawn(move || background_worker(worker_rx_cmd, result_tx));
        Self {
            diff_stats: BTreeMap::new(),
            preview_cache: BTreeMap::new(),
            diff_cache: BTreeMap::new(),
            facts_cache: BTreeMap::new(),
            highlighted_detail_cache: BTreeMap::new(),
            pending_stats_signature: None,
            pending_preview_key: None,
            pending_diff_key: None,
            pending_facts_key: None,
            worker_tx,
            worker_rx,
        }
    }

    pub(super) fn sync_results(&mut self) {
        while let Ok(result) = self.worker_rx.try_recv() {
            match result {
                BackgroundResult::Stats { entries } => {
                    self.diff_stats.extend(entries);
                    self.pending_stats_signature = None;
                }
                BackgroundResult::Detail { entry, mode } => match mode {
                    DetailMode::File => {
                        self.highlighted_detail_cache
                            .retain(|key, _| !key.starts_with(&entry.key));
                        self.preview_cache.insert(entry.key.clone(), entry);
                        self.pending_preview_key = None;
                    }
                    DetailMode::Diff => {
                        self.highlighted_detail_cache
                            .retain(|key, _| !key.starts_with(&entry.key));
                        self.diff_cache.insert(entry.key.clone(), entry);
                        self.pending_diff_key = None;
                    }
                },
                BackgroundResult::Facts { entry } => {
                    self.facts_cache.insert(entry.key.clone(), entry);
                    self.pending_facts_key = None;
                }
            }
        }
    }

    pub(super) fn warm_visible_files(&mut self, state: &RuntimeState) {
        let files: Vec<(String, String, i64)> = state
            .file_items()
            .iter()
            .take(24)
            .map(|file| {
                (
                    file.rel_path.clone(),
                    file.state_code.clone(),
                    file.last_modified_at_ms,
                )
            })
            .collect();
        if files.is_empty() {
            self.pending_stats_signature = None;
            return;
        }
        let signature = files
            .iter()
            .map(|(path, code, version)| format!("{path}:{code}:{version}"))
            .collect::<Vec<_>>()
            .join("|");
        if self.pending_stats_signature.as_deref() == Some(signature.as_str()) {
            return;
        }
        let _ = self.worker_tx.send(BackgroundCommand::RefreshStats {
            repo_root: state.repo_root.clone(),
            files,
        });
        self.pending_stats_signature = Some(signature);
    }

    pub(super) fn warm_selected_detail(&mut self, state: &RuntimeState) {
        let Some(file) = state.selected_file() else {
            self.pending_preview_key = None;
            self.pending_diff_key = None;
            self.pending_facts_key = None;
            return;
        };
        let active_key = detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            state.detail_mode,
        );
        let active_loaded = match state.detail_mode {
            DetailMode::File => self.preview_cache.contains_key(&active_key),
            DetailMode::Diff => self.diff_cache.contains_key(&active_key),
        };
        let active_pending = match state.detail_mode {
            DetailMode::File => self.pending_preview_key.as_deref() == Some(active_key.as_str()),
            DetailMode::Diff => self.pending_diff_key.as_deref() == Some(active_key.as_str()),
        };
        if !active_loaded && !active_pending {
            let _ = self.worker_tx.send(BackgroundCommand::LoadDetail {
                repo_root: state.repo_root.clone(),
                rel_path: file.rel_path.clone(),
                state_code: file.state_code.clone(),
                version: file.last_modified_at_ms,
                mode: state.detail_mode,
            });
            match state.detail_mode {
                DetailMode::File => self.pending_preview_key = Some(active_key),
                DetailMode::Diff => self.pending_diff_key = Some(active_key),
            }
        }

        let facts_key = facts_cache_key(&file.rel_path, file.last_modified_at_ms);
        if !self.facts_cache.contains_key(&facts_key)
            && self.pending_facts_key.as_deref() != Some(facts_key.as_str())
        {
            let _ = self.worker_tx.send(BackgroundCommand::LoadFacts {
                repo_root: state.repo_root.clone(),
                rel_path: file.rel_path.clone(),
                version: file.last_modified_at_ms,
            });
            self.pending_facts_key = Some(facts_key);
        }
    }

    pub(super) fn diff_stat<'a>(
        &'a self,
        file: &crate::models::FileView,
    ) -> Option<&'a DiffStatSummary> {
        self.diff_stats.get(&diff_stat_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
        ))
    }

    pub(super) fn detail_text(
        &self,
        file: &crate::models::FileView,
        mode: DetailMode,
    ) -> Option<&str> {
        let key = detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            mode,
        );
        match mode {
            DetailMode::File => self
                .preview_cache
                .get(&key)
                .map(|entry| entry.text.as_str()),
            DetailMode::Diff => self.diff_cache.get(&key).map(|entry| entry.text.as_str()),
        }
    }

    pub(super) fn file_facts(&self, file: &crate::models::FileView) -> Option<&FileFactsEntry> {
        self.facts_cache
            .get(&facts_cache_key(&file.rel_path, file.last_modified_at_ms))
    }

    pub(super) fn highlighted_detail_text(
        &mut self,
        file: &crate::models::FileView,
        mode: DetailMode,
        theme_mode: ThemeMode,
    ) -> Option<&Text<'static>> {
        let render_key = format!(
            "{}:{}:{:?}:{:?}",
            file.rel_path, file.last_modified_at_ms, mode, theme_mode
        );
        if !self.highlighted_detail_cache.contains_key(&render_key) {
            let raw = self.detail_text(file, mode)?;
            let rendered = match mode {
                DetailMode::File => {
                    super::highlight::highlight_code_text(Some(&file.rel_path), raw, theme_mode)
                }
                DetailMode::Diff => {
                    super::highlight::highlight_diff_text(Some(&file.rel_path), raw, theme_mode)
                }
            };
            self.highlighted_detail_cache
                .insert(render_key.clone(), rendered);
        }
        self.highlighted_detail_cache.get(&render_key)
    }
}

pub(super) fn diff_stat_key(rel_path: &str, state_code: &str, version: i64) -> String {
    format!("{rel_path}:{state_code}:{version}")
}

pub(super) fn detail_cache_key(
    rel_path: &str,
    state_code: &str,
    version: i64,
    mode: DetailMode,
) -> String {
    format!("{rel_path}:{state_code}:{version}:{mode:?}")
}

pub(super) fn facts_cache_key(rel_path: &str, version: i64) -> String {
    format!("{rel_path}:{version}:facts")
}

pub(super) fn short_state_code(state_code: &str) -> &'static str {
    match state_code {
        "delete" => "D",
        "add" | "untracked" => "A",
        "rename" => "R",
        _ => "M",
    }
}

pub(super) fn display_status_code(file: &crate::models::FileView) -> String {
    if file.entry_kind.is_directory() {
        "DIR".to_string()
    } else {
        short_state_code(&file.state_code).to_string()
    }
}

fn compute_diff_stat(repo_root: &str, rel_path: &str, state_code: &str) -> DiffStatSummary {
    let status = if std::fs::metadata(Path::new(repo_root).join(rel_path))
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        "DIR".to_string()
    } else {
        short_state_code(state_code).to_string()
    };
    let path = Path::new(repo_root).join(rel_path);

    if std::fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        return DiffStatSummary {
            status,
            additions: None,
            deletions: None,
        };
    }

    if state_code == "untracked" || state_code == "add" {
        let added = std::fs::read_to_string(path)
            .ok()
            .map(|text| text.lines().count())
            .unwrap_or(0);
        return DiffStatSummary {
            status,
            additions: Some(added),
            deletions: None,
        };
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--numstat")
        .arg("--")
        .arg(rel_path)
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                if let Some(line) = stdout.lines().find(|line| !line.trim().is_empty()) {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() >= 2 {
                        let add = cols[0];
                        let del = cols[1];
                        if add == "-" || del == "-" {
                            return DiffStatSummary {
                                status,
                                additions: None,
                                deletions: None,
                            };
                        }
                        let add_num = add.parse::<usize>().unwrap_or(0);
                        let del_num = del.parse::<usize>().unwrap_or(0);
                        return match (add_num, del_num) {
                            (0, 0) => DiffStatSummary {
                                status,
                                additions: None,
                                deletions: None,
                            },
                            (0, d) => DiffStatSummary {
                                status,
                                additions: None,
                                deletions: Some(d),
                            },
                            (a, 0) => DiffStatSummary {
                                status,
                                additions: Some(a),
                                deletions: None,
                            },
                            (a, d) => DiffStatSummary {
                                status,
                                additions: Some(a),
                                deletions: Some(d),
                            },
                        };
                    }
                }
            }
        }
    }

    DiffStatSummary {
        status,
        additions: None,
        deletions: None,
    }
}

#[cfg(test)]
mod tests {
    use super::display_status_code;
    use crate::models::{AttributionConfidence, EntryKind, FileView};
    use std::collections::BTreeSet;

    #[test]
    fn directory_entries_use_dir_status_label() {
        let file = FileView {
            rel_path: ".kiro/skills/developer-onboarding".to_string(),
            dirty: true,
            state_code: "untracked".to_string(),
            entry_kind: EntryKind::Directory,
            last_modified_at_ms: 0,
            last_session_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: Vec::new(),
        };

        assert_eq!(display_status_code(&file), "DIR");
    }
}

fn background_worker(rx: Receiver<BackgroundCommand>, tx: Sender<BackgroundResult>) {
    while let Ok(command) = rx.recv() {
        let mut pending = PendingCommands::default();
        queue_command(&mut pending, command);
        while let Ok(next) = rx.try_recv() {
            queue_command(&mut pending, next);
        }
        if let Some((repo_root, files)) = pending.stats.take() {
            let mut seen = BTreeSet::new();
            let entries = files
                .into_iter()
                .filter_map(|(rel_path, state_code, version)| {
                    let key = diff_stat_key(&rel_path, &state_code, version);
                    if !seen.insert(key.clone()) {
                        return None;
                    }
                    Some((key, compute_diff_stat(&repo_root, &rel_path, &state_code)))
                })
                .collect::<Vec<_>>();
            let _ = tx.send(BackgroundResult::Stats { entries });
        }
        if let Some((repo_root, rel_path, state_code, version, mode)) = pending.detail.take() {
            let text = match mode {
                DetailMode::File => load_file_preview(&repo_root, rel_path.as_str())
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "<no file content available>".to_string()),
                DetailMode::Diff => {
                    load_diff_text(&repo_root, rel_path.as_str(), state_code.as_str())
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "<no diff available>".to_string())
                }
            };
            let _ = tx.send(BackgroundResult::Detail {
                entry: DetailCacheEntry {
                    key: detail_cache_key(&rel_path, &state_code, version, mode),
                    text,
                },
                mode,
            });
        }
        if let Some((repo_root, rel_path, version)) = pending.facts.take() {
            let _ = tx.send(BackgroundResult::Facts {
                entry: load_file_facts(&repo_root, &rel_path, version),
            });
        }
    }
}

fn queue_command(pending: &mut PendingCommands, command: BackgroundCommand) {
    match command {
        BackgroundCommand::RefreshStats { repo_root, files } => {
            pending.stats = Some((repo_root, files));
        }
        BackgroundCommand::LoadDetail {
            repo_root,
            rel_path,
            state_code,
            version,
            mode,
        } => {
            pending.detail = Some((repo_root, rel_path, state_code, version, mode));
        }
        BackgroundCommand::LoadFacts {
            repo_root,
            rel_path,
            version,
        } => {
            pending.facts = Some((repo_root, rel_path, version));
        }
    }
}

fn load_file_facts(repo_root: &str, rel_path: &str, version: i64) -> FileFactsEntry {
    let path = Path::new(repo_root).join(rel_path);
    let entry_kind = if std::fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        crate::models::EntryKind::Directory
    } else {
        crate::models::EntryKind::File
    };
    let content = std::fs::read_to_string(&path).ok();
    let line_count = if entry_kind.is_directory() {
        0
    } else {
        content
            .as_ref()
            .map(|text| text.lines().count())
            .unwrap_or(0)
    };
    let byte_size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let child_count = if entry_kind.is_directory() {
        std::fs::read_dir(&path).ok().map(|entries| entries.count())
    } else {
        None
    };
    FileFactsEntry {
        key: facts_cache_key(rel_path, version),
        entry_kind,
        line_count,
        byte_size,
        child_count,
        git_change_count: git_file_change_count(repo_root, rel_path).unwrap_or(0),
    }
}

fn git_file_change_count(repo_root: &str, rel_path: &str) -> Option<usize> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("log")
        .arg("--follow")
        .arg("--format=%H")
        .arg("--")
        .arg(rel_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    Some(
        stdout
            .lines()
            .filter(|line| !line.trim().is_empty())
            .count(),
    )
}

pub(super) fn load_diff_text(
    repo_root: &str,
    rel_path: &str,
    state_code: &str,
) -> Result<Option<String>> {
    let path = Path::new(repo_root).join(rel_path);
    if std::fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        let child_count = std::fs::read_dir(&path)
            .ok()
            .map(|entries| entries.count())
            .unwrap_or(0);
        return Ok(Some(format!(
            "<directory: {} entries>\n{}",
            child_count, rel_path
        )));
    }
    if state_code == "untracked" {
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path).context("read untracked file")?;
        let mut out = Vec::new();
        out.push(format!("+++ {}", rel_path));
        for line in content.lines().take(200) {
            out.push(format!("+{line}"));
        }
        return Ok(Some(out.join("\n")));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--no-ext-diff")
        .arg("--no-color")
        .arg("--")
        .arg(rel_path)
        .output()
        .context("run git diff")?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8(output.stdout).context("decode git diff output")?;
    if text.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

fn load_file_preview(repo_root: &str, rel_path: &str) -> Result<Option<String>> {
    let path = Path::new(repo_root).join(rel_path);
    if !path.exists() {
        return Ok(None);
    }
    if std::fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        let mut entries = std::fs::read_dir(&path)
            .context("read directory preview")?
            .filter_map(|entry| entry.ok())
            .map(|entry| {
                let mut name = entry.file_name().to_string_lossy().to_string();
                if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                    name.push('/');
                }
                name
            })
            .collect::<Vec<_>>();
        entries.sort();
        let preview = if entries.is_empty() {
            "<directory is empty>".to_string()
        } else {
            entries.into_iter().take(200).collect::<Vec<_>>().join("\n")
        };
        return Ok(Some(preview));
    }
    let content = std::fs::read_to_string(path).context("read file preview")?;
    let truncated = content.lines().take(400).collect::<Vec<_>>().join("\n");
    Ok(Some(truncated))
}
