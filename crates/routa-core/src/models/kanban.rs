use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Automation configuration for a Kanban column.
/// When a card is moved to this column, the automation can trigger an agent session.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumnAutomation {
    /// Whether automation is enabled for this column
    #[serde(default)]
    pub enabled: bool,
    /// Provider ID to use for the automation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    /// Role for the agent (CRAFTER, ROUTA, GATE, DEVELOPER)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Specialist ID to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_id: Option<String>,
    /// Specialist name (for display)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumn {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub position: i64,
    pub stage: String,
    /// Automation configuration for this column
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation: Option<KanbanColumnAutomation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanBoard {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub is_default: bool,
    pub columns: Vec<KanbanColumn>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub fn default_kanban_columns() -> Vec<KanbanColumn> {
    vec![
        KanbanColumn {
            id: "backlog".to_string(),
            name: "Backlog".to_string(),
            color: Some("slate".to_string()),
            position: 0,
            stage: "backlog".to_string(),
            automation: None,
        },
        KanbanColumn {
            id: "todo".to_string(),
            name: "Todo".to_string(),
            color: Some("sky".to_string()),
            position: 1,
            stage: "todo".to_string(),
            automation: None,
        },
        KanbanColumn {
            id: "dev".to_string(),
            name: "Dev".to_string(),
            color: Some("amber".to_string()),
            position: 2,
            stage: "dev".to_string(),
            automation: None,
        },
        KanbanColumn {
            id: "review".to_string(),
            name: "Review".to_string(),
            color: Some("violet".to_string()),
            position: 3,
            stage: "review".to_string(),
            automation: None,
        },
        KanbanColumn {
            id: "blocked".to_string(),
            name: "Blocked".to_string(),
            color: Some("rose".to_string()),
            position: 4,
            stage: "blocked".to_string(),
            automation: None,
        },
        KanbanColumn {
            id: "done".to_string(),
            name: "Done".to_string(),
            color: Some("emerald".to_string()),
            position: 5,
            stage: "done".to_string(),
            automation: None,
        },
    ]
}

pub fn default_kanban_board(workspace_id: String) -> KanbanBoard {
    let now = Utc::now();

    KanbanBoard {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id,
        name: "Board".to_string(),
        is_default: true,
        columns: default_kanban_columns(),
        created_at: now,
        updated_at: now,
    }
}