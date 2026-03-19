use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde_json::{json, Value};

use routa_server::{start_server, ServerConfig};

struct ApiFixture {
    base_url: String,
    client: Client,
    db_path: PathBuf,
}

impl ApiFixture {
    async fn new() -> Self {
        let db_path = random_db_path();

        let config = ServerConfig {
            host: "127.0.0.1".to_string(),
            port: 0,
            db_path: db_path.to_string_lossy().to_string(),
            static_dir: None,
        };

        let addr = start_server(config)
            .await
            .expect("start server for api fixture");
        let base_url = format!("http://{addr}");
        let client = Client::new();
        let fixture = Self {
            base_url,
            client,
            db_path,
        };
        fixture.wait_until_ready().await;
        fixture
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn wait_until_ready(&self) {
        for _ in 0..50 {
            if self
                .client
                .get(self.endpoint("/api/health"))
                .send()
                .await
                .is_ok_and(|resp| resp.status() == StatusCode::OK)
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }

        panic!("server did not become ready");
    }
}

impl Drop for ApiFixture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.db_path);
    }
}

fn random_db_path() -> PathBuf {
    std::env::temp_dir().join(format!("routa-server-api-{}.db", uuid::Uuid::new_v4()))
}

fn json_has_error(resp: &Value, expected: &str) -> bool {
    resp.get("error")
        .and_then(Value::as_str)
        .is_some_and(|message| message.contains(expected))
}

#[tokio::test]
async fn api_task_artifact_flow_and_gate() {
    let fixture = ApiFixture::new().await;

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"].as_str().expect("board id");

    let board_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .send()
        .await
        .expect("get board");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_json: Value = board_response.json().await.expect("decode board");
    let mut columns = board_json["board"]["columns"]
        .as_array()
        .expect("columns array")
        .clone();
    let review = columns
        .iter_mut()
        .find(|column| column["id"].as_str() == Some("review"))
        .expect("review column");
    review["automation"] = json!({
        "enabled": true,
        "requiredArtifacts": ["screenshot"]
    });

    let update_board = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "columns": columns }))
        .send()
        .await
        .expect("update board");
    assert_eq!(update_board.status(), StatusCode::OK);

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Artifact gated task",
            "objective": "Require screenshot before review",
            "workspaceId": "default",
            "boardId": board_id,
            "columnId": "todo"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let task_json: Value = create_task.json().await.expect("decode task");
    let task_id = task_json["task"]["id"].as_str().expect("task id");

    let blocked_move = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({ "columnId": "review" }))
        .send()
        .await
        .expect("move blocked");
    assert_eq!(blocked_move.status(), StatusCode::BAD_REQUEST);
    let blocked_json: Value = blocked_move.json().await.expect("decode blocked move");
    assert!(json_has_error(
        &blocked_json,
        "missing required artifacts: screenshot"
    ));

    let create_artifact = fixture
        .client
        .post(fixture.endpoint(&format!("/api/tasks/{task_id}/artifacts")))
        .json(&json!({
            "agentId": "agent-1",
            "type": "screenshot",
            "content": "base64-image",
            "context": "Review screenshot"
        }))
        .send()
        .await
        .expect("create artifact");
    assert_eq!(create_artifact.status(), StatusCode::CREATED);

    let list_artifacts = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}/artifacts")))
        .send()
        .await
        .expect("list artifacts");
    assert_eq!(list_artifacts.status(), StatusCode::OK);
    let artifacts_json: Value = list_artifacts.json().await.expect("decode artifacts");
    assert_eq!(
        artifacts_json["artifacts"]
            .as_array()
            .expect("artifact array")
            .len(),
        1
    );

    let allowed_move = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({ "columnId": "review" }))
        .send()
        .await
        .expect("move allowed");
    assert_eq!(allowed_move.status(), StatusCode::OK);
}
