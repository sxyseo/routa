use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::model::Metric;
use crate::model::{DimensionScore, FitnessReport, MetricResult, ResultState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamMode {
    Off,
    Failures,
    All,
}

impl StreamMode {
    pub fn parse(value: &str) -> Self {
        match value {
            "all" => Self::All,
            "off" => Self::Off,
            _ => Self::Failures,
        }
    }
}

pub struct TerminalReporter {
    verbose: bool,
    stream_mode: StreamMode,
}

pub struct ShellOutputController {
    reporter: Arc<TerminalReporter>,
    buffered_lines: Mutex<HashMap<String, Vec<(String, String)>>>,
}

impl ShellOutputController {
    pub fn new(reporter: Arc<TerminalReporter>) -> Self {
        Self {
            reporter,
            buffered_lines: Mutex::new(HashMap::new()),
        }
    }

    pub fn should_capture_output(&self) -> bool {
        self.reporter.stream_mode != StreamMode::Off
    }

    pub fn handle_output(&self, metric: &Metric, source: &str, line: &str) {
        match self.reporter.stream_mode {
            StreamMode::Off => {}
            StreamMode::All => self.reporter.print_metric_output(&metric.name, source, line),
            StreamMode::Failures => {
                self.buffered_lines
                    .lock()
                    .unwrap()
                    .entry(metric.name.clone())
                    .or_default()
                    .push((source.to_string(), line.to_string()));
            }
        }
    }

    pub fn handle_progress(&self, event: &str, metric: &Metric, result: Option<&MetricResult>) {
        self.reporter.print_metric_progress(
            event,
            &metric.name,
            metric.tier.as_str(),
            metric.gate == crate::model::Gate::Hard,
            result,
        );

        if event != "end" || self.reporter.stream_mode != StreamMode::Failures {
            return;
        }

        let buffered = self
            .buffered_lines
            .lock()
            .unwrap()
            .remove(&metric.name)
            .unwrap_or_default();
        if !matches!(
            result.map(|result| result.state),
            Some(ResultState::Fail | ResultState::Unknown)
        ) {
            return;
        }

        for (source, line) in buffered {
            self.reporter.print_metric_output(&metric.name, &source, &line);
        }
    }
}

impl TerminalReporter {
    pub fn new(verbose: bool, stream_mode: StreamMode) -> Self {
        Self {
            verbose,
            stream_mode,
        }
    }

    pub fn print_header(&self, dry_run: bool, tier: Option<&str>, parallel: bool) {
        println!("{}", "=".repeat(60));
        println!("FITNESS FUNCTION REPORT");
        if dry_run {
            println!("(DRY-RUN MODE)");
        }
        if let Some(tier) = tier {
            println!("(TIER: {})", tier.to_uppercase());
        }
        if parallel {
            println!("(PARALLEL MODE)");
        }
        println!("{}", "=".repeat(60));
    }

    pub fn print_metric_progress(
        &self,
        event: &str,
        metric_name: &str,
        tier: &str,
        hard_gate: bool,
        result: Option<&MetricResult>,
    ) {
        let hard = if hard_gate { " [HARD GATE]" } else { "" };
        let tier_label = format!(" [{tier}]");
        if event == "start" {
            println!("[RUNNING] {metric_name}{hard}{tier_label}");
            return;
        }

        let status = result
            .map(|result| match result.state {
                ResultState::Pass => "PASS",
                ResultState::Fail => "FAIL",
                ResultState::Unknown => "UNKNOWN",
                ResultState::Skipped => "SKIPPED",
                ResultState::Waived => "WAIVED",
            })
            .unwrap_or("UNKNOWN");
        let duration = result
            .filter(|result| result.duration_ms > 0.0)
            .map(|result| format!(" in {:.1}s", result.duration_ms / 1000.0))
            .unwrap_or_default();
        println!("[DONE] {metric_name}: {status}{hard}{tier_label}{duration}");
    }

    pub fn print_metric_output(&self, metric_name: &str, source: &str, line: &str) {
        let text = line.trim();
        if text.is_empty() {
            return;
        }
        println!("[LOG][{source}] {metric_name}: {text}");
    }

    pub fn report(&self, report: &FitnessReport, show_tier: bool) {
        for dimension in &report.dimensions {
            self.print_dimension(dimension, show_tier);
        }
        self.print_footer(report);
    }

    fn print_dimension(&self, dimension: &DimensionScore, show_tier: bool) {
        println!(
            "\n## {} (weight: {}%)",
            dimension.dimension.to_uppercase(),
            dimension.weight
        );
        for result in &dimension.results {
            self.print_result(result, show_tier);
        }
        if dimension.total > 0 {
            println!("   Score: {:.0}%", dimension.score);
        }
    }

    fn print_result(&self, result: &MetricResult, show_tier: bool) {
        let status = match result.state {
            ResultState::Pass => "PASS",
            ResultState::Fail => "FAIL",
            ResultState::Unknown => "UNKNOWN",
            ResultState::Skipped => "SKIPPED",
            ResultState::Waived => "WAIVED",
        };
        let hard = if result.hard_gate { " [HARD GATE]" } else { "" };
        let tier = if show_tier {
            format!(" [{}]", result.tier.as_str())
        } else {
            String::new()
        };
        println!("   - {}: {}{}{}", result.metric_name, status, hard, tier);

        let should_print_output = matches!(result.state, ResultState::Fail | ResultState::Unknown)
            && (self.verbose || result.hard_gate || self.stream_mode == StreamMode::Off);
        if !should_print_output {
            return;
        }

        let lines = result
            .output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>();
        if lines.is_empty() {
            return;
        }

        let max_head = 20usize;
        let max_tail = 30usize;
        if lines.len() <= max_head + max_tail {
            for line in lines {
                println!("     > {line}");
            }
            return;
        }

        for line in &lines[..max_head] {
            println!("     > {line}");
        }
        println!(
            "     > ... ({} lines omitted) ...",
            lines.len() - max_head - max_tail
        );
        for line in &lines[lines.len() - max_tail..] {
            println!("     > {line}");
        }
    }

    fn print_footer(&self, report: &FitnessReport) {
        println!("\n{}", "=".repeat(60));
        let scored_dimensions = report
            .dimensions
            .iter()
            .filter(|dimension| dimension.weight > 0 && dimension.total > 0)
            .count();

        if report.hard_gate_blocked {
            let failures = report
                .dimensions
                .iter()
                .flat_map(|dimension| dimension.hard_gate_failures.iter())
                .cloned()
                .collect::<Vec<_>>();
            println!("HARD GATES FAILED: {}", failures.join(", "));
            println!("Cannot proceed until hard gates pass.");
        } else if !report.dimensions.is_empty() && scored_dimensions == 0 {
            println!("FINAL SCORE: n/a");
            println!("PASS - No weighted metrics were scored in this run");
        } else if !report.dimensions.is_empty() {
            println!("FINAL SCORE: {:.1}%", report.final_score);
            if report.score_blocked {
                println!("BLOCK - Score too low");
            } else if report.final_score >= 90.0 {
                println!("PASS");
            } else if report.final_score >= 80.0 {
                println!("WARN - Consider improvements");
            } else {
                println!("PASS");
            }
        }

        println!("{}", "=".repeat(60));
    }
}

pub struct AsciiReporter {
    width: usize,
}

impl AsciiReporter {
    pub fn new(width: usize) -> Self {
        Self { width }
    }

    pub fn report(&self, report: &FitnessReport) {
        println!("\nVISUAL SCORECARD");
        println!("{}", "-".repeat(60));
        for dimension in &report.dimensions {
            let scorable = dimension.weight > 0 && dimension.total > 0;
            let score_text = if scorable {
                format!("{:>5.1}%", dimension.score)
            } else {
                "  n/a".to_string()
            };
            println!(
                "{:<16} {} {} {:<5} weight={:>2}% metrics={}",
                dimension.dimension.to_uppercase().chars().take(16).collect::<String>(),
                bar(dimension.score, self.width),
                score_text,
                status_for_score(dimension.score, scorable),
                dimension.weight,
                metric_summary(dimension)
            );
        }
        println!("{}", "-".repeat(60));
        println!(
            "FINAL SCORE      {} {:>5.1}% {}",
            bar(report.final_score, self.width),
            report.final_score,
            status_for_score(report.final_score, !report.dimensions.is_empty())
        );
        if report.hard_gate_blocked {
            println!("Hard gates are blocking this run.");
        } else if report.score_blocked {
            println!("Score is below the configured minimum threshold.");
        }
    }
}

fn status_for_score(score: f64, scorable: bool) -> &'static str {
    if !scorable {
        return "INFO";
    }
    if score >= 90.0 {
        "PASS"
    } else if score >= 80.0 {
        "WARN"
    } else {
        "BLOCK"
    }
}

fn bar(score: f64, width: usize) -> String {
    let clamped = score.clamp(0.0, 100.0);
    let filled = ((clamped / 100.0) * width as f64).round() as usize;
    format!("{}{}", "█".repeat(filled), "░".repeat(width - filled))
}

fn metric_summary(dimension: &DimensionScore) -> String {
    if dimension.total == 0 {
        "n/a".to_string()
    } else {
        format!("{}/{}", dimension.passed, dimension.total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Metric, MetricResult, Tier};

    #[test]
    fn stream_mode_parses_supported_values() {
        assert_eq!(StreamMode::parse("off"), StreamMode::Off);
        assert_eq!(StreamMode::parse("all"), StreamMode::All);
        assert_eq!(StreamMode::parse("failures"), StreamMode::Failures);
        assert_eq!(StreamMode::parse("unknown"), StreamMode::Failures);
    }

    #[test]
    fn shell_output_controller_only_captures_when_enabled() {
        let controller = ShellOutputController::new(Arc::new(TerminalReporter::new(
            false,
            StreamMode::Failures,
        )));
        assert!(controller.should_capture_output());

        let disabled = ShellOutputController::new(Arc::new(TerminalReporter::new(
            false,
            StreamMode::Off,
        )));
        assert!(!disabled.should_capture_output());
    }

    #[test]
    fn shell_output_controller_buffers_failure_lines() {
        let controller = ShellOutputController::new(Arc::new(TerminalReporter::new(
            false,
            StreamMode::Failures,
        )));
        let metric = Metric::new("lint", "echo lint");
        controller.handle_output(&metric, "stdout", "first");
        controller.handle_output(&metric, "stderr", "second");
        assert_eq!(
            controller
                .buffered_lines
                .lock()
                .unwrap()
                .get("lint")
                .map(|lines| lines.len()),
            Some(2)
        );

        let result = MetricResult::new("lint", true, "ok", Tier::Fast);
        controller.handle_progress("end", &metric, Some(&result));
        assert!(controller
            .buffered_lines
            .lock()
            .unwrap()
            .get("lint")
            .is_none());
    }
}
