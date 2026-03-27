use chrono::Utc;
use std::collections::{HashMap, HashSet};

use super::detector::{evaluate_criterion, EvaluationContext};
use super::model::load_fluency_model;
use super::snapshot::{
    build_comparison, can_compare_reports, load_previous_snapshot, persist_snapshot,
};
use super::types::{
    CellResult, CriterionResult, CriterionStatus, DimensionResult, EvaluateOptions,
    FluencyDimension, FluencyLevel, HarnessFluencyReport, Recommendation, CELL_PASS_THRESHOLD,
    MAX_RECOMMENDATIONS,
};

struct MutableCellAccumulator {
    id: String,
    level: String,
    level_name: String,
    dimension: String,
    dimension_name: String,
    criteria: Vec<CriterionResult>,
}

pub fn evaluate_harness_fluency(options: &EvaluateOptions) -> Result<HarnessFluencyReport, String> {
    let model = load_fluency_model(&options.model_path)?;
    let level_order: HashMap<String, usize> = model
        .levels
        .iter()
        .enumerate()
        .map(|(index, level)| (level.id.clone(), index))
        .collect();
    let level_by_id: HashMap<String, FluencyLevel> = model
        .levels
        .iter()
        .cloned()
        .map(|level| (level.id.clone(), level))
        .collect();
    let dimension_by_id: HashMap<String, FluencyDimension> = model
        .dimensions
        .iter()
        .cloned()
        .map(|dimension| (dimension.id.clone(), dimension))
        .collect();

    let previous_snapshot = if options.compare_last {
        load_previous_snapshot(&options.snapshot_path)?
    } else {
        None
    };

    let mut context = EvaluationContext::new(options.repo_root.clone())?;
    let mut criteria_results = Vec::with_capacity(model.criteria.len());
    for criterion in &model.criteria {
        criteria_results.push(evaluate_criterion(criterion, &mut context)?);
    }

    let mut cell_accumulators: HashMap<String, MutableCellAccumulator> = HashMap::new();
    for criterion_result in &criteria_results {
        let level = level_by_id
            .get(&criterion_result.level)
            .ok_or_else(|| format!("unknown level {}", criterion_result.level))?;
        let dimension = dimension_by_id
            .get(&criterion_result.dimension)
            .ok_or_else(|| format!("unknown dimension {}", criterion_result.dimension))?;
        let cell_id = build_cell_id(&criterion_result.level, &criterion_result.dimension);
        cell_accumulators
            .entry(cell_id.clone())
            .and_modify(|accumulator| accumulator.criteria.push(criterion_result.clone()))
            .or_insert_with(|| MutableCellAccumulator {
                id: cell_id,
                level: criterion_result.level.clone(),
                level_name: level.name.clone(),
                dimension: criterion_result.dimension.clone(),
                dimension_name: dimension.name.clone(),
                criteria: vec![criterion_result.clone()],
            });
    }

    let mut cells = Vec::with_capacity(model.levels.len() * model.dimensions.len());
    for level in &model.levels {
        for dimension in &model.dimensions {
            let cell_id = build_cell_id(&level.id, &dimension.id);
            let mut accumulator = cell_accumulators
                .remove(&cell_id)
                .ok_or_else(|| format!("missing accumulated cell {}:{}", dimension.id, level.id))?;
            accumulator
                .criteria
                .sort_by(|left, right| left.id.cmp(&right.id));
            let applicable_weight: u32 = accumulator
                .criteria
                .iter()
                .filter(|criterion| criterion.status != CriterionStatus::Skipped)
                .map(|criterion| criterion.weight)
                .sum();
            let passed_weight: u32 = accumulator
                .criteria
                .iter()
                .filter(|criterion| criterion.status == CriterionStatus::Pass)
                .map(|criterion| criterion.weight)
                .sum();
            let score = if applicable_weight == 0 {
                0.0
            } else {
                passed_weight as f64 / applicable_weight as f64
            };

            cells.push(CellResult {
                id: accumulator.id,
                level: accumulator.level,
                level_name: accumulator.level_name,
                dimension: accumulator.dimension,
                dimension_name: accumulator.dimension_name,
                score,
                passed: applicable_weight > 0 && score >= CELL_PASS_THRESHOLD,
                passed_weight,
                applicable_weight,
                criteria: accumulator.criteria,
            });
        }
    }

    let cell_by_id: HashMap<String, CellResult> = cells
        .iter()
        .cloned()
        .map(|cell| (cell.id.clone(), cell))
        .collect();
    let mut dimensions = HashMap::new();
    for dimension in &model.dimensions {
        let mut achieved_index: isize = -1;
        for (index, level) in model.levels.iter().enumerate() {
            let cell = cell_by_id.get(&build_cell_id(&level.id, &dimension.id));
            if !cell.map(|entry| entry.passed).unwrap_or(false) {
                break;
            }
            achieved_index = index as isize;
        }

        let resolved_index = achieved_index.max(0) as usize;
        let current_level = &model.levels[resolved_index];
        let next_level = model.levels.get(resolved_index + 1);
        let current_cell_id = build_cell_id(&current_level.id, &dimension.id);
        dimensions.insert(
            dimension.id.clone(),
            DimensionResult {
                dimension: dimension.id.clone(),
                name: dimension.name.clone(),
                level: current_level.id.clone(),
                level_name: current_level.name.clone(),
                level_index: resolved_index,
                score: cell_by_id
                    .get(&current_cell_id)
                    .map(|cell| cell.score)
                    .unwrap_or(0.0),
                next_level: next_level.map(|level| level.id.clone()),
                next_level_name: next_level.map(|level| level.name.clone()),
                next_level_progress: next_level
                    .and_then(|level| cell_by_id.get(&build_cell_id(&level.id, &dimension.id)))
                    .map(|cell| cell.score),
            },
        );
    }

    let overall_level_index = dimensions
        .values()
        .map(|dimension| dimension.level_index)
        .min()
        .ok_or_else(|| "fluency model has no dimensions".to_string())?;
    let overall_level = &model.levels[overall_level_index];
    let next_level = model.levels.get(overall_level_index + 1);
    let current_level_readiness =
        average_cell_scores(&model.dimensions, &cell_by_id, &overall_level.id);
    let current_level_debt =
        collect_failing_criteria_for_level(&model.dimensions, &cell_by_id, &overall_level.id);
    let next_level_readiness = match (next_level, current_level_debt.is_empty()) {
        (Some(level), true) => Some(average_cell_scores(
            &model.dimensions,
            &cell_by_id,
            &level.id,
        )),
        _ => None,
    };
    let blocking_target_level = if !current_level_debt.is_empty() {
        Some(overall_level)
    } else {
        next_level
    };
    let mut blocking_criteria = match blocking_target_level {
        None => Vec::new(),
        Some(level) if level.id == overall_level.id => current_level_debt.clone(),
        Some(level) => {
            collect_failing_criteria_for_level(&model.dimensions, &cell_by_id, &level.id)
        }
    };
    blocking_criteria.sort_by(|left, right| left.id.cmp(&right.id));

    criteria_results.sort_by(|left, right| left.id.cmp(&right.id));
    let mut report = HarnessFluencyReport {
        model_version: model.version,
        model_path: options.model_path.display().to_string(),
        profile: options.profile.clone(),
        repo_root: options.repo_root.display().to_string(),
        generated_at: Utc::now().to_rfc3339(),
        snapshot_path: options.snapshot_path.display().to_string(),
        overall_level: overall_level.id.clone(),
        overall_level_name: overall_level.name.clone(),
        current_level_readiness,
        next_level: next_level.map(|level| level.id.clone()),
        next_level_name: next_level.map(|level| level.name.clone()),
        next_level_readiness,
        blocking_target_level: blocking_target_level.map(|level| level.id.clone()),
        blocking_target_level_name: blocking_target_level.map(|level| level.name.clone()),
        dimensions,
        cells,
        criteria: criteria_results,
        blocking_criteria: blocking_criteria.clone(),
        recommendations: collect_recommendations(&blocking_criteria),
        comparison: None,
    };

    if let Some(previous_report) = previous_snapshot {
        if can_compare_reports(&previous_report, &report) {
            report.comparison = Some(build_comparison(&previous_report, &report, &level_order));
        }
    }

    if options.save {
        persist_snapshot(&report, &options.snapshot_path)?;
    }

    Ok(report)
}

fn build_cell_id(level: &str, dimension: &str) -> String {
    format!("{dimension}:{level}")
}

fn deterministic_priority(detector_type: &str) -> u8 {
    if detector_type == "manual_attestation" {
        1
    } else {
        0
    }
}

fn collect_recommendations(criteria: &[CriterionResult]) -> Vec<Recommendation> {
    let mut deduped = HashSet::new();
    let mut sorted = criteria
        .iter()
        .filter(|criterion| criterion.status == CriterionStatus::Fail)
        .cloned()
        .collect::<Vec<_>>();
    sorted.sort_by(|left, right| {
        right
            .critical
            .cmp(&left.critical)
            .then(right.weight.cmp(&left.weight))
            .then(
                deterministic_priority(&left.detector_type)
                    .cmp(&deterministic_priority(&right.detector_type)),
            )
            .then(left.id.cmp(&right.id))
    });

    sorted
        .into_iter()
        .filter(|criterion| deduped.insert(criterion.recommended_action.clone()))
        .take(MAX_RECOMMENDATIONS)
        .map(|criterion| Recommendation {
            criterion_id: criterion.id,
            action: criterion.recommended_action,
            why_it_matters: criterion.why_it_matters,
            evidence_hint: criterion.evidence_hint,
            critical: criterion.critical,
            weight: criterion.weight,
        })
        .collect()
}

fn average_cell_scores(
    dimensions: &[FluencyDimension],
    cell_by_id: &HashMap<String, CellResult>,
    level_id: &str,
) -> f64 {
    let total: f64 = dimensions
        .iter()
        .map(|dimension| {
            cell_by_id
                .get(&build_cell_id(level_id, &dimension.id))
                .map(|cell| cell.score)
                .unwrap_or(0.0)
        })
        .sum();
    total / dimensions.len() as f64
}

fn collect_failing_criteria_for_level(
    dimensions: &[FluencyDimension],
    cell_by_id: &HashMap<String, CellResult>,
    level_id: &str,
) -> Vec<CriterionResult> {
    let mut failing = Vec::new();
    for dimension in dimensions {
        if let Some(cell) = cell_by_id.get(&build_cell_id(level_id, &dimension.id)) {
            if !cell.passed {
                failing.extend(
                    cell.criteria
                        .iter()
                        .filter(|criterion| criterion.status == CriterionStatus::Fail)
                        .cloned(),
                );
            }
        }
    }
    failing
}
