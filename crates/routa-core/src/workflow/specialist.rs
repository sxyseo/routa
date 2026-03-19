//! Specialist definition — load specialist prompts from YAML files.
//!
//! Specialists can be defined in YAML format (like the existing `.md` files
//! with frontmatter, but fully in YAML for the Rust workflow engine).
//!
//! ```yaml
//! name: "Implementor"
//! id: "crafter"
//! description: "Executes implementation tasks, writes code"
//! role: "CRAFTER"
//! model_tier: "smart"
//! role_reminder: "Stay within task scope."
//! system_prompt: |
//!   ## Crafter (Implementor)
//!   Implement your assigned task — nothing more, nothing less.
//!   ...
//! ```

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecialistExecutionDef {
    /// Default agent role override.
    #[serde(default)]
    pub role: Option<String>,
    /// Default ACP provider to use when executing this specialist directly.
    #[serde(default)]
    pub provider: Option<String>,
    /// Default adapter/runtime hint for workflow execution.
    #[serde(default)]
    pub adapter: Option<String>,
    /// Default model tier.
    #[serde(default, alias = "modelTier")]
    pub model_tier: Option<String>,
    /// Default model override.
    #[serde(default)]
    pub model: Option<String>,
}

/// A specialist agent definition loaded from YAML.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialistDef {
    /// Specialist ID (e.g., "crafter", "gate", "routa")
    pub id: String,

    /// Display name
    pub name: String,

    /// Description of what this specialist does
    #[serde(default)]
    pub description: Option<String>,

    /// Agent role: ROUTA, CRAFTER, GATE, DEVELOPER
    #[serde(default = "default_role")]
    pub role: String,

    /// Model tier: fast, smart, reasoning
    #[serde(default = "default_model_tier")]
    pub model_tier: String,

    /// The system prompt for this specialist
    pub system_prompt: String,

    /// A brief reminder appended to messages
    #[serde(default)]
    pub role_reminder: Option<String>,

    /// Structured execution defaults.
    #[serde(default)]
    pub execution: SpecialistExecutionDef,

    /// Default ACP provider for direct execution.
    #[serde(default)]
    pub default_provider: Option<String>,

    /// Default adapter type to use with this specialist
    #[serde(default)]
    pub default_adapter: Option<String>,

    /// Default model to use
    #[serde(default)]
    pub default_model: Option<String>,

    /// Custom metadata
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

fn default_role() -> String {
    "DEVELOPER".to_string()
}

fn default_model_tier() -> String {
    "smart".to_string()
}

fn is_locale_directory_name(name: &str) -> bool {
    if name == "locales" {
        return true;
    }

    let mut parts = name.split('-');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(lang), None, None) => lang.len() == 2 && lang.chars().all(|c| c.is_ascii_lowercase()),
        (Some(lang), Some(region), None) => {
            lang.len() == 2
                && lang.chars().all(|c| c.is_ascii_lowercase())
                && region.len() == 2
                && region.chars().all(|c| c.is_ascii_uppercase())
        }
        _ => false,
    }
}

impl SpecialistDef {
    fn normalize_execution(mut self) -> Self {
        if let Some(role) = self.execution.role.clone() {
            self.role = role;
        }
        if let Some(model_tier) = self.execution.model_tier.clone() {
            self.model_tier = model_tier;
        }
        if let Some(provider) = self.execution.provider.clone() {
            self.default_provider = Some(provider);
        }
        if let Some(adapter) = self.execution.adapter.clone() {
            self.default_adapter = Some(adapter);
        }
        if let Some(model) = self.execution.model.clone() {
            self.default_model = Some(model);
        }
        self
    }

    /// Parse a specialist definition from a YAML string.
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        let parsed: Self = serde_yaml::from_str(yaml)
            .map_err(|e| format!("Failed to parse specialist YAML: {}", e))?;
        Ok(parsed.normalize_execution())
    }

    /// Load a specialist definition from a YAML file.
    pub fn from_file(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read specialist file '{}': {}", path, e))?;
        Self::from_yaml(&content)
    }

    /// Parse a specialist from an existing Markdown file with YAML frontmatter.
    /// (Compatibility with the `resources/specialists/*.md` format)
    pub fn from_markdown(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read specialist markdown '{}': {}", path, e))?;

        // Parse YAML frontmatter between --- delimiters
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() < 3 {
            return Err(format!(
                "Invalid specialist markdown '{}': missing YAML frontmatter",
                path
            ));
        }

        let frontmatter = parts[1].trim();
        let body = parts[2].trim();

        // Parse the frontmatter
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct FrontMatter {
            name: String,
            description: Option<String>,
            model_tier: Option<String>,
            role: Option<String>,
            role_reminder: Option<String>,
            default_provider: Option<String>,
            default_adapter: Option<String>,
            default_model: Option<String>,
            execution: Option<SpecialistExecutionDef>,
        }

        let fm: FrontMatter = serde_yaml::from_str(frontmatter)
            .map_err(|e| format!("Failed to parse frontmatter in '{}': {}", path, e))?;

        // Derive ID from filename
        let id = Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let execution = fm.execution.unwrap_or_default();

        Ok(Self {
            id,
            name: fm.name,
            description: fm.description,
            role: execution
                .role
                .clone()
                .or(fm.role)
                .unwrap_or_else(|| "DEVELOPER".to_string()),
            model_tier: execution
                .model_tier
                .clone()
                .or(fm.model_tier)
                .unwrap_or_else(|| "smart".to_string()),
            system_prompt: body.to_string(),
            role_reminder: fm.role_reminder,
            execution: execution.clone(),
            default_provider: execution.provider.clone().or(fm.default_provider),
            default_adapter: execution.adapter.clone().or(fm.default_adapter),
            default_model: execution.model.clone().or(fm.default_model),
            metadata: HashMap::new(),
        })
    }

    /// Load a specialist definition from a path, inferring format by extension.
    pub fn from_path(path: &str) -> Result<Self, String> {
        match Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
        {
            "yaml" | "yml" => Self::from_file(path),
            "md" => Self::from_markdown(path),
            _ => Err(format!(
                "Unsupported specialist file '{}'. Expected .md, .yaml, or .yml",
                path
            )),
        }
    }
}

/// Loads specialist definitions from a directory.
pub struct SpecialistLoader {
    /// Loaded specialists indexed by ID
    pub specialists: HashMap<String, SpecialistDef>,
}

impl Default for SpecialistLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl SpecialistLoader {
    pub fn new() -> Self {
        Self {
            specialists: HashMap::new(),
        }
    }

    fn collect_specialist_paths(
        dir: &Path,
        include_locale_directories: bool,
        files: &mut Vec<PathBuf>,
    ) -> Result<(), String> {
        for entry in std::fs::read_dir(dir)
            .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?
        {
            let entry = entry.map_err(|e| format!("Directory entry error: {}", e))?;
            let path = entry.path();

            if path.is_dir() {
                let should_skip = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| !include_locale_directories && is_locale_directory_name(name))
                    .unwrap_or(false);
                if should_skip {
                    continue;
                }
                Self::collect_specialist_paths(&path, include_locale_directories, files)?;
                continue;
            }

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "yaml" | "yml" | "md") {
                files.push(path);
            }
        }

        Ok(())
    }

    /// Load all specialists from a directory.
    /// Supports both `.yaml`/`.yml` and `.md` (markdown with frontmatter) files.
    /// YAML is loaded after Markdown so migrated runtime definitions can
    /// override legacy Markdown compatibility files deterministically.
    pub fn load_dir(&mut self, dir: &str) -> Result<usize, String> {
        let dir_path = Path::new(dir);
        if !dir_path.is_dir() {
            return Err(format!("Specialist directory '{}' does not exist", dir));
        }

        let mut paths = Vec::new();
        Self::collect_specialist_paths(dir_path, false, &mut paths)?;
        paths.sort_by(|a, b| {
            let a_ext = a.extension().and_then(|e| e.to_str()).unwrap_or("");
            let b_ext = b.extension().and_then(|e| e.to_str()).unwrap_or("");
            let ext_rank = |ext: &str| match ext {
                "md" => 0,
                "yaml" | "yml" => 1,
                _ => 2,
            };

            ext_rank(a_ext)
                .cmp(&ext_rank(b_ext))
                .then_with(|| a.cmp(b))
        });

        let mut count = 0;
        let mut source_paths: HashMap<String, PathBuf> = HashMap::new();
        for path in paths {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

            let specialist = match ext {
                "yaml" | "yml" => SpecialistDef::from_file(path.to_str().unwrap_or(""))?,
                "md" => SpecialistDef::from_markdown(path.to_str().unwrap_or(""))?,
                _ => continue,
            };

            tracing::info!(
                "[SpecialistLoader] Loaded specialist: {} ({})",
                specialist.id,
                specialist.name
            );
            if let Some(previous_path) = source_paths.get(&specialist.id) {
                tracing::warn!(
                    "[SpecialistLoader] Duplicate specialist id '{}' in '{}'; overriding '{}' with '{}'",
                    specialist.id,
                    dir,
                    previous_path.display(),
                    path.display()
                );
            }
            source_paths.insert(specialist.id.clone(), path.clone());
            self.specialists.insert(specialist.id.clone(), specialist);
            count += 1;
        }

        Ok(count)
    }

    /// Get a specialist by ID.
    pub fn get(&self, id: &str) -> Option<&SpecialistDef> {
        self.specialists
            .get(id)
            .or_else(|| self.specialists.get(&id.to_lowercase()))
    }

    /// Get all loaded specialists.
    pub fn all(&self) -> &HashMap<String, SpecialistDef> {
        &self.specialists
    }

    /// Search directories for specialist files.
    /// Checks: `./specialists/`, `./resources/specialists/`, and custom paths.
    pub fn load_default_dirs(&mut self) -> usize {
        let mut total = 0;

        for dir in Self::default_search_paths() {
            if dir.is_dir() {
                let dir_str = dir.to_string_lossy().to_string();
                match self.load_dir(&dir_str) {
                    Ok(n) => {
                        tracing::info!(
                            "[SpecialistLoader] Loaded {} specialists from '{}'",
                            n,
                            dir_str
                        );
                        total += n;
                    }
                    Err(e) => {
                        tracing::warn!(
                            "[SpecialistLoader] Failed to load from '{}': {}",
                            dir_str,
                            e
                        );
                    }
                }
            }
        }

        total
    }

    /// Default search paths in precedence order.
    pub fn default_search_paths() -> Vec<PathBuf> {
        let mut search_paths = Vec::new();

        if let Some(home_dir) = dirs::home_dir() {
            search_paths.push(home_dir.join(".routa").join("specialists"));
        }

        search_paths.push(PathBuf::from("specialists"));
        search_paths.push(PathBuf::from("resources/specialists"));
        search_paths.push(PathBuf::from("../resources/specialists"));

        search_paths
    }

    /// Get built-in fallback specialists (hardcoded, no files needed).
    pub fn builtin_specialists() -> Vec<SpecialistDef> {
        vec![
            SpecialistDef {
                id: "developer".to_string(),
                name: "Developer".to_string(),
                description: Some("Plans then implements itself".to_string()),
                role: "DEVELOPER".to_string(),
                model_tier: "smart".to_string(),
                system_prompt: "You are a skilled software developer. Plan first, then implement. \
                    Write clean, minimal code that satisfies the requirements.\n\
                    When done, summarize what you did.".to_string(),
                role_reminder: Some("Plan first, implement minimally, summarize when done.".to_string()),
                execution: SpecialistExecutionDef::default(),
                default_provider: None,
                default_adapter: None,
                default_model: None,
                metadata: HashMap::new(),
            },
            SpecialistDef {
                id: "crafter".to_string(),
                name: "Implementor".to_string(),
                description: Some("Executes implementation tasks, writes code".to_string()),
                role: "CRAFTER".to_string(),
                model_tier: "fast".to_string(),
                system_prompt: "Implement the assigned task — nothing more, nothing less. \
                    Produce minimal, clean changes. Stay within scope.".to_string(),
                role_reminder: Some("Stay within task scope. No refactors, no scope creep.".to_string()),
                execution: SpecialistExecutionDef::default(),
                default_provider: None,
                default_adapter: None,
                default_model: None,
                metadata: HashMap::new(),
            },
            SpecialistDef {
                id: "gate".to_string(),
                name: "Verifier".to_string(),
                description: Some("Reviews work and verifies completeness".to_string()),
                role: "GATE".to_string(),
                model_tier: "smart".to_string(),
                system_prompt: "You verify the implementation against acceptance criteria. \
                    Be evidence-driven: if you can't point to concrete evidence, it's not verified. \
                    No partial approvals.".to_string(),
                role_reminder: Some("Verify against acceptance criteria ONLY. Be evidence-driven.".to_string()),
                execution: SpecialistExecutionDef::default(),
                default_provider: None,
                default_adapter: None,
                default_model: None,
                metadata: HashMap::new(),
            },
            SpecialistDef {
                id: "issue-refiner".to_string(),
                name: "Issue Refiner".to_string(),
                description: Some("Analyzes and refines requirements from issues".to_string()),
                role: "DEVELOPER".to_string(),
                model_tier: "smart".to_string(),
                system_prompt: "You analyze incoming issues and requirements. \
                    Break them down into clear, actionable tasks with acceptance criteria. \
                    Identify ambiguities and suggest clarifications.".to_string(),
                role_reminder: Some("Be specific about acceptance criteria and scope.".to_string()),
                execution: SpecialistExecutionDef::default(),
                default_provider: None,
                default_adapter: None,
                default_model: None,
                metadata: HashMap::new(),
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_specialist_yaml() {
        let yaml = r#"
id: "test-specialist"
name: "Test Specialist"
description: "A test specialist"
role: "DEVELOPER"
model_tier: "fast"
system_prompt: |
  You are a test specialist.
  Do test things.
role_reminder: "Stay on test."
"#;
        let spec = SpecialistDef::from_yaml(yaml).unwrap();
        assert_eq!(spec.id, "test-specialist");
        assert_eq!(spec.name, "Test Specialist");
        assert_eq!(spec.role, "DEVELOPER");
        assert!(spec.system_prompt.contains("test specialist"));
    }

    #[test]
    fn test_parse_specialist_yaml_execution() {
        let yaml = r#"
id: "cli-runner"
name: "CLI Runner"
execution:
  role: "CRAFTER"
  provider: "claude"
  model_tier: "smart"
  model: "sonnet-4.5"
system_prompt: |
  Run the task.
"#;

        let spec = SpecialistDef::from_yaml(yaml).unwrap();
        assert_eq!(spec.role, "CRAFTER");
        assert_eq!(spec.model_tier, "smart");
        assert_eq!(spec.default_provider.as_deref(), Some("claude"));
        assert_eq!(spec.default_model.as_deref(), Some("sonnet-4.5"));
    }

    #[test]
    fn test_parse_specialist_markdown_execution() {
        let temp_path = std::env::temp_dir().join(format!(
            "routa-specialist-{}.md",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(
            &temp_path,
            r#"---
name: "Markdown Specialist"
description: "Markdown execution test"
modelTier: "balanced"
role: "DEVELOPER"
execution:
  provider: "claude"
  role: "CRAFTER"
---

You are a markdown specialist.
"#,
        )
        .unwrap();

        let spec = SpecialistDef::from_markdown(temp_path.to_str().unwrap()).unwrap();
        assert_eq!(spec.role, "CRAFTER");
        assert_eq!(spec.default_provider.as_deref(), Some("claude"));
        assert!(spec.system_prompt.contains("markdown specialist"));

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn test_builtin_specialists() {
        let builtins = SpecialistLoader::builtin_specialists();
        assert!(builtins.len() >= 4);
        assert!(builtins.iter().any(|s| s.id == "developer"));
        assert!(builtins.iter().any(|s| s.id == "crafter"));
        assert!(builtins.iter().any(|s| s.id == "gate"));
        assert!(builtins.iter().any(|s| s.id == "issue-refiner"));
    }

    #[test]
    fn test_default_search_paths_include_workspace_and_user_dir() {
        let search_paths = SpecialistLoader::default_search_paths();
        assert!(search_paths
            .iter()
            .any(|path| path == Path::new("specialists")));
        assert!(search_paths
            .iter()
            .any(|path| path == Path::new("resources/specialists")));
    }

    #[test]
    fn test_load_dir_recurses_and_skips_locale_directories() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        std::fs::create_dir_all(root.join("core")).unwrap();
        std::fs::create_dir_all(root.join("review")).unwrap();
        std::fs::create_dir_all(root.join("zh-CN")).unwrap();
        std::fs::create_dir_all(root.join("locales").join("zh-CN")).unwrap();

        std::fs::write(
            root.join("core").join("developer.md"),
            r#"---
name: "Developer"
---

Developer prompt
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("review").join("gate.yaml"),
            r#"id: "gate"
name: "Gate"
system_prompt: "Gate prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("zh-CN").join("developer.md"),
            r#"---
name: "开发者"
---

中文 prompt
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("locales").join("zh-CN").join("gate.md"),
            r#"---
name: "验证者"
---

中文 gate
"#,
        )
        .unwrap();

        let mut loader = SpecialistLoader::new();
        loader.load_dir(root.to_str().unwrap()).unwrap();

        assert!(loader.get("developer").is_some());
        assert!(loader.get("gate").is_some());
        assert_eq!(loader.all().len(), 2);
    }

    #[test]
    fn test_load_dir_prefers_yaml_over_markdown_for_same_id() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        std::fs::write(
            root.join("developer.yaml"),
            r#"id: "developer"
name: "Developer YAML"
system_prompt: "yaml prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("developer.md"),
            r#"---
name: "Developer Markdown"
role: "DEVELOPER"
---

markdown prompt
"#,
        )
        .unwrap();

        let mut loader = SpecialistLoader::new();
        loader.load_dir(root.to_str().unwrap()).unwrap();

        let developer = loader.get("developer").unwrap();
        assert_eq!(developer.name, "Developer YAML");
        assert!(developer.system_prompt.contains("yaml prompt"));
    }
}
