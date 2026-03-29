use clap::{Args, Subcommand, ValueEnum};
use routa_core::harness::detect_repo_signals;
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Subcommand, Debug, Clone)]
pub enum HarnessAction {
    /// Detect build/test harness surfaces from docs/harness/*.yml
    Detect(HarnessDetectArgs),
}

#[derive(Args, Debug, Clone)]
pub struct HarnessDetectArgs {
    /// Repository root to inspect. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Which harness surface to print.
    #[arg(long, value_enum, default_value_t = HarnessSurfaceSelector::All)]
    pub surface: HarnessSurfaceSelector,

    /// Output format.
    #[arg(long, value_enum, default_value_t = HarnessOutputFormat::Json)]
    pub format: HarnessOutputFormat,

    /// Shortcut for `--format json`.
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum HarnessSurfaceSelector {
    All,
    Build,
    Test,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum HarnessOutputFormat {
    Text,
    Json,
}

pub fn run(action: HarnessAction) -> Result<(), String> {
    match action {
        HarnessAction::Detect(args) => run_detect(&args),
    }
}

fn run_detect(args: &HarnessDetectArgs) -> Result<(), String> {
    let repo_root = resolve_repo_root(args.repo_root.as_deref())?;
    let report = detect_repo_signals(&repo_root)?;

    match resolved_output_format(args) {
        HarnessOutputFormat::Json => {
            let value = match args.surface {
                HarnessSurfaceSelector::All => serde_json::to_value(&report)
                    .map_err(|error| format!("failed to serialize harness report: {error}"))?,
                HarnessSurfaceSelector::Build => json!({
                    "generatedAt": report.generated_at,
                    "repoRoot": report.repo_root,
                    "packageManager": report.package_manager,
                    "lockfiles": report.lockfiles,
                    "surface": report.build,
                    "warnings": report.warnings,
                }),
                HarnessSurfaceSelector::Test => json!({
                    "generatedAt": report.generated_at,
                    "repoRoot": report.repo_root,
                    "packageManager": report.package_manager,
                    "lockfiles": report.lockfiles,
                    "surface": report.test,
                    "warnings": report.warnings,
                }),
            };
            println!(
                "{}",
                serde_json::to_string_pretty(&value)
                    .map_err(|error| format!("failed to serialize harness report: {error}"))?
            );
        }
        HarnessOutputFormat::Text => print_text_report(&report, args.surface),
    }

    Ok(())
}

fn resolved_output_format(args: &HarnessDetectArgs) -> HarnessOutputFormat {
    if args.json {
        HarnessOutputFormat::Json
    } else {
        args.format
    }
}

fn print_text_report(
    report: &routa_core::harness::HarnessRepoSignalsReport,
    surface: HarnessSurfaceSelector,
) {
    println!("repo: {}", report.repo_root);
    if let Some(package_manager) = &report.package_manager {
        println!("packageManager: {package_manager}");
    }
    if !report.lockfiles.is_empty() {
        println!("lockfiles: {}", report.lockfiles.join(", "));
    }

    match surface {
        HarnessSurfaceSelector::All => {
            print_surface("build", &report.build);
            print_surface("test", &report.test);
        }
        HarnessSurfaceSelector::Build => print_surface("build", &report.build),
        HarnessSurfaceSelector::Test => print_surface("test", &report.test),
    }

    if !report.warnings.is_empty() {
        println!("warnings:");
        for warning in &report.warnings {
            println!("  - {warning}");
        }
    }
}

fn print_surface(name: &str, surface: &routa_core::harness::HarnessSurfaceSignals) {
    println!();
    println!("{name}: {}", surface.title);
    println!("  summary: {}", surface.summary);
    println!("  config: {}", surface.config_path);
    for row in &surface.overview_rows {
        println!("  {}: {}", row.label, row.items.join(", "));
    }
    for group in &surface.entrypoint_groups {
        let primary = group
            .scripts
            .first()
            .map(|script| script.name.as_str())
            .unwrap_or("—");
        println!("  {} -> {}", group.label, primary);
    }
}

fn resolve_repo_root(requested: Option<&str>) -> Result<PathBuf, String> {
    let cwd =
        std::env::current_dir().map_err(|error| format!("failed to determine cwd: {error}"))?;

    let repo_root = match requested {
        Some(path) => resolve_requested_path(path, &cwd),
        None => discover_git_toplevel(&cwd).unwrap_or(cwd),
    };

    validate_repo_root(repo_root)
}

fn resolve_requested_path(requested: &str, cwd: &Path) -> PathBuf {
    let requested = Path::new(requested);
    if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        cwd.join(requested)
    }
}

fn discover_git_toplevel(cwd: &Path) -> Option<PathBuf> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        None
    } else {
        Some(PathBuf::from(raw))
    }
}

fn validate_repo_root(repo_root: PathBuf) -> Result<PathBuf, String> {
    if !repo_root.exists() || !repo_root.is_dir() {
        return Err(format!(
            "repository root does not exist or is not a directory: {}",
            repo_root.display()
        ));
    }
    if !repo_root.join("docs/fitness/harness-fluency.model.yaml").exists()
        || !repo_root.join("crates/routa-cli").exists()
    {
        return Err(format!(
            "repository root is not a Routa workspace: {}",
            repo_root.display()
        ));
    }
    Ok(repo_root)
}
