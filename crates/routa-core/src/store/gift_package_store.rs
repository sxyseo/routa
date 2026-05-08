//! Gift Package and Daily Sign-in Store
//!
//! Handles gift packages, daily sign-in tracking, consecutive rewards, and claim records.

use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::Database;
use crate::error::ServerError;

// ── Models ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySignin {
    pub id: String,
    pub workspace_id: String,
    pub user_id: String,
    pub signin_date: String,
    pub signin_at: i64,
    pub status: String,
    pub is_consecutive: bool,
    pub consecutive_days: i32,
    pub reward_item_id: Option<String>,
    pub reward_amount: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigninReward {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub reward_type: String,
    pub item_id: String,
    pub amount: i32,
    pub icon_url: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigninStats {
    pub workspace_id: String,
    pub user_id: String,
    pub total_days: i32,
    pub current_streak: i32,
    pub longest_streak: i32,
    pub monthly_days: i32,
    pub ad_claim_count: i32,
    pub last_signin_date: Option<String>,
    pub last_signin_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsecutiveReward {
    pub id: String,
    pub workspace_id: String,
    pub threshold_days: i32,
    pub name: String,
    pub reward_type: String,
    pub item_id: String,
    pub amount: i32,
    pub icon_url: Option<String>,
    pub is_claimed: bool,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardClaimRecord {
    pub id: String,
    pub workspace_id: String,
    pub user_id: String,
    pub reward_id: String,
    pub reward_name: String,
    pub claimed_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Makeup check-in record for missed days
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MakeupCheckInRecord {
    pub id: String,
    pub workspace_id: String,
    pub user_id: String,
    pub makeup_date: String,
    pub ad_watched_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Result of a makeup check-in operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MakeupCheckInResult {
    pub success: bool,
    pub record: Option<MakeupCheckInRecord>,
    pub current_streak: i32,
    pub remaining_makeup: i32,
    pub milestone_reward: Option<ConsecutiveReward>,
    pub error: Option<String>,
}

/// Validation result for makeup check-in eligibility
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MakeupCheckInValidation {
    pub eligible: bool,
    pub reason: Option<String>,
    pub remaining_makeup: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigninResult {
    pub signin: DailySignin,
    pub reward: Option<SigninReward>,
    pub milestone_reward: Option<ConsecutiveReward>,
    pub stats: SigninStats,
}

// ── DailySigninStore ─────────────────────────────────────────────────────

pub struct DailySigninStore {
    db: Database,
}

impl DailySigninStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// Record a new daily sign-in for a user
    pub async fn signin(
        &self,
        workspace_id: &str,
        user_id: &str,
        signin_date: &str,
        is_consecutive: bool,
        consecutive_days: i32,
        reward_item_id: Option<&str>,
        reward_amount: i32,
    ) -> Result<DailySignin, ServerError> {
        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let status = "normal".to_string();

        // Prepare values for the DB insert
        let insert_id = id.clone();
        let insert_workspace_id = workspace_id.to_string();
        let insert_user_id = user_id.to_string();
        let insert_signin_date = signin_date.to_string();
        let insert_reward_item_id = reward_item_id.map(|s| s.to_string());
        let insert_is_consecutive = is_consecutive as i32;
        let insert_status = status.clone();

        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO daily_signins
                     (id, workspace_id, user_id, signin_date, signin_at, status, is_consecutive, consecutive_days, reward_item_id, reward_amount, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![
                        insert_id,
                        insert_workspace_id,
                        insert_user_id,
                        insert_signin_date,
                        now,
                        insert_status,
                        insert_is_consecutive,
                        consecutive_days,
                        insert_reward_item_id,
                        reward_amount,
                        now,
                        now,
                    ],
                )?;
                Ok(())
            })
            .await?;

        Ok(DailySignin {
            id,
            workspace_id: workspace_id.to_string(),
            user_id: user_id.to_string(),
            signin_date: signin_date.to_string(),
            signin_at: now,
            status,
            is_consecutive,
            consecutive_days,
            reward_item_id: reward_item_id.map(|s| s.to_string()),
            reward_amount,
            created_at: now,
            updated_at: now,
        })
    }

    /// Get sign-in status for a user
    pub async fn get_status(
        &self,
        workspace_id: &str,
        user_id: &str,
    ) -> Result<Option<SigninStats>, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT workspace_id, user_id, total_days, current_streak, longest_streak,
                            monthly_days, ad_claim_count, last_signin_date, last_signin_at, created_at, updated_at
                     FROM signin_stats
                     WHERE workspace_id = ?1 AND user_id = ?2",
                )?;
                stmt.query_row(rusqlite::params![workspace_id, user_id], |row| {
                    Ok(SigninStats {
                        workspace_id: row.get(0)?,
                        user_id: row.get(1)?,
                        total_days: row.get(2)?,
                        current_streak: row.get(3)?,
                        longest_streak: row.get(4)?,
                        monthly_days: row.get(5)?,
                        ad_claim_count: row.get(6)?,
                        last_signin_date: row.get(7)?,
                        last_signin_at: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                })
                .optional()
            })
            .await
    }

    /// Update or create sign-in stats
    pub async fn upsert_stats(&self, stats: &SigninStats) -> Result<(), ServerError> {
        let stats = stats.clone();
        let now = Utc::now().timestamp_millis();

        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO signin_stats
                     (workspace_id, user_id, total_days, current_streak, longest_streak, monthly_days, ad_claim_count, last_signin_date, last_signin_at, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                     ON CONFLICT(workspace_id, user_id) DO UPDATE SET
                       total_days = excluded.total_days,
                       current_streak = excluded.current_streak,
                       longest_streak = excluded.longest_streak,
                       monthly_days = excluded.monthly_days,
                       ad_claim_count = excluded.ad_claim_count,
                       last_signin_date = excluded.last_signin_date,
                       last_signin_at = excluded.last_signin_at,
                       updated_at = excluded.updated_at",
                    rusqlite::params![
                        stats.workspace_id,
                        stats.user_id,
                        stats.total_days,
                        stats.current_streak,
                        stats.longest_streak,
                        stats.monthly_days,
                        stats.ad_claim_count,
                        stats.last_signin_date,
                        stats.last_signin_at,
                        stats.created_at,
                        now,
                    ],
                )?;
                Ok(())
            })
            .await
    }

    /// Get sign-in history for a user in the current month
    pub async fn get_monthly_signins(
        &self,
        workspace_id: &str,
        user_id: &str,
        year_month: &str,
    ) -> Result<Vec<DailySignin>, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();
        let pattern = format!("{}-%", year_month);

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, user_id, signin_date, signin_at, status,
                            is_consecutive, consecutive_days, reward_item_id, reward_amount, created_at, updated_at
                     FROM daily_signins
                     WHERE workspace_id = ?1 AND user_id = ?2 AND signin_date LIKE ?3
                     ORDER BY signin_date ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id, user_id, pattern], |row| {
                        Ok(DailySignin {
                            id: row.get(0)?,
                            workspace_id: row.get(1)?,
                            user_id: row.get(2)?,
                            signin_date: row.get(3)?,
                            signin_at: row.get(4)?,
                            status: row.get(5)?,
                            is_consecutive: row.get::<_, i32>(6)? != 0,
                            consecutive_days: row.get(7)?,
                            reward_item_id: row.get(8)?,
                            reward_amount: row.get(9)?,
                            created_at: row.get(10)?,
                            updated_at: row.get(11)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    /// Check if user has already signed in today
    pub async fn has_signed_in_today(
        &self,
        workspace_id: &str,
        user_id: &str,
        date: &str,
    ) -> Result<bool, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();
        let date = date.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT COUNT(*) FROM daily_signins
                     WHERE workspace_id = ?1 AND user_id = ?2 AND signin_date = ?3",
                )?;
                let count: i32 = stmt.query_row(rusqlite::params![workspace_id, user_id, date], |row| row.get(0))?;
                Ok(count > 0)
            })
            .await
    }

    /// Get the last sign-in date for streak calculation
    pub async fn get_last_signin_date(
        &self,
        workspace_id: &str,
        user_id: &str,
    ) -> Result<Option<String>, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT signin_date FROM daily_signins
                     WHERE workspace_id = ?1 AND user_id = ?2
                     ORDER BY signin_at DESC LIMIT 1",
                )?;
                stmt.query_row(rusqlite::params![workspace_id, user_id], |row| row.get(0))
                    .optional()
            })
            .await
    }

    /// Get count of unique users who have ever signed in
    pub async fn get_unique_user_count(
        &self,
        workspace_id: &str,
    ) -> Result<i32, ServerError> {
        let workspace_id = workspace_id.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT COUNT(DISTINCT user_id) FROM daily_signins
                     WHERE workspace_id = ?1",
                )?;
                let count: i32 = stmt.query_row(rusqlite::params![workspace_id], |row| row.get(0))?;
                Ok(count)
            })
            .await
    }

    /// Get count of users who signed in on a specific date
    pub async fn get_active_user_count(
        &self,
        workspace_id: &str,
        date: &str,
    ) -> Result<i32, ServerError> {
        let workspace_id = workspace_id.to_string();
        let date = date.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT COUNT(DISTINCT user_id) FROM daily_signins
                     WHERE workspace_id = ?1 AND signin_date = ?2",
                )?;
                let count: i32 = stmt.query_row(rusqlite::params![workspace_id, date], |row| row.get(0))?;
                Ok(count)
            })
            .await
    }

    /// Get total check-ins on a specific date
    pub async fn get_daily_checkin_count(
        &self,
        workspace_id: &str,
        date: &str,
    ) -> Result<i32, ServerError> {
        let workspace_id = workspace_id.to_string();
        let date = date.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT COUNT(*) FROM daily_signins
                     WHERE workspace_id = ?1 AND signin_date = ?2",
                )?;
                let count: i32 = stmt.query_row(rusqlite::params![workspace_id, date], |row| row.get(0))?;
                Ok(count)
            })
            .await
    }

    /// Get milestone distribution (streak ranges)
    pub async fn get_milestone_distribution(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<(String, i32)>, ServerError> {
        let workspace_id = workspace_id.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT
                        CASE
                            WHEN longest_streak >= 30 THEN '30+'
                            WHEN longest_streak >= 14 THEN '14-29'
                            WHEN longest_streak >= 7 THEN '7-13'
                            WHEN longest_streak >= 3 THEN '3-6'
                            ELSE '1-2'
                        END as streak_range,
                        COUNT(*) as count
                     FROM signin_stats
                     WHERE workspace_id = ?1
                     GROUP BY streak_range
                     ORDER BY
                        CASE streak_range
                            WHEN '30+' THEN 1
                            WHEN '14-29' THEN 2
                            WHEN '7-13' THEN 3
                            WHEN '3-6' THEN 4
                            ELSE 5
                        END",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }
}

// ── ConsecutiveRewardStore ─────────────────────────────────────────────────

pub struct ConsecutiveRewardStore {
    db: Database,
}

impl ConsecutiveRewardStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// Create or update a consecutive reward threshold
    pub async fn upsert_reward(
        &self,
        workspace_id: &str,
        threshold_days: i32,
        name: &str,
        reward_type: &str,
        item_id: &str,
        amount: i32,
        icon_url: Option<&str>,
    ) -> Result<ConsecutiveReward, ServerError> {
        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let status = "active".to_string();

        // Prepare values for the DB insert
        let insert_id = id.clone();
        let insert_workspace_id = workspace_id.to_string();
        let insert_name = name.to_string();
        let insert_reward_type = reward_type.to_string();
        let insert_item_id = item_id.to_string();
        let insert_icon_url = icon_url.map(|s| s.to_string());

        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO consecutive_rewards
                     (id, workspace_id, threshold_days, name, reward_type, item_id, amount, icon_url, is_claimed, status, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 'active', ?9, ?10)
                     ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name,
                       reward_type = excluded.reward_type,
                       item_id = excluded.item_id,
                       amount = excluded.amount,
                       icon_url = excluded.icon_url,
                       updated_at = excluded.updated_at",
                    rusqlite::params![
                        insert_id,
                        insert_workspace_id,
                        threshold_days,
                        insert_name,
                        insert_reward_type,
                        insert_item_id,
                        amount,
                        insert_icon_url,
                        now,
                        now,
                    ],
                )?;
                Ok(())
            })
            .await?;

        Ok(ConsecutiveReward {
            id,
            workspace_id: workspace_id.to_string(),
            threshold_days,
            name: name.to_string(),
            reward_type: reward_type.to_string(),
            item_id: item_id.to_string(),
            amount,
            icon_url: icon_url.map(|s| s.to_string()),
            is_claimed: false,
            status,
            created_at: now,
            updated_at: now,
        })
    }

    /// Get all active consecutive rewards for a workspace
    pub async fn get_active_rewards(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<ConsecutiveReward>, ServerError> {
        let workspace_id = workspace_id.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, threshold_days, name, reward_type, item_id, amount, icon_url, is_claimed, status, created_at, updated_at
                     FROM consecutive_rewards
                     WHERE workspace_id = ?1 AND status = 'active'
                     ORDER BY threshold_days ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id], |row| {
                        Ok(ConsecutiveReward {
                            id: row.get(0)?,
                            workspace_id: row.get(1)?,
                            threshold_days: row.get(2)?,
                            name: row.get(3)?,
                            reward_type: row.get(4)?,
                            item_id: row.get(5)?,
                            amount: row.get(6)?,
                            icon_url: row.get(7)?,
                            is_claimed: row.get::<_, i32>(8)? != 0,
                            status: row.get(9)?,
                            created_at: row.get(10)?,
                            updated_at: row.get(11)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    /// Get rewards for a specific streak threshold
    pub async fn get_reward_by_threshold(
        &self,
        workspace_id: &str,
        threshold_days: i32,
    ) -> Result<Option<ConsecutiveReward>, ServerError> {
        let workspace_id = workspace_id.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, threshold_days, name, reward_type, item_id, amount, icon_url, is_claimed, status, created_at, updated_at
                     FROM consecutive_rewards
                     WHERE workspace_id = ?1 AND threshold_days = ?2 AND status = 'active'",
                )?;
                stmt.query_row(rusqlite::params![workspace_id, threshold_days], |row| {
                    Ok(ConsecutiveReward {
                        id: row.get(0)?,
                        workspace_id: row.get(1)?,
                        threshold_days: row.get(2)?,
                        name: row.get(3)?,
                        reward_type: row.get(4)?,
                        item_id: row.get(5)?,
                        amount: row.get(6)?,
                        icon_url: row.get(7)?,
                        is_claimed: row.get::<_, i32>(8)? != 0,
                        status: row.get(9)?,
                        created_at: row.get(10)?,
                        updated_at: row.get(11)?,
                    })
                })
                .optional()
            })
            .await
    }

    /// Check if a milestone reward has been claimed
    pub async fn is_reward_claimed(
        &self,
        workspace_id: &str,
        user_id: &str,
        reward_id: &str,
    ) -> Result<bool, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();
        let reward_id = reward_id.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT COUNT(*) FROM reward_claim_records
                     WHERE workspace_id = ?1 AND user_id = ?2 AND reward_id = ?3",
                )?;
                let count: i32 = stmt.query_row(rusqlite::params![workspace_id, user_id, reward_id], |row| row.get(0))?;
                Ok(count > 0)
            })
            .await
    }

    /// Record a reward claim
    pub async fn record_claim(
        &self,
        workspace_id: &str,
        user_id: &str,
        reward_id: &str,
        reward_name: &str,
    ) -> Result<RewardClaimRecord, ServerError> {
        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();

        // Prepare values for the DB insert
        let insert_id = id.clone();
        let insert_workspace_id = workspace_id.to_string();
        let insert_user_id = user_id.to_string();
        let insert_reward_id = reward_id.to_string();
        let insert_reward_name = reward_name.to_string();

        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO reward_claim_records
                     (id, workspace_id, user_id, reward_id, reward_name, claimed_at, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        insert_id,
                        insert_workspace_id,
                        insert_user_id,
                        insert_reward_id,
                        insert_reward_name,
                        now,
                        now,
                        now,
                    ],
                )?;
                Ok(())
            })
            .await?;

        Ok(RewardClaimRecord {
            id,
            workspace_id: workspace_id.to_string(),
            user_id: user_id.to_string(),
            reward_id: reward_id.to_string(),
            reward_name: reward_name.to_string(),
            claimed_at: now,
            created_at: now,
            updated_at: now,
        })
    }

    /// Get claimed rewards for a user
    pub async fn get_user_claims(
        &self,
        workspace_id: &str,
        user_id: &str,
    ) -> Result<Vec<RewardClaimRecord>, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, user_id, reward_id, reward_name, claimed_at, created_at, updated_at
                     FROM reward_claim_records
                     WHERE workspace_id = ?1 AND user_id = ?2
                     ORDER BY claimed_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id, user_id], |row| {
                        Ok(RewardClaimRecord {
                            id: row.get(0)?,
                            workspace_id: row.get(1)?,
                            user_id: row.get(2)?,
                            reward_id: row.get(3)?,
                            reward_name: row.get(4)?,
                            claimed_at: row.get(5)?,
                            created_at: row.get(6)?,
                            updated_at: row.get(7)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    /// Initialize default consecutive rewards for a workspace
    pub async fn initialize_default_rewards(&self, workspace_id: &str) -> Result<(), ServerError> {
        let rewards = vec![
            (3, "3天连续签到", "coins", "coins", 100, None::<&str>),
            (7, "7天连续签到", "coins", "coins", 300, None),
            (14, "14天连续签到", "coins", "coins", 700, None),
            (30, "30天连续签到", "coins", "coins", 1500, None),
        ];

        for (threshold, name, reward_type, item_id, amount, icon_url) in rewards {
            self.upsert_reward(workspace_id, threshold, name, reward_type, item_id, amount, icon_url)
                .await?;
        }

        Ok(())
    }
}

// ── Re-exports ─────────────────────────────────────────────────────────────

pub use DailySigninStore as GiftPackageStore;

// ── MakeupCheckInStore ─────────────────────────────────────────────────────

pub struct MakeupCheckInStore {
    db: Database,
}

impl MakeupCheckInStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// Record a makeup check-in for a missed day
    pub async fn record_makeup(
        &self,
        workspace_id: &str,
        user_id: &str,
        makeup_date: &str,
        ad_watched_at: i64,
    ) -> Result<MakeupCheckInRecord, ServerError> {
        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();

        // Prepare values for the DB insert
        let insert_id = id.clone();
        let insert_workspace_id = workspace_id.to_string();
        let insert_user_id = user_id.to_string();
        let insert_makeup_date = makeup_date.to_string();

        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO makeup_check_in_records
                     (id, workspace_id, user_id, makeup_date, ad_watched_at, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        insert_id,
                        insert_workspace_id,
                        insert_user_id,
                        insert_makeup_date,
                        ad_watched_at,
                        now,
                        now,
                    ],
                )?;
                Ok(())
            })
            .await?;

        Ok(MakeupCheckInRecord {
            id,
            workspace_id: workspace_id.to_string(),
            user_id: user_id.to_string(),
            makeup_date: makeup_date.to_string(),
            ad_watched_at,
            created_at: now,
            updated_at: now,
        })
    }

    /// Check if user has already made up a specific date
    pub async fn has_makeup_for_date(
        &self,
        workspace_id: &str,
        user_id: &str,
        makeup_date: &str,
    ) -> Result<bool, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();
        let makeup_date = makeup_date.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT COUNT(*) FROM makeup_check_in_records
                     WHERE workspace_id = ?1 AND user_id = ?2 AND makeup_date = ?3",
                )?;
                let count: i32 = stmt.query_row(rusqlite::params![workspace_id, user_id, makeup_date], |row| row.get(0))?;
                Ok(count > 0)
            })
            .await
    }

    /// Get remaining makeup count for today (UTC)
    pub async fn get_remaining_makeup_today(
        &self,
        workspace_id: &str,
        user_id: &str,
        today_date: &str,
    ) -> Result<i32, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();
        let today_date = today_date.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT COUNT(*) FROM makeup_check_in_records
                     WHERE workspace_id = ?1 AND user_id = ?2 AND makeup_date = ?3",
                )?;
                let count: i32 = stmt.query_row(rusqlite::params![workspace_id, user_id, today_date], |row| row.get(0))?;
                // Max 1 makeup per day, so remaining = 1 - used
                Ok(1 - count)
            })
            .await
    }

    /// Get all makeup records for a user in a date range
    pub async fn get_makeup_records_in_range(
        &self,
        workspace_id: &str,
        user_id: &str,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<MakeupCheckInRecord>, ServerError> {
        let workspace_id = workspace_id.to_string();
        let user_id = user_id.to_string();
        let start_date = start_date.to_string();
        let end_date = end_date.to_string();

        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, user_id, makeup_date, ad_watched_at, created_at, updated_at
                     FROM makeup_check_in_records
                     WHERE workspace_id = ?1 AND user_id = ?2 AND makeup_date >= ?3 AND makeup_date <= ?4
                     ORDER BY makeup_date ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id, user_id, start_date, end_date], |row| {
                        Ok(MakeupCheckInRecord {
                            id: row.get(0)?,
                            workspace_id: row.get(1)?,
                            user_id: row.get(2)?,
                            makeup_date: row.get(3)?,
                            ad_watched_at: row.get(4)?,
                            created_at: row.get(5)?,
                            updated_at: row.get(6)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    /// Check if a date is within the makeup range (past 3 days, not including today)
    pub fn is_within_makeup_range(date: &str, today: &str) -> bool {
        // Parse dates - format is YYYY-MM-DD
        let parse_date = |s: &str| -> Option<(i32, i32, i32)> {
            let parts: Vec<&str> = s.split('-').collect();
            if parts.len() != 3 {
                return None;
            }
            let year: i32 = parts[0].parse().ok()?;
            let month: i32 = parts[1].parse().ok()?;
            let day: i32 = parts[2].parse().ok()?;
            Some((year, month, day))
        };

        let today_parsed = match parse_date(today) {
            Some(d) => d,
            None => return false,
        };
        let date_parsed = match parse_date(date) {
            Some(d) => d,
            None => return false,
        };

        // Calculate day difference
        let days_between = |d1: (i32, i32, i32), d2: (i32, i32, i32)| -> i32 {
            let days_from_year = |y: i32, m: i32, d: i32| -> i32 {
                let mut days = 0;
                for year in 0..y {
                    days += if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) { 366 } else { 365 };
                }
                let month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
                for month in 1..m {
                    days += month_days.get((month - 1) as usize).unwrap_or(&28);
                }
                days + d
            };
            days_from_year(d1.0, d1.1, d1.2) as i32 - days_from_year(d2.0, d2.1, d2.2) as i32
        };

        let diff = days_between(today_parsed, date_parsed).abs();
        // Within range: 1-3 days ago (not today)
        diff >= 1 && diff <= 3
    }
}
