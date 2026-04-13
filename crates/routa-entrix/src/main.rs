use clap::{Args, Parser, Subcommand};
use routa_entrix::file_budgets::{
    evaluate_paths, is_tracked_source_file, load_config, resolve_paths,
};
use routa_entrix::review_trigger::{
    collect_changed_files, collect_diff_stats, evaluate_review_triggers, load_review_triggers,
};
use routa_entrix::test_mapping;
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Parser, Debug)]
#[command(name = "entrix")]
#[command(about = "Rust Entrix CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    #[command(name = "review-trigger")]
    ReviewTrigger(ReviewTriggerArgs),
    Hook(HookArgs),
    Graph(GraphArgs),
}

#[derive(Args, Debug)]
struct ReviewTriggerArgs {
    #[arg()]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD~1")]
    base: String,
    #[arg(long)]
    config: Option<String>,
    #[arg(long)]
    fail_on_trigger: bool,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphArgs {
    #[command(subcommand)]
    command: GraphCommand,
}

#[derive(Args, Debug)]
struct HookArgs {
    #[command(subcommand)]
    command: HookCommand,
}

#[derive(Subcommand, Debug)]
enum HookCommand {
    #[command(name = "file-length")]
    FileLength(HookFileLengthArgs),
}

#[derive(Args, Debug)]
struct HookFileLengthArgs {
    #[arg(long)]
    config: String,
    #[arg(long)]
    staged_only: bool,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long)]
    strict_limit: bool,
    #[arg(long)]
    changed_only: bool,
    #[arg(long)]
    overrides_only: bool,
    #[arg()]
    files: Vec<String>,
}

#[derive(Subcommand, Debug)]
enum GraphCommand {
    #[command(name = "test-mapping")]
    TestMapping(GraphTestMappingArgs),
    #[command(name = "review-context")]
    ReviewContext(GraphReviewContextArgs),
}

#[derive(Args, Debug)]
struct GraphTestMappingArgs {
    #[arg()]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long)]
    no_graph: bool,
    #[arg(long)]
    fail_on_missing: bool,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct GraphReviewContextArgs {
    #[arg()]
    files_positional: Vec<String>,
    #[arg(long)]
    files: Vec<String>,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long, default_value = "HEAD")]
    head: String,
    #[arg(long, default_value_t = 2)]
    depth: usize,
    #[arg(long, default_value_t = 25)]
    max_targets: usize,
    #[arg(long, default_value_t = 12)]
    max_files: usize,
    #[arg(long, default_value_t = 120)]
    max_lines_per_file: usize,
    #[arg(long)]
    no_source: bool,
    #[arg(long)]
    json: bool,
    #[arg(long)]
    output: Option<String>,
}

fn main() {
    let cli = Cli::parse();
    let exit_code = match cli.command {
        Command::ReviewTrigger(args) => cmd_review_trigger(args),
        Command::Hook(args) => match args.command {
            HookCommand::FileLength(args) => cmd_hook_file_length(args),
        },
        Command::Graph(args) => match args.command {
            GraphCommand::TestMapping(args) => cmd_graph_test_mapping(args),
            GraphCommand::ReviewContext(args) => cmd_graph_review_context(args),
        },
    };
    std::process::exit(exit_code);
}

fn cmd_review_trigger(args: ReviewTriggerArgs) -> i32 {
    let repo_root = find_project_root();
    let config_path = args
        .config
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root.join("docs/fitness/review-triggers.yaml"));
    let rules = match load_review_triggers(&config_path) {
        Ok(rules) => rules,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let changed_files = if args.files.is_empty() {
        collect_changed_files(&repo_root, &args.base)
    } else {
        args.files
    };
    let diff_stats = collect_diff_stats(&repo_root, &args.base);
    let report = evaluate_review_triggers(
        &rules,
        &changed_files,
        &diff_stats,
        &args.base,
        Some(&repo_root),
    );

    if args.json {
        print_json(&report);
    } else {
        print_review_trigger_report(&report);
    }

    if report.human_review_required && args.fail_on_trigger {
        return 3;
    }
    0
}

fn cmd_graph_test_mapping(args: GraphTestMappingArgs) -> i32 {
    let repo_root = find_project_root();
    let changed_files = if args.files.is_empty() {
        collect_git_diff_files(&repo_root, &args.base)
    } else {
        args.files
    };
    let report = test_mapping::analyze_changed_files(&repo_root, &changed_files);

    if args.json {
        let payload = json!({
            "changed_files": report.changed_files,
            "skipped_test_files": report.skipped_test_files,
            "mappings": report.mappings,
            "status_counts": report.status_counts,
            "resolver_counts": report.resolver_counts,
            "graph": {
                "available": false,
                "status": if args.no_graph { "disabled" } else { "unavailable" },
                "reason": "graph enrichment is not implemented in routa-entrix yet"
            }
        });
        print_json(&payload);
    } else {
        println!(
            "test mappings: {} source files, {} skipped test files",
            report.mappings.len(),
            report.skipped_test_files.len()
        );
    }

    if args.fail_on_missing && report.status_counts.get("missing").copied().unwrap_or(0) > 0 {
        return 2;
    }
    0
}

fn cmd_graph_review_context(args: GraphReviewContextArgs) -> i32 {
    let repo_root = find_project_root();
    let mut files = args.files_positional;
    files.extend(args.files);
    if files.is_empty() {
        files = collect_git_diff_files(&repo_root, &args.base);
    }

    let payload = json!({
        "status": "unavailable",
        "reason": "graph review context is not implemented in routa-entrix yet",
        "base": args.base,
        "head": args.head,
        "changed_files": files,
        "max_depth": args.depth,
        "max_targets": args.max_targets,
        "max_files": args.max_files,
        "max_lines_per_file": args.max_lines_per_file,
        "include_source": !args.no_source
    });

    if args.json {
        if let Some(output_path) = args.output {
            if output_path != "-" {
                if let Err(error) = std::fs::write(
                    &output_path,
                    serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string()) + "\n",
                ) {
                    eprintln!("failed to write {output_path}: {error}");
                    return 1;
                }
                return 0;
            }
        }
        print_json(&payload);
    } else {
        println!(
            "{}",
            payload["reason"]
                .as_str()
                .unwrap_or("graph review context unavailable")
        );
    }

    0
}

fn cmd_hook_file_length(args: HookFileLengthArgs) -> i32 {
    let repo_root = find_project_root();
    let config = match load_config(Path::new(&args.config)) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let relative_paths = match resolve_paths(
        &repo_root,
        &config,
        &args.files,
        args.changed_only,
        args.staged_only,
        &args.base,
        args.overrides_only,
    ) {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let violations = evaluate_paths(&repo_root, &relative_paths, &config, !args.strict_limit);
    let checked_count = relative_paths
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|path| is_tracked_source_file(path, &config))
        .count();

    println!("file_budget_checked: {checked_count}");
    println!("file_budget_violations: {}", violations.len());
    for violation in &violations {
        let reason = if violation.reason.is_empty() {
            String::new()
        } else {
            format!(" | {}", violation.reason)
        };
        println!(
            "current file length {} exceeds limit {}: {}{}",
            violation.line_count, violation.max_lines, violation.path, reason
        );
    }

    if violations.is_empty() { 0 } else { 1 }
}

fn find_project_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for candidate in std::iter::once(cwd.as_path()).chain(cwd.ancestors().skip(1)) {
        if candidate.join("Cargo.toml").exists() || candidate.join("package.json").exists() {
            return candidate.to_path_buf();
        }
    }
    cwd
}

fn collect_git_diff_files(repo_root: &Path, base: &str) -> Vec<String> {
    let output = std::process::Command::new("git")
        .args(["diff", "--name-only", "--diff-filter=ACMR", base])
        .current_dir(repo_root)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn print_json<T: serde::Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("failed to serialize json output: {error}");
        }
    }
}

fn print_review_trigger_report(report: &routa_entrix::review_trigger::ReviewTriggerReport) {
    println!(
        "human review required: {}",
        if report.human_review_required { "yes" } else { "no" }
    );
    println!("base: {}", report.base);
    println!("changed files: {}", report.changed_files.len());
    println!("triggers: {}", report.triggers.len());
    for trigger in &report.triggers {
        println!(
            "- {} [{}] -> {}",
            trigger.name, trigger.severity, trigger.action
        );
        for reason in &trigger.reasons {
            println!("  - {reason}");
        }
    }
}
