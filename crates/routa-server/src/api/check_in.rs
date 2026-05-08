//! Daily Sign-in and Check-in Statistics API
//!
//! Provides endpoints for check-in statistics, history, and data export.

use axum::{
    extract::{Path, Query, State},
    http::header::{HeaderMap, HeaderValue, CONTENT_TYPE},
    routing::{get, post},
    Json, Router,
};
use chrono::{Datelike, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::ServerError;
use crate::state::AppState;

// ── Request/Response Types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInStatsQuery {
    pub user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInHistoryQuery {
    pub user_id: String,
    pub month: Option<String>, // YYYY-MM format, defaults to current month
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInExportQuery {
    pub user_id: String,
    pub format: Option<String>, // "csv" or "json", defaults to "csv"
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInStatsResponse {
    pub workspace_id: String,
    pub user_id: String,
    pub total_days: i32,
    pub current_streak: i32,
    pub longest_streak: i32,
    pub monthly_rate: f64, // sign-in rate for current month
    pub monthly_days: i32,
    pub total_points: i32,
    pub ad_claim_count: i32,
    pub last_signin_date: Option<String>,
    pub last_signin_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInHistoryResponse {
    pub records: Vec<CheckInRecord>,
    pub pagination: PaginationInfo,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInRecord {
    pub id: String,
    pub signin_date: String,
    pub signin_at: i64,
    pub status: String,
    pub is_consecutive: bool,
    pub consecutive_days: i32,
    pub is_makeup: bool, // 补签标记
    pub reward_amount: i32,
    pub reward_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationInfo {
    pub page: u32,
    pub page_size: u32,
    pub total: u32,
    pub total_pages: u32,
}

// ── Router ─────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/workspaces/{workspace_id}/check-in/stats",
            get(get_checkin_stats),
        )
        .route(
            "/workspaces/{workspace_id}/check-in/history",
            get(get_checkin_history),
        )
        .route(
            "/workspaces/{workspace_id}/check-in/export",
            get(export_checkin_data),
        )
        // Legacy route for status check
        .route(
            "/workspaces/{workspace_id}/daily-signin/status",
            get(get_daily_signin_status),
        )
        .route(
            "/workspaces/{workspace_id}/daily-signin/signin",
            post(process_daily_signin),
        )
        .route(
            "/workspaces/{workspace_id}/daily-signin/rewards",
            get(get_signin_rewards),
        )
        .route(
            "/workspaces/{workspace_id}/daily-signin/analytics",
            get(get_checkin_analytics),
        )
}

// ── Stats Endpoint (AC1) ─────────────────────────────────────────────────────

/// GET /api/game/workspaces/{workspace_id}/check-in/stats
///
/// Returns comprehensive check-in statistics for a user.
async fn get_checkin_stats(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<CheckInStatsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let stats = state
        .daily_signin_store
        .get_status(&workspace_id, &query.user_id)
        .await?;

    // Get total sign-ins for total points calculation
    let monthly_signins = state
        .daily_signin_store
        .get_monthly_signins(
            &workspace_id,
            &query.user_id,
            &Local::now().format("%Y-%m").to_string(),
        )
        .await?;

    // Calculate monthly rate (days signed in / days in month)
    let now = Local::now();
    let days_in_month = days_in_month(now.year(), now.month());
    let monthly_days = monthly_signins.len() as i32;
    let monthly_rate = monthly_days as f64 / days_in_month as f64;

    // Calculate total points (sum of all reward amounts)
    let total_points: i32 = monthly_signins.iter().map(|s| s.reward_amount).sum();

    let response = match stats {
        Some(s) => CheckInStatsResponse {
            workspace_id: workspace_id.clone(),
            user_id: query.user_id.clone(),
            total_days: s.total_days,
            current_streak: s.current_streak,
            longest_streak: s.longest_streak,
            monthly_rate,
            monthly_days,
            total_points,
            ad_claim_count: s.ad_claim_count,
            last_signin_date: s.last_signin_date,
            last_signin_at: s.last_signin_at,
        },
        None => CheckInStatsResponse {
            workspace_id: workspace_id.clone(),
            user_id: query.user_id.clone(),
            total_days: 0,
            current_streak: 0,
            longest_streak: 0,
            monthly_rate: 0.0,
            monthly_days: 0,
            total_points: 0,
            ad_claim_count: 0,
            last_signin_date: None,
            last_signin_at: None,
        },
    };

    Ok(Json(serde_json::to_value(response).unwrap()))
}

// ── History Endpoint (AC2) ───────────────────────────────────────────────────

/// GET /api/game/workspaces/{workspace_id}/check-in/history
///
/// Returns paginated check-in history for a user, optionally filtered by month.
async fn get_checkin_history(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<CheckInHistoryQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let month = query.month.clone().unwrap_or_else(|| {
        Local::now().format("%Y-%m").to_string()
    });

    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(30).min(100).max(1);
    let offset = (page - 1) * page_size;

    // Get sign-ins for the month
    let all_signins = state
        .daily_signin_store
        .get_monthly_signins(&workspace_id, &query.user_id, &month)
        .await?;

    let total = all_signins.len() as u32;
    let total_pages = (total + page_size - 1) / page_size;

    // Paginate
    let records: Vec<CheckInRecord> = all_signins
        .into_iter()
        .skip(offset as usize)
        .take(page_size as usize)
        .map(|s| CheckInRecord {
            id: s.id,
            signin_date: s.signin_date,
            signin_at: s.signin_at,
            is_makeup: s.status == "makeup", // 补签标记
            status: s.status,
            is_consecutive: s.is_consecutive,
            consecutive_days: s.consecutive_days,
            reward_amount: s.reward_amount,
            reward_type: s.reward_item_id,
        })
        .collect();

    let response = CheckInHistoryResponse {
        records,
        pagination: PaginationInfo {
            page,
            page_size,
            total,
            total_pages,
        },
    };

    Ok(Json(serde_json::to_value(response).unwrap()))
}

// ── Export Endpoint (AC3) ────────────────────────────────────────────────────

/// GET /api/game/workspaces/{workspace_id}/check-in/export
///
/// Exports check-in data as CSV or JSON.
async fn export_checkin_data(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<CheckInExportQuery>,
) -> Result<(HeaderMap, Vec<u8>), ServerError> {
    let format = query.format.as_deref().unwrap_or("csv");
    let from_date = query.from_date.clone();
    let to_date = query.to_date.clone();

    // Get all sign-ins (no date filter since store doesn't support range queries directly)
    // For now, get current month data as default
    let month = Local::now().format("%Y-%m").to_string();
    let signins = state
        .daily_signin_store
        .get_monthly_signins(&workspace_id, &query.user_id, &month)
        .await?;

    // Filter by date range if provided
    let filtered_signins: Vec<_> = signins
        .into_iter()
        .filter(|s| {
            let within_from = from_date
                .as_ref()
                .map(|d| s.signin_date >= *d)
                .unwrap_or(true);
            let within_to = to_date
                .as_ref()
                .map(|d| s.signin_date <= *d)
                .unwrap_or(true);
            within_from && within_to
        })
        .collect();

    // Get consecutive reward thresholds for milestone info
    let rewards = state
        .consecutive_reward_store
        .get_active_rewards(&workspace_id)
        .await?;

    let mut headers = HeaderMap::new();

    if format == "json" {
        // JSON export
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let export_data: Vec<serde_json::Value> = filtered_signins
            .iter()
            .map(|s| {
                let milestone = rewards.iter().find(|r| r.threshold_days <= s.consecutive_days);
                serde_json::json!({
                    "date": s.signin_date,
                    "signedIn": true,
                    "isMakeup": s.status == "makeup",
                    "points": s.reward_amount,
                    "streakDays": s.consecutive_days,
                    "milestoneReached": milestone.map(|m| m.name.clone()),
                })
            })
            .collect();

        let body = serde_json::to_vec(&export_data).unwrap();
        return Ok((headers, body));
    }

    // CSV export (default)
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    headers.insert(
        "Content-Disposition",
        HeaderValue::from_str(&format!(
            "attachment; filename=\"checkin_export_{}.csv\"",
            Local::now().format("%Y%m%d")
        ))
        .unwrap(),
    );

    let mut csv = String::from("日期,是否签到,是否补签,获得积分数,连续天数,阶梯达成情况\n");

    for s in &filtered_signins {
        let milestone = rewards.iter().find(|r| r.threshold_days <= s.consecutive_days);
        let milestone_name = milestone.map(|m| m.name.as_str()).unwrap_or("");
        let is_makeup = if s.status == "makeup" { "是" } else { "否" };

        csv.push_str(&format!(
            "{},是,{},{},{},{}\n",
            s.signin_date,
            is_makeup,
            s.reward_amount,
            s.consecutive_days,
            milestone_name
        ));
    }

    Ok((headers, csv.into_bytes()))
}

// ── Legacy Routes (for status check-in integration) ─────────────────────────

/// GET /api/game/workspaces/{workspace_id}/daily-signin/status
async fn get_daily_signin_status(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<CheckInStatsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let stats = state
        .daily_signin_store
        .get_status(&workspace_id, &query.user_id)
        .await?;

    Ok(Json(serde_json::to_value(stats).unwrap_or(serde_json::json!({
        "workspaceId": workspace_id,
        "userId": query.user_id,
        "totalDays": 0,
        "currentStreak": 0,
        "longestStreak": 0,
        "monthlyDays": 0,
        "adClaimCount": 0,
    }))))
}

/// POST /api/game/workspaces/{workspace_id}/daily-signin/signin
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SigninRequest {
    pub user_id: String,
}

async fn process_daily_signin(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<SigninRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let today = Local::now().format("%Y-%m-%d").to_string();

    // Check if already signed in
    let already_signed = state
        .daily_signin_store
        .has_signed_in_today(&workspace_id, &body.user_id, &today)
        .await?;

    if already_signed {
        return Ok(Json(serde_json::json!({
            "success": false,
            "error": "Already signed in today",
        })));
    }

    // Get last sign-in date for streak calculation
    let last_date = state
        .daily_signin_store
        .get_last_signin_date(&workspace_id, &body.user_id)
        .await?;

    let is_consecutive = last_date
        .map(|d| {
            let last = NaiveDate::parse_from_str(&d, "%Y-%m-%d").unwrap_or_default();
            let today_date = Local::now().date_naive();
            let diff = today_date.signed_duration_since(last).num_days();
            diff == 1
        })
        .unwrap_or(true);

    // Calculate consecutive days
    let last_streak = state
        .daily_signin_store
        .get_status(&workspace_id, &body.user_id)
        .await?
        .map(|s| s.current_streak)
        .unwrap_or(0);

    let consecutive_days = if is_consecutive { last_streak + 1 } else { 1 };

    // Default reward amount (can be expanded to lookup rewards table)
    let reward_amount = 10 + consecutive_days * 2; // Simple scaling

    // Record sign-in
    let signin = state
        .daily_signin_store
        .signin(
            &workspace_id,
            &body.user_id,
            &today,
            is_consecutive,
            consecutive_days,
            None,
            reward_amount,
        )
        .await?;

    // Update stats
    let stats = state
        .daily_signin_store
        .get_status(&workspace_id, &body.user_id)
        .await?
        .unwrap_or_else(|| {
            use routa_core::store::SigninStats;
            use chrono::Utc;
            SigninStats {
                workspace_id: workspace_id.clone(),
                user_id: body.user_id.clone(),
                total_days: 0,
                current_streak: 0,
                longest_streak: 0,
                monthly_days: 0,
                ad_claim_count: 0,
                last_signin_date: None,
                last_signin_at: None,
                created_at: Utc::now().timestamp_millis(),
                updated_at: Utc::now().timestamp_millis(),
            }
        });

    let mut new_stats = stats;
    new_stats.total_days += 1;
    new_stats.current_streak = consecutive_days;
    new_stats.longest_streak = new_stats.longest_streak.max(consecutive_days);
    new_stats.monthly_days += 1;
    new_stats.last_signin_date = Some(today.clone());
    new_stats.last_signin_at = Some(Utc::now().timestamp_millis());

    state.daily_signin_store.upsert_stats(&new_stats).await?;

    // Check for milestone reward
    let milestone = state
        .consecutive_reward_store
        .get_reward_by_threshold(&workspace_id, consecutive_days as i32)
        .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "signin": {
            "id": signin.id,
            "workspaceId": workspace_id,
            "userId": body.user_id,
            "signinDate": signin.signin_date,
            "signinAt": signin.signin_at,
            "status": signin.status,
            "isConsecutive": signin.is_consecutive,
            "consecutiveDays": signin.consecutive_days,
            "rewardAmount": signin.reward_amount,
        },
        "stats": {
            "workspaceId": workspace_id,
            "userId": body.user_id,
            "totalDays": new_stats.total_days,
            "currentStreak": new_stats.current_streak,
            "longestStreak": new_stats.longest_streak,
            "monthlyDays": new_stats.monthly_days,
            "adClaimCount": new_stats.ad_claim_count,
            "lastSigninDate": new_stats.last_signin_date,
            "lastSigninAt": new_stats.last_signin_at,
        },
        "reward": {
            "name": "积分",
            "rewardType": "points",
            "amount": signin.reward_amount,
        },
        "milestoneReward": milestone,
    })))
}

/// GET /api/game/workspaces/{workspace_id}/daily-signin/rewards
async fn get_signin_rewards(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let rewards = state
        .consecutive_reward_store
        .get_active_rewards(&workspace_id)
        .await?;

    Ok(Json(serde_json::json!({ "rewards": rewards })))
}

// ── Analytics Endpoint (AC4) ─────────────────────────────────────────────────

/// GET /api/game/workspaces/{workspace_id}/daily-signin/analytics
///
/// Returns workspace-level check-in analytics for Feature Explorer integration.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsQuery {
    pub workspace_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInAnalyticsResponse {
    pub workspace_id: String,
    pub total_users: i32,
    pub active_users: i32,
    pub daily_checkin_rate: f64,
    pub trend: Vec<DailyTrend>,
    pub milestone_distribution: Vec<MilestoneDistribution>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTrend {
    pub date: String,
    pub checkin_count: i32,
    pub active_users: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneDistribution {
    pub streak: String,
    pub count: i32,
}

async fn get_checkin_analytics(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let today = Local::now().format("%Y-%m-%d").to_string();

    // Get all unique users who have ever signed in
    let total_users = state
        .daily_signin_store
        .get_unique_user_count(&workspace_id)
        .await?;

    // Get active users (signed in today)
    let active_users = state
        .daily_signin_store
        .get_active_user_count(&workspace_id, &today)
        .await?;

    // Calculate daily check-in rate
    let daily_checkin_rate = if total_users > 0 {
        active_users as f64 / total_users as f64
    } else {
        0.0
    };

    // Get trend data (last 7 days)
    let mut trend = Vec::new();
    for i in (0..7).rev() {
        let date = (Local::now() - chrono::Duration::days(i))
            .format("%Y-%m-%d")
            .to_string();
        let checkin_count = state
            .daily_signin_store
            .get_daily_checkin_count(&workspace_id, &date)
            .await?;
        let day_active_users = state
            .daily_signin_store
            .get_active_user_count(&workspace_id, &date)
            .await?;
        trend.push(DailyTrend {
            date,
            checkin_count,
            active_users: day_active_users,
        });
    }

    // Get milestone distribution
    let milestone_distribution = state
        .daily_signin_store
        .get_milestone_distribution(&workspace_id)
        .await?
        .into_iter()
        .map(|(streak, count)| MilestoneDistribution { streak, count })
        .collect();

    let response = CheckInAnalyticsResponse {
        workspace_id,
        total_users,
        active_users,
        daily_checkin_rate,
        trend,
        milestone_distribution,
    };

    Ok(Json(serde_json::to_value(response).unwrap()))
}

// ── Helper Functions ────────────────────────────────────────────────────────

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}