use std::path::Path;
use std::process::Command;

use glob::Pattern;
use serde::Serialize;

const CODEOWNERS_CANDIDATES: &[&str] = &[".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

const SENSITIVE_PATH_PREFIXES: &[&str] = &[
    "src/core/acp/",
    "src/core/orchestration/",
    "crates/routa-server/src/api/",
];

const SENSITIVE_FILES: &[&str] = &[
    "api-contract.yaml",
    "docs/fitness/manifest.yaml",
    "docs/fitness/review-triggers.yaml",
    ".github/workflows/defense.yaml",
];

const MAX_REPORT_FILES: usize = 50;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeownersOwner {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeownersRule {
    pub pattern: String,
    pub owners: Vec<CodeownersOwner>,
    pub line: usize,
    pub precedence: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleResponse {
    pub pattern: String,
    pub owners: Vec<String>,
    pub line: usize,
    pub precedence: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerGroupSummary {
    pub name: String,
    pub kind: String,
    pub matched_file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageReport {
    pub unowned_files: Vec<String>,
    pub overlapping_files: Vec<String>,
    pub sensitive_unowned_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeownersResponse {
    pub generated_at: String,
    pub repo_root: String,
    pub codeowners_file: Option<String>,
    pub owners: Vec<OwnerGroupSummary>,
    pub rules: Vec<RuleResponse>,
    pub coverage: CoverageReport,
    pub warnings: Vec<String>,
}

fn classify_owner(raw: &str) -> CodeownersOwner {
    let trimmed = raw.trim();
    let kind = if trimmed.contains('@') && trimmed.contains('/') {
        "team"
    } else if trimmed.contains('@') && trimmed.contains('.') {
        "email"
    } else {
        "user"
    };
    CodeownersOwner {
        name: trimmed.to_string(),
        kind: kind.to_string(),
    }
}

pub fn parse_codeowners_content(content: &str) -> (Vec<CodeownersRule>, Vec<String>) {
    let mut rules = Vec::new();
    let mut warnings = Vec::new();

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if tokens.len() < 2 {
            warnings.push(format!("Line {}: pattern without owners — \"{}\"", i + 1, trimmed));
            continue;
        }

        let pattern = tokens[0].to_string();
        let owners: Vec<CodeownersOwner> = tokens[1..].iter().map(|t| classify_owner(t)).collect();
        let precedence = rules.len();

        rules.push(CodeownersRule {
            pattern,
            owners,
            line: i + 1,
            precedence,
        });
    }

    (rules, warnings)
}

fn normalize_pattern(pattern: &str) -> String {
    if let Some(stripped) = pattern.strip_prefix('/') {
        stripped.to_string()
    } else if !pattern.contains('/') {
        format!("**/{pattern}")
    } else {
        pattern.to_string()
    }
}

fn match_file(file_path: &str, pattern: &str) -> bool {
    let normalized = normalize_pattern(pattern);
    let is_dir = pattern.ends_with('/');
    let match_pattern = if is_dir {
        format!("{normalized}**")
    } else {
        normalized
    };

    let dir_variant = if !match_pattern.ends_with("/**") {
        Some(format!("{match_pattern}/**"))
    } else {
        None
    };

    Pattern::new(&match_pattern)
        .map(|p| p.matches(file_path))
        .unwrap_or(false)
        || dir_variant
            .as_deref()
            .and_then(|p| Pattern::new(p).ok())
            .map(|p| p.matches(file_path))
            .unwrap_or(false)
}

fn best_matching_rule(file_path: &str, rules: &[CodeownersRule]) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (i, rule) in rules.iter().enumerate() {
        if match_file(file_path, &rule.pattern) {
            match best {
                Some(prev) if rules[prev].precedence < rule.precedence => best = Some(i),
                None => best = Some(i),
                _ => {}
            }
        }
    }
    best
}

fn count_matching_rules(file_path: &str, rules: &[CodeownersRule]) -> usize {
    rules
        .iter()
        .filter(|rule| match_file(file_path, &rule.pattern))
        .count()
}

fn is_sensitive(file_path: &str) -> bool {
    SENSITIVE_PATH_PREFIXES
        .iter()
        .any(|prefix| file_path.starts_with(prefix))
        || SENSITIVE_FILES.contains(&file_path)
}

fn collect_tracked_files(repo_root: &Path, warnings: &mut Vec<String>) -> Vec<String> {
    let output = Command::new("git")
        .args(["ls-files"])
        .current_dir(repo_root)
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout
                .lines()
                .filter(|line| !line.is_empty())
                .map(ToString::to_string)
                .collect()
        }
        _ => {
            warnings.push(
                "Failed to list git-tracked files. Coverage analysis may be incomplete.".to_string(),
            );
            Vec::new()
        }
    }
}

pub fn detect_codeowners(repo_root: &Path) -> Result<CodeownersResponse, String> {
    let mut warnings = Vec::new();

    let codeowners_file = CODEOWNERS_CANDIDATES
        .iter()
        .find(|candidate| repo_root.join(candidate).is_file())
        .map(|s| s.to_string());

    let Some(ref codeowners_path) = codeowners_file else {
        return Ok(CodeownersResponse {
            generated_at: chrono::Utc::now().to_rfc3339(),
            repo_root: repo_root.display().to_string(),
            codeowners_file: None,
            owners: Vec::new(),
            rules: Vec::new(),
            coverage: CoverageReport {
                unowned_files: Vec::new(),
                overlapping_files: Vec::new(),
                sensitive_unowned_files: Vec::new(),
            },
            warnings: vec![format!(
                "No CODEOWNERS file found. Checked: {}",
                CODEOWNERS_CANDIDATES.join(", ")
            )],
        });
    };

    let content = std::fs::read_to_string(repo_root.join(codeowners_path))
        .map_err(|e| format!("Failed to read {codeowners_path}: {e}"))?;

    let (rules, parse_warnings) = parse_codeowners_content(&content);
    warnings.extend(parse_warnings);

    let tracked_files = collect_tracked_files(repo_root, &mut warnings);

    let mut owner_counts: std::collections::HashMap<String, (String, usize)> =
        std::collections::HashMap::new();
    let mut unowned_files = Vec::new();
    let mut overlapping_files = Vec::new();
    let mut sensitive_unowned_files = Vec::new();

    for file in &tracked_files {
        let matching_count = count_matching_rules(file, &rules);
        let best = best_matching_rule(file, &rules);

        if matching_count > 1 {
            overlapping_files.push(file.clone());
        }

        match best {
            Some(idx) => {
                for owner in &rules[idx].owners {
                    let entry = owner_counts
                        .entry(owner.name.clone())
                        .or_insert_with(|| (owner.kind.clone(), 0));
                    entry.1 += 1;
                }
            }
            None => {
                unowned_files.push(file.clone());
                if is_sensitive(file) {
                    sensitive_unowned_files.push(file.clone());
                }
            }
        }
    }

    let mut owner_groups: Vec<OwnerGroupSummary> = owner_counts
        .into_iter()
        .map(|(name, (kind, count))| OwnerGroupSummary {
            name,
            kind,
            matched_file_count: count,
        })
        .collect();
    owner_groups.sort_by(|a, b| b.matched_file_count.cmp(&a.matched_file_count));

    let rule_responses: Vec<RuleResponse> = rules
        .iter()
        .map(|r| RuleResponse {
            pattern: r.pattern.clone(),
            owners: r.owners.iter().map(|o| o.name.clone()).collect(),
            line: r.line,
            precedence: r.precedence,
        })
        .collect();

    Ok(CodeownersResponse {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        codeowners_file,
        owners: owner_groups,
        rules: rule_responses,
        coverage: CoverageReport {
            unowned_files: unowned_files.into_iter().take(MAX_REPORT_FILES).collect(),
            overlapping_files: overlapping_files.into_iter().take(MAX_REPORT_FILES).collect(),
            sensitive_unowned_files,
        },
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_codeowners() {
        let content = "# Comment\n\n*.js @frontend-team\nsrc/core/** @arch-team @platform-team\n";
        let (rules, warnings) = parse_codeowners_content(content);
        assert!(warnings.is_empty());
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].pattern, "*.js");
        assert_eq!(rules[0].owners.len(), 1);
        assert_eq!(rules[0].owners[0].name, "@frontend-team");
        assert_eq!(rules[1].pattern, "src/core/**");
        assert_eq!(rules[1].owners.len(), 2);
    }

    #[test]
    fn classifies_owner_kinds() {
        let team = classify_owner("@org/team");
        assert_eq!(team.kind, "team");

        let user = classify_owner("@username");
        assert_eq!(user.kind, "user");

        let email = classify_owner("user@example.com");
        assert_eq!(email.kind, "email");
    }

    #[test]
    fn matches_glob_patterns() {
        assert!(match_file("src/core/acp/handler.ts", "src/core/**"));
        assert!(match_file("lib/utils.js", "*.js"));
        assert!(!match_file("lib/utils.ts", "*.js"));
        assert!(match_file("docs/README.md", "docs/"));
    }

    #[test]
    fn higher_precedence_wins() {
        let content = "* @default-team\nsrc/core/** @arch-team\n";
        let (rules, _) = parse_codeowners_content(content);
        let best = best_matching_rule("src/core/handler.ts", &rules);
        assert_eq!(best, Some(1));
        assert_eq!(rules[best.unwrap()].owners[0].name, "@arch-team");
    }

    #[test]
    fn warns_on_pattern_without_owners() {
        let content = "src/core/**\n";
        let (rules, warnings) = parse_codeowners_content(content);
        assert_eq!(rules.len(), 0);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("pattern without owners"));
    }

    #[test]
    fn detects_overlap() {
        let content = "*.ts @ts-team\nsrc/** @src-team\n";
        let (rules, _) = parse_codeowners_content(content);
        let count = count_matching_rules("src/handler.ts", &rules);
        assert_eq!(count, 2);
    }

    #[test]
    fn missing_codeowners_returns_warning() {
        let temp = tempfile::tempdir().unwrap();
        let result = detect_codeowners(temp.path()).unwrap();
        assert!(result.codeowners_file.is_none());
        assert!(!result.warnings.is_empty());
        assert!(result.warnings[0].contains("No CODEOWNERS file found"));
    }

    #[test]
    fn detects_codeowners_from_github_dir() {
        let temp = tempfile::tempdir().unwrap();
        let github_dir = temp.path().join(".github");
        std::fs::create_dir_all(&github_dir).unwrap();
        std::fs::write(
            github_dir.join("CODEOWNERS"),
            "src/** @dev-team\n",
        )
        .unwrap();

        Command::new("git")
            .args(["init"])
            .current_dir(temp.path())
            .output()
            .unwrap();

        std::fs::write(temp.path().join("src").join("..").join("test.txt"), "x").ok();

        let result = detect_codeowners(temp.path()).unwrap();
        assert_eq!(result.codeowners_file.as_deref(), Some(".github/CODEOWNERS"));
        assert_eq!(result.rules.len(), 1);
    }
}
