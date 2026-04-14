use entrix::long_file::LongFileAnalysisReport;
use entrix::model::FitnessReport;
use entrix::release_trigger::ReleaseTriggerReport;
use entrix::review_trigger::ReviewTriggerReport;

pub(crate) fn print_json<T: serde::Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("failed to serialize json output: {error}");
        }
    }
}

pub(crate) fn print_report_text(report: &FitnessReport, verbose: bool) {
    let status = if report.hard_gate_blocked || report.score_blocked {
        "FAIL"
    } else {
        "PASS"
    };

    println!("Entrix fitness: {status}");
    println!("Final score: {:.1}%", report.final_score);
    println!("Hard gate blocked: {}", report.hard_gate_blocked);
    println!("Score blocked: {}", report.score_blocked);

    for dimension in &report.dimensions {
        println!(
            "- {}: {:.1}% ({}/{})",
            dimension.dimension, dimension.score, dimension.passed, dimension.total
        );

        if verbose {
            for result in &dimension.results {
                println!(
                    "  {} [{}] {} ({:.0}ms)",
                    if result.passed { "PASS" } else { "FAIL" },
                    result.tier.as_str(),
                    result.metric_name,
                    result.duration_ms
                );
            }
        }
    }
}

fn format_line_span(start: usize, end: usize) -> String {
    if start == end {
        format!("L{start}")
    } else {
        format!("L{start}-L{end}")
    }
}

pub(crate) fn print_hook_long_file_summary(report: &LongFileAnalysisReport) {
    const MAX_CLASSES: usize = 3;
    const MAX_METHODS_PER_CLASS: usize = 4;
    const MAX_FUNCTIONS: usize = 5;

    if report.files.is_empty() {
        println!("Structure summary unavailable: no supported files for structural analysis.");
        return;
    }

    println!("Structure summary (tree-sitter symbols):");
    for item in &report.files {
        println!("- {}", item.file_path);

        if item.classes.is_empty() && item.functions.is_empty() {
            println!("  no class/function symbols found");
            continue;
        }

        for cls in item.classes.iter().take(MAX_CLASSES) {
            println!(
                "  class {} ({}, methods={})",
                cls.name,
                format_line_span(cls.start_line, cls.end_line),
                cls.method_count,
            );
            for method in cls.methods.iter().take(MAX_METHODS_PER_CLASS) {
                println!(
                    "    method {} ({})",
                    method.name,
                    format_line_span(method.start_line, method.end_line),
                );
            }
            let remaining_methods = cls.methods.len().saturating_sub(MAX_METHODS_PER_CLASS);
            if remaining_methods > 0 {
                println!("    ... {remaining_methods} more method(s)");
            }
        }

        let remaining_classes = item.classes.len().saturating_sub(MAX_CLASSES);
        if remaining_classes > 0 {
            println!("  ... {remaining_classes} more class(es)");
        }

        if !item.functions.is_empty() {
            let compact: Vec<String> = item
                .functions
                .iter()
                .take(MAX_FUNCTIONS)
                .map(|f| {
                    format!(
                        "{} ({})",
                        f.name,
                        format_line_span(f.start_line, f.end_line),
                    )
                })
                .collect();
            println!("  functions: {}", compact.join(", "));
            let remaining_functions = item.functions.len().saturating_sub(MAX_FUNCTIONS);
            if remaining_functions > 0 {
                println!("  ... {remaining_functions} more function(s)");
            }
        }

        if !item.warnings.is_empty() {
            println!("  review-warnings: {}", item.warnings.len());
        }
    }
}

pub(crate) fn print_long_file_report(report: &LongFileAnalysisReport, min_lines: usize) {
    if report.files.is_empty() {
        println!("No oversized or explicit files matched for long-file analysis.");
        return;
    }

    for file in &report.files {
        if file.line_count < min_lines {
            continue;
        }
        println!(
            "{} [{}] {} lines (budget {}, commits {})",
            file.file_path, file.language, file.line_count, file.budget_limit, file.commit_count
        );
        if !file.budget_reason.is_empty() {
            println!("  budget reason: {}", file.budget_reason);
        }
        for class in &file.classes {
            println!(
                "  class {} [{}-{}] methods={}",
                class.qualified_name, class.start_line, class.end_line, class.method_count
            );
        }
        for function in &file.functions {
            println!(
                "  {} {} [{}-{}] comments={} commits={}",
                function.kind,
                function.qualified_name,
                function.start_line,
                function.end_line,
                function.comment_count,
                function.commit_count
            );
        }
        for warning in &file.warnings {
            println!("  warning {}: {}", warning.code, warning.summary);
        }
    }
}

pub(crate) fn print_release_trigger_report(report: &ReleaseTriggerReport) {
    println!("Release trigger report");
    println!("- blocked: {}", if report.blocked { "yes" } else { "no" });
    println!(
        "- human review required: {}",
        if report.human_review_required {
            "yes"
        } else {
            "no"
        }
    );
    println!("- manifest: {}", report.manifest_path);
    if let Some(path) = &report.baseline_manifest_path {
        println!("- baseline manifest: {path}");
    }
    println!("- artifacts: {}", report.artifacts.len());
    println!("- changed files: {}", report.changed_files.len());
    if report.triggers.is_empty() {
        println!("- triggers: none");
        return;
    }
    println!("- triggers:");
    for trigger in &report.triggers {
        println!(
            "  - {} [{}] -> {}",
            trigger.name, trigger.severity, trigger.action
        );
        for reason in &trigger.reasons {
            println!("    - {reason}");
        }
    }
}

pub(crate) fn print_review_trigger_report(report: &ReviewTriggerReport) {
    println!(
        "human review required: {}",
        if report.human_review_required {
            "yes"
        } else {
            "no"
        }
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
