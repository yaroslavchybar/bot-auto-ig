pub mod accounts;
pub mod content;
pub mod coordination;
pub mod displays;
pub mod http;
pub mod processes;
pub mod profiles;
pub mod subscriptions;

use crate::api;
use axum::{
    body::to_bytes,
    extract::{Path, Request, State},
    routing::{get, post},
    Json, Router,
};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

pub struct Native {
    pub api: Arc<api::Api>,
    pub content: Arc<content::Content>,
    pub processes: Arc<processes::Processes>,
    pub displays: Arc<displays::Displays>,
    pub subscriptions: Arc<subscriptions::Subscriptions>,
    pub coordination: Arc<coordination::Coordination>,
    pub profiles: Arc<profiles::Profiles>,
    pub accounts: Arc<accounts::Accounts>,
}
impl Native {
    pub async fn shutdown(&self) -> Result<()> {
        self.accounts.shutdown().await;
        self.coordination.shutdown().await;
        self.processes.shutdown().await
    }
    pub fn new(api: Arc<api::Api>, scraper: Arc<crate::scraper::Scraper>) -> Result<Arc<Self>> {
        let root = project_root();
        let content = content::Content::new(
            std::env::var("MODEL_CONTENT_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| root.join("data/model-content")),
        );
        let processes = processes::Processes::new(api.clone(), root.clone());
        let displays = displays::Displays::new(api.clone(), processes.clone());
        let subscriptions = subscriptions::Subscriptions::new(api.clone());
        let profiles = profiles::Profiles::new(api.clone(), processes.clone(), root);
        let accounts = accounts::Accounts::new(
            api.clone(),
            profiles.clone(),
            content.clone(),
            subscriptions.clone(),
        );
        let coordination = coordination::Coordination::new(
            api.clone(),
            subscriptions.clone(),
            processes.clone(),
            scraper,
        );
        Ok(Arc::new(Self {
            api,
            content,
            processes,
            displays,
            subscriptions,
            coordination,
            profiles,
            accounts,
        }))
    }
}

pub fn router(state: Arc<Native>) -> Router {
    Router::new()
        .route("/processes/{action}", post(process_command))
        .route("/coordination/start", post(start_coordination))
        .route("/profiles/{action}", post(profile_command))
        .with_state(state.clone())
        .merge(
            Router::new()
                .route("/profiles/lease", get(profiles::lease))
                .with_state(state.profiles.clone()),
        )
        .merge(
            Router::new()
                .route("/accounts/post-lease", get(accounts::setup::post_lease))
                .route("/accounts/setup-lease", get(accounts::setup::setup_lease))
                .with_state(state.accounts.clone()),
        )
        .merge(
            Router::new()
                .route("/subscriptions", get(subscriptions::upgrade))
                .with_state(state.subscriptions.clone()),
        )
        .merge(
            Router::new()
                .route("/browser/lease", get(displays::browser_lease))
                .route("/displays/lease", get(displays::display_lease))
                .route("/displays/{port}/pointer", get(displays::pointer))
                .with_state(state.displays.clone()),
        )
}

async fn process_command(
    State(state): State<Arc<Native>>,
    Path(action): Path<String>,
) -> Result<Json<Value>> {
    tokio::spawn(async move { run_process_command(state, action).await })
        .await
        .map_err(|_| Failure::unavailable("Process operation failed"))?
}
async fn run_process_command(state: Arc<Native>, action: String) -> Result<Json<Value>> {
    let value = match action.as_str() {
        "shutdown" => {
            state.shutdown().await?;
            json!({"ok": true})
        }
        _ => return Err(Failure::missing("Unknown process operation")),
    };
    Ok(Json(value))
}

async fn start_coordination(State(state): State<Arc<Native>>) -> Json<Value> {
    state.coordination.start().await;
    state.accounts.start().await;
    Json(json!({"ok": true}))
}
async fn profile_command(
    State(state): State<Arc<Native>>,
    Path(action): Path<String>,
) -> Result<Json<Value>> {
    tokio::spawn(async move {
        let value = match action.as_str() {
            "maintenance" => {
                state.profiles.retry().await?;
                json!({"ok":true})
            }
            "reconcile" => state.profiles.reconcile().await?,

            _ => return Err(Failure::missing("Unknown profile operation")),
        };
        Ok(Json(value))
    })
    .await
    .map_err(|_| Failure::unavailable("Profile operation failed"))?
}

pub type Result<T> = std::result::Result<T, Failure>;
pub async fn body(request: Request) -> Result<Value> {
    let bytes = to_bytes(request.into_body(), 1024 * 1024)
        .await
        .map_err(|_| Failure {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "Request body too large".into(),
        })?;
    if bytes.is_empty() {
        Ok(json!({}))
    } else {
        Ok(serde_json::from_slice(&bytes)?)
    }
}

#[derive(Debug)]
pub struct Failure {
    pub status: StatusCode,
    pub message: String,
}
impl Failure {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
    pub fn missing(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: message.into(),
        }
    }
}
impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        let code = match self.status {
            StatusCode::BAD_REQUEST => "VALIDATION_ERROR",
            StatusCode::NOT_FOUND => "NOT_FOUND",
            StatusCode::PAYLOAD_TOO_LARGE => "PAYLOAD_TOO_LARGE",
            StatusCode::CONFLICT => "CONFLICT",
            _ => "EXTERNAL_SERVICE_ERROR",
        };
        api::error(self.status, code, &self.message)
    }
}
impl From<std::io::Error> for Failure {
    fn from(_: std::io::Error) -> Self {
        Self::unavailable("Local storage unavailable")
    }
}
impl From<rusqlite::Error> for Failure {
    fn from(_: rusqlite::Error) -> Self {
        Self::unavailable("Storage unavailable")
    }
}
impl From<serde_json::Error> for Failure {
    fn from(_: serde_json::Error) -> Self {
        Self::invalid("Invalid JSON data")
    }
}
impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        Self::unavailable(message)
    }
}
impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Failure {}

pub fn project_root() -> PathBuf {
    if let Ok(root) = std::env::var("PROJECT_ROOT") {
        return root.into();
    }
    let mut root = std::env::current_dir().expect("Working directory is available");
    if root.file_name().is_some_and(|name| name == "server") {
        root.pop();
    }
    root
}

#[cfg(test)]
pub fn query(raw: &str) -> std::collections::HashMap<String, String> {
    reqwest::Url::parse(&format!("http://local/?{}", raw.trim_start_matches('?')))
        .expect("Local URL")
        .query_pairs()
        .into_owned()
        .collect()
}
