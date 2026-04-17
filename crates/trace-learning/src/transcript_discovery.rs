use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TranscriptSessionSource {
    Codex,
    ClaudeProjects,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TranscriptSessionRoot {
    pub kind: TranscriptSessionSource,
    pub path: PathBuf,
}

pub fn discover_transcript_session_roots() -> Vec<TranscriptSessionRoot> {
    let home_dir = std::env::var_os("HOME").map(PathBuf::from);
    let claude_config_dir = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from);

    discover_transcript_session_roots_with_overrides(
        home_dir.as_deref(),
        claude_config_dir.as_deref(),
    )
}

pub fn discover_transcript_session_roots_with_overrides(
    home_dir: Option<&Path>,
    claude_config_dir: Option<&Path>,
) -> Vec<TranscriptSessionRoot> {
    let mut roots = Vec::new();

    if let Some(home_dir) = home_dir {
        let codex_root = home_dir.join(".codex").join("sessions");
        if codex_root.exists() {
            roots.push(TranscriptSessionRoot {
                kind: TranscriptSessionSource::Codex,
                path: codex_root,
            });
        }
    }

    let Some(claude_config_dir) = claude_config_dir
        .map(|path| path.to_path_buf())
        .or_else(|| home_dir.map(|home| home.join(".claude")))
    else {
        return roots;
    };

    let claude_projects_root = claude_config_dir.join("projects");
    if claude_projects_root.exists() {
        roots.push(TranscriptSessionRoot {
            kind: TranscriptSessionSource::ClaudeProjects,
            path: claude_projects_root,
        });
    }

    roots
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn prefers_override_for_claude_config_dir() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let custom_claude_root = dir.path().join("custom-claude").join("config");
        let codex_root = home.join(".codex").join("sessions");
        let default_claude_root = home.join(".claude").join("projects");
        let override_claude_root = custom_claude_root.join("projects");

        std::fs::create_dir_all(&codex_root).expect("create codex root");
        std::fs::create_dir_all(&default_claude_root).expect("create default claude projects root");
        std::fs::create_dir_all(&override_claude_root)
            .expect("create override claude projects root");

        let roots = discover_transcript_session_roots_with_overrides(
            Some(&home),
            Some(&custom_claude_root),
        );

        assert!(roots
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::Codex && root.path == codex_root));
        assert!(roots
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::ClaudeProjects
                && root.path == override_claude_root));
        assert!(!roots.iter().any(|root| {
            root.kind == TranscriptSessionSource::ClaudeProjects && root.path == default_claude_root
        }));
    }
}
