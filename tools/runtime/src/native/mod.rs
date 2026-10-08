pub mod accounts;
pub mod chat;
pub mod content;
pub mod coordination;
pub mod displays;
pub mod processes;
pub mod profiles;
pub mod subscriptions;

use crate::api;
use axum::{
    body::to_bytes,
    extract::{Path, Request, State},
    http::Method,
    routing::{get, post},
    Json, Router,
};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::{collections::HashMap, sync::Arc};

pub struct Native {
    pub api: Arc<api::Api>,
    pub content: Arc<content::Content>,
    pub chat: Arc<chat::Chat>,
    pub processes: Arc<processes::Processes>,
    pub displays: Arc<displays::Displays>,
    pub subscriptions: Arc<subscriptions::Subscriptions>,
    pub coordination: Arc<coordination::Coordination>,
    pub profiles: Arc<profiles::Profiles>,
    pub accounts: Arc<accounts::Accounts>,
}
impl Native {
    pub fn new(
        api: Arc<api::Api>,
        mobile: Arc<crate::instagram::Service>,
        scraper: Arc<crate::scraper::Scraper>,
    ) -> Result<Arc<Self>> {
        let root = project_root();
        let content = content::Content::new(
            std::env::var("MODEL_CONTENT_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| root.join("data/model-content")),
        );
        let chat = chat::Chat::new(
            api.clone(),
            mobile.clone(),
            &root.join("data/chat-cache/cache.sqlite"),
        )?;
        let processes = processes::Processes::new(api.clone(), root.clone());
        let displays = displays::Displays::new(api.clone(), processes.clone());
        let subscriptions = subscriptions::Subscriptions::new(api.clone());
        let profiles = profiles::Profiles::new(api.clone(), processes.clone(), root);
        let accounts = accounts::Accounts::new(
            api.clone(),
            profiles.clone(),
            mobile,
            content.clone(),
            subscriptions.clone(),
        );
        let coordination = coordination::Coordination::new(
            api.clone(),
            subscriptions.clone(),
            processes.clone(),
            chat.clone(),
            scraper,
        );
        Ok(Arc::new(Self {
            api,
            content,
            chat,
            processes,
            displays,
            subscriptions,
            coordination,
            profiles,
            accounts,
        }))
    }
    pub fn handles(operation: &str) -> bool {
        operation.starts_with("chat.")
            || operation.contains("models_modelId_content")
            || operation.starts_with("automations.")
            || operation.starts_with("profiles.")
            || operation.starts_with("ig-accounts.")
            || operation.starts_with("displays.")
            || matches!(
                operation,
                "profiles.post.name_start"
                    | "profiles.post.name_stop"
                    | "displays.get.list"
                    | "displays.get.vncPort_preview"
            )
    }
    pub async fn invoke(
        self: &Arc<Self>,
        operation: &str,
        params: &HashMap<String, String>,
        request: Request,
    ) -> Response {
        // Mutations retain their locks and finish cleanup if an HTTP caller disconnects.
        if !matches!(request.method(), &Method::GET | &Method::HEAD) {
            let state = self.clone();
            let operation = operation.to_owned();
            let params = params.clone();
            return tokio::spawn(async move {
                state.invoke_request(&operation, &params, request).await
            })
            .await
            .unwrap_or_else(|_| Failure::unavailable("Native operation failed").into_response());
        }
        self.invoke_request(operation, params, request).await
    }
    async fn invoke_request(
        self: &Arc<Self>,
        operation: &str,
        params: &HashMap<String, String>,
        request: Request,
    ) -> Response {
        if operation.starts_with("chat.") {
            return self.chat.public(operation, params, request).await;
        }
        match self.handle(operation, params, request).await {
            Ok(response) => response,
            Err(error) => error.into_response(),
        }
    }
    async fn handle(
        self: &Arc<Self>,
        operation: &str,
        params: &HashMap<String, String>,
        request: Request,
    ) -> Result<Response> {
        let query = query(request.uri().query().unwrap_or(""));
        if operation.ends_with("_clipboard") || operation.ends_with("_file-picker") {
            return self
                .displays
                .desktop(
                    operation,
                    params
                        .get("vncPort")
                        .and_then(|s| s.parse().ok())
                        .ok_or_else(|| Failure::invalid("Invalid display port"))?,
                    request,
                )
                .await;
        }
        if operation.starts_with("ig-accounts.") && !operation.contains("models_modelId_content") {
            return self.accounts.public(operation, params, request).await;
        }
        if operation.starts_with("profiles.") && !operation.starts_with("profiles.post.name_") {
            return self.profiles.public(operation, params, request).await;
        }
        if operation == "displays.get.list" {
            return Ok(Json(self.displays.list().await).into_response());
        }
        if operation == "displays.get.vncPort_preview" {
            let port = params
                .get("vncPort")
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| Failure::invalid("Invalid display port"))?;
            return self.displays.preview(port).await;
        }
        if operation == "automations.get.status" {
            return Ok(Json(
                self.processes
                    .status_value(query.get("automationId").map(String::as_str))
                    .await,
            )
            .into_response());
        }
        if operation.starts_with("profiles.post.name_") {
            let name = params.get("name").map(String::as_str).unwrap_or("");
            if operation.ends_with("_start") {
                self.processes.start_manual(name).await?;
            } else if !self.processes.stop(false, name, false).await? {
                return Err(Failure::invalid("No browser running for this profile"));
            }
            return Ok(Json(json!({"success": true, "message": if operation.ends_with("_start") { format!("Browser started for {name}") } else { format!("Browser stopped for {name}") }})).into_response());
        }
        let model = params.get("modelId").map(String::as_str).unwrap_or("");
        let kind = params.get("kind").map(String::as_str).unwrap_or("");
        let id = params.get("contentId").map(String::as_str).unwrap_or("");
        if operation.contains("models_modelId_content") {
            let lists = self.api.convex(Method::GET, "/api/lists", None).await?;
            if !lists
                .as_array()
                .into_iter()
                .flatten()
                .any(|row| row["id"].as_str() == Some(model))
            {
                return Err(Failure::invalid("Model not found"));
            }
            if operation.ends_with("_image") {
                return self
                    .content
                    .image(
                        model,
                        kind,
                        id,
                        params.get("variant").map(String::as_str),
                        query.get("thumbnail").is_some_and(|s| s == "1"),
                    )
                    .await;
            }
            if operation == "ig-accounts.get.models_modelId_content" {
                return Ok(Json(self.content.list(model).await?).into_response());
            }
            if operation.starts_with("ig-accounts.delete") {
                return Ok(Json(self.content.remove(model, kind, id).await?).into_response());
            }
            if operation.ends_with("_copies") {
                if operation.starts_with("ig-accounts.get") {
                    return Ok(Json(self.content.copies(model, kind, id).await?).into_response());
                }
                let bank = self.content.clone();
                let api = self.api.clone();
                let model = model.to_owned();
                let kind = kind.to_owned();
                let id = id.to_owned();
                let generated =
                    tokio::spawn(async move { bank.generate(&api, &model, &kind, &id).await })
                        .await
                        .map_err(|_| Failure::unavailable("Copy generation failed"))??;
                return Ok(Json(generated).into_response());
            }
            let bytes = to_bytes(request.into_body(), 15 * 1024 * 1024)
                .await
                .map_err(|_| Failure {
                    status: StatusCode::PAYLOAD_TOO_LARGE,
                    message: "Image must be 1–15 MB".into(),
                })?;
            return Ok(Json(
                self.content
                    .add(
                        model,
                        kind,
                        query.get("name").map(String::as_str).unwrap_or(""),
                        &bytes,
                    )
                    .await?,
            )
            .into_response());
        }
        let bytes = to_bytes(request.into_body(), 1024 * 1024)
            .await
            .map_err(|_| Failure::invalid("Request body too large"))?;
        let body: Value = if bytes.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&bytes)?
        };
        if operation == "automations.post.run" {
            self.processes
                .start_automation(body["automationId"].as_str().unwrap_or(""))
                .await?;
            return Ok(
                Json(json!({"success": true, "message": "Automation started"})).into_response(),
            );
        }
        if operation == "automations.post.stop" {
            let stopped = self
                .processes
                .stop_automations(body["automationId"].as_str().filter(|s| !s.is_empty()))
                .await?;
            if stopped.is_empty() {
                return Err(Failure::invalid("No automation running"));
            }
            return Ok(Json(json!({"success": true, "stopped": stopped})).into_response());
        }
        Err(Failure::missing("Unknown native operation"))
    }
}
pub fn router(state: Arc<Native>) -> Router {
    Router::new()
        .route("/content/{action}", post(content_command))
        .route("/chat/clear", post(clear_chat))
        .route("/processes/{action}", post(process_command))
        .route("/coordination/start", post(start_coordination))
        .route("/profiles/{action}", post(profile_command))
        .route("/accounts/{action}", post(account_command))
        .route("/displays/{port}", get(resolve_display))
        .with_state(state.clone())
        .merge(
            Router::new()
                .route("/profiles/lease", get(profiles::lease))
                .with_state(state.profiles.clone()),
        )
        .merge(
            Router::new()
                .route("/accounts/post-lease", get(accounts::setup::post_lease))
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
                .with_state(state.displays.clone()),
        )
}
async fn content_command(
    State(state): State<Arc<Native>>,
    Path(action): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    tokio::spawn(async move { run_content_command(state, action, body).await })
        .await
        .map_err(|_| Failure::unavailable("Content operation failed"))?
}
async fn run_content_command(
    state: Arc<Native>,
    action: String,
    body: Value,
) -> Result<Json<Value>> {
    let model = body["modelId"].as_str().unwrap_or("");
    let kind = body["kind"].as_str().unwrap_or("");
    let profile = body["profileId"].as_str().unwrap_or("");
    let excludes: Vec<String> =
        serde_json::from_value(body["excludeIds"].clone()).unwrap_or_default();
    let value = match action.as_str() {
        "allocate" | "available" => {
            state
                .content
                .allocate(model, kind, profile, &excludes, action == "available")
                .await?
        }
        "list" => state.content.list(model).await?,
        _ => return Err(Failure::missing("Unknown content operation")),
    };
    Ok(Json(value))
}
async fn clear_chat(
    State(state): State<Arc<Native>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    state
        .chat
        .clear(body["profileId"].as_str().unwrap_or(""))
        .await?;
    Ok(Json(json!({"ok": true})))
}
async fn process_command(
    State(state): State<Arc<Native>>,
    Path(action): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    tokio::spawn(async move { run_process_command(state, action, body).await })
        .await
        .map_err(|_| Failure::unavailable("Process operation failed"))?
}
async fn run_process_command(
    state: Arc<Native>,
    action: String,
    body: Value,
) -> Result<Json<Value>> {
    let value = match action.as_str() {
        "ownership" => state.processes.ownership().await,
        "stop-owners" => {
            state
                .processes
                .stop_owners(&serde_json::from_value::<Vec<String>>(
                    body["names"].clone(),
                )?)
                .await?;
            json!({"ok": true})
        }
        "shutdown" => {
            state.accounts.shutdown().await;
            state.coordination.shutdown().await;
            state.processes.shutdown().await?;
            json!({"ok": true})
        }
        "stop-automations" => json!(
            state
                .processes
                .stop_automations(body["automationId"].as_str())
                .await?
        ),
        _ => return Err(Failure::missing("Unknown process operation")),
    };
    Ok(Json(value))
}
async fn resolve_display(
    State(state): State<Arc<Native>>,
    Path(port): Path<u16>,
) -> Result<Json<Value>> {
    Ok(Json(state.displays.resolve(port).await?))
}
async fn start_coordination(State(state): State<Arc<Native>>) -> Json<Value> {
    state.coordination.start().await;
    state.accounts.start().await;
    Json(json!({"ok": true}))
}
async fn profile_command(
    State(state): State<Arc<Native>>,
    Path(action): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    tokio::spawn(async move {
        let value = match action.as_str() {
            "maintenance" => {
                state.profiles.retry().await?;
                json!({"ok":true})
            }
            "reconcile" => state.profiles.reconcile().await?,
            "update" => {
                state
                    .profiles
                    .update(profiles::text(&body, "oldName"), body["profile"].clone())
                    .await?;
                json!({"ok":true})
            }
            _ => return Err(Failure::missing("Unknown profile operation")),
        };
        Ok(Json(value))
    })
    .await
    .map_err(|_| Failure::unavailable("Profile operation failed"))?
}
async fn account_command(
    State(state): State<Arc<Native>>,
    Path(action): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    tokio::spawn(async move {
        let value = match action.as_str() {
            "advance" => {
                state
                    .accounts
                    .advance_setup(
                        profiles::text(&body, "profileId"),
                        profiles::text(&body, "automationId"),
                    )
                    .await?;
                json!({"ok":true})
            }
            "proxy-exit" => {
                state
                    .accounts
                    .proxies
                    .exit(profiles::text(&body, "proxy"), body["cached"] == true)
                    .await?
            }
            _ => return Err(Failure::missing("Unknown account operation")),
        };
        Ok(Json(value))
    })
    .await
    .map_err(|_| Failure::unavailable("Account operation failed"))?
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
        Self::unavailable("Chat storage unavailable")
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

pub fn query(raw: &str) -> std::collections::HashMap<String, String> {
    reqwest::Url::parse(&format!("http://local/?{}", raw.trim_start_matches('?')))
        .expect("Local URL")
        .query_pairs()
        .into_owned()
        .collect()
}
