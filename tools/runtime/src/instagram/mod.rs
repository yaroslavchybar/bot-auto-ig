mod attachments;
mod caa;
mod context;
mod crypto;
mod device;
mod operations;
mod session;
#[cfg(test)]
mod tests;
mod transport;

use crate::{
    api::{self, Api},
    uploads::Uploads,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
pub use context::SessionContext;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
};
use tokio::sync::Mutex;
pub use transport::client as transport_client;

/// Only public Instagram image hosts may be used for picture downloads.
pub fn picture_url(raw: &str) -> Option<String> {
    let url: reqwest::Url = raw.parse().ok()?;
    let host = url.host_str()?;
    if raw.len() > 8192
        || url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return None;
    }
    ["fbcdn.net", "cdninstagram.com", "instagram.com"]
        .iter()
        .any(|base| host == *base || host.ends_with(&format!(".{base}")))
        .then(|| url.to_string())
}
use transport::{Mobile, Session};
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub message: String,
    pub name: String,
    pub status: u16,
    pub retry_after_ms: u64,
}
impl Error {
    pub fn new(message: &str) -> Self {
        Self {
            message: message.into(),
            name: "InstagramError".into(),
            status: 502,
            retry_after_ms: 0,
        }
    }
    fn response(path: &str, status: u16, data: &Value, retry: u64) -> Self {
        if status == 429 {
            return Self::rate_limit(retry);
        }
        let kind = data["error_type"]
            .as_str()
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 40
                    && s.bytes().all(|c| c.is_ascii_alphabetic() || c == b'_')
            })
            .unwrap_or("rejected");
        let name = match data["message"].as_str().unwrap_or(kind) {
            "challenge_required" => "IgCheckpointError",
            "login_required" => "IgLoginRequiredError",
            "user_has_logged_out" => "IgUserHasLoggedOutError",
            "bad_password" => "IgLoginBadPasswordError",
            "invalid_user" => "IgLoginInvalidUserError",
            "sentry_block" => "IgSentryBlockError",
            _ => "IgResponseError",
        };
        let mut error = Self {
            message: format!(
                "Instagram mobile {} HTTP {status}: {kind}",
                path.split('?')
                    .next()
                    .unwrap_or(path)
                    .split('/')
                    .rfind(|v| !v.is_empty())
                    .unwrap_or("request")
            ),
            name: name.into(),
            status,
            retry_after_ms: retry,
        };
        if path.contains("edit_profile") {
            let body = data.to_string().to_lowercase();
            if body.contains("username")
                && ["taken", "exists", "unavailable", "not available"]
                    .iter()
                    .any(|v| body.contains(v))
            {
                error.message = "Instagram username is unavailable".into();
                error.name = "UsernameUnavailable".into();
            }
        }
        error
    }
    fn rate_limit(retry_after_ms: u64) -> Self {
        Self {
            message: "Instagram is limiting requests. Wait before trying again.".into(),
            name: "IgRateLimitError".into(),
            status: 429,
            retry_after_ms,
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
pub fn string(value: &Value) -> String {
    match value {
        Value::String(v) => v.clone(),
        Value::Number(v) => v.to_string(),
        _ => String::new(),
    }
}
pub fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|v| v.is_ascii_digit())
}
pub fn retry_after(headers: &HeaderMap) -> u64 {
    let raw = headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    raw.parse::<u64>()
        .ok()
        .map(|v| v.saturating_mul(1000))
        .or_else(|| {
            chrono::DateTime::parse_from_rfc2822(raw)
                .ok()
                .map(|v| (v.timestamp_millis().max(0) as u64).saturating_sub(api::now_ms()))
        })
        .unwrap_or(60 * 60 * 1000)
        .clamp(1000, 24 * 60 * 60 * 1000)
}

// Per-profile serialization prevents logout, login and session saves from racing.
// Only idle entries without a live login cooldown may be evicted.
#[derive(Default)]
struct Entry {
    proxy: String,
    client: Option<reqwest::Client>,
    login_retry_at_ms: u64,
    saved: Option<Value>,
}
pub struct Service {
    pub api: Arc<Api>,
    pub uploads: Arc<Uploads>,
    locks: Mutex<HashMap<String, Arc<Mutex<Entry>>>>,
    contexts: std::sync::RwLock<Option<context::ContextSnapshot>>,
    #[cfg(test)]
    pub base: Option<String>,
}
impl Service {
    #[cfg(test)]
    pub(crate) fn fixture(api: Arc<Api>, uploads: Arc<Uploads>, base: String) -> Arc<Self> {
        let mut service = Self::new(api, uploads);
        Arc::get_mut(&mut service).unwrap().base = Some(base);
        service
    }
    #[cfg(test)]
    pub(crate) fn fixture_session() -> String {
        let mut state = new_session("fixture", "example");
        state.set_cookie(
            "ds_user_id=123; Domain=.instagram.com; Path=/",
            &"https://i.instagram.com/".parse().unwrap(),
        );
        state.authorization = "Bearer fixture".into();
        serde_json::to_string(&state).unwrap()
    }
    pub fn new(api: Arc<Api>, uploads: Arc<Uploads>) -> Arc<Self> {
        Arc::new(Self {
            api,
            uploads,
            locks: Mutex::new(HashMap::new()),
            contexts: Default::default(),
            #[cfg(test)]
            base: None,
        })
    }
    async fn entry(&self, id: &str) -> Result<Arc<Mutex<Entry>>> {
        let mut locks = self.locks.lock().await;
        if let Some(entry) = locks.get(id) {
            return Ok(entry.clone());
        }
        if locks.len() >= 32 {
            let now = api::now_ms();
            if let Some(id) = locks
                .iter()
                .find(|(_, v)| {
                    Arc::strong_count(v) == 1
                        && v.try_lock()
                            .is_ok_and(|entry| entry.login_retry_at_ms <= now)
                })
                .map(|(k, _)| k.clone())
            {
                locks.remove(&id);
            } else {
                return Err(Error::new(
                    "Too many active or cooling down Instagram profiles",
                ));
            }
        }
        let entry = Arc::new(Mutex::new(Entry::default()));
        locks.insert(id.into(), entry.clone());
        Ok(entry)
    }
    pub async fn invoke(&self, action: &str, request: &Command) -> Result<Value> {
        if request.profile_id.trim().is_empty() || request.profile_id.len() > 128 {
            return Err(Error::new("Profile ID is required"));
        }
        let entry = self.entry(&request.profile_id).await?;
        let mut entry = entry.lock().await;
        if action == "login" && entry.login_retry_at_ms > api::now_ms() {
            return Err(Error::rate_limit(
                entry.login_retry_at_ms.saturating_sub(api::now_ms()),
            ));
        }
        let query =
            reqwest::Url::parse_with_params("http://local/", [("profileId", &request.profile_id)])
                .unwrap();
        let session_path = format!("/api/chat/session?{}", query.query().unwrap());
        if action == "logout" {
            let result = self
                .api
                .convex(Method::DELETE, &session_path, None)
                .await
                .map_err(Error::new)?;
            self.invalidate_saved_context(&request.profile_id, &mut entry);
            return Ok(result);
        }
        if action == "has" {
            if let Some(status) = self.cached_status(&request.profile_id) {
                return Ok(status);
            }
            return self
                .api
                .convex(Method::GET, &format!("{session_path}&status=1"), None)
                .await
                .map_err(Error::new);
        }
        let saved = match (action != "login")
            .then(|| self.cached_context(&request.profile_id, &entry))
            .flatten()
        {
            Some(saved) => saved,
            None => {
                let saved = self
                    .api
                    .convex(
                        Method::GET,
                        &format!("/api/chat/context?{}", query.query().unwrap()),
                        None,
                    )
                    .await
                    .map_err(Error::new)?;
                entry.saved = Some(saved.clone());
                saved
            }
        };
        if action != "login" && (saved["connected"] != true || saved["reconnectRequired"] == true) {
            return Err(Error::new("Connect this profile to Instagram Chat first"));
        }
        let token = if action == "login" {
            uuid::Uuid::new_v4().to_string()
        } else {
            string(&saved["token"])
        };
        if action != "login"
            && request
                .token
                .as_ref()
                .is_some_and(|expected| *expected != token)
        {
            return Err(Error::new("Chat session was logged out"));
        }
        let state = if saved["connected"] == true {
            Session::from_saved(saved["state"].as_str().unwrap_or(""))?
        } else if action == "login" {
            new_session(&request.profile_id, &string(&request.args["username"]))
        } else {
            return Err(Error::new("Connect this profile to Instagram Chat first"));
        };
        if action == "load" {
            let viewer = state.viewer_id()?;
            if serde_json::from_str::<Value>(saved["state"].as_str().unwrap_or(""))
                .ok()
                .is_some_and(|v| v["version"] != 1)
            {
                let body = json!({"profileId":request.profile_id,"state":serde_json::to_string(&state).unwrap(),"token":token,"expectedToken":token});
                let result = self
                    .api
                    .convex(Method::POST, "/api/chat/session", Some(&body))
                    .await
                    .map_err(Error::new)?;
                let state = serde_json::to_string(&state).unwrap();
                self.checkpoint(
                    &request.profile_id,
                    &mut entry,
                    &saved,
                    &state,
                    &token,
                    &result,
                );
            }
            return Ok(json!({"token":token,"viewerId":viewer}));
        }
        let profile = &saved["profile"];
        if profile.is_null() {
            return Err(Error::new("Profile not found"));
        }
        let proxy = normalize_proxy(&string(&profile["proxy"]), &string(&profile["proxyType"]))?;
        if entry.client.is_none() || entry.proxy != proxy {
            entry.client = Some(transport::client(&proxy)?);
            entry.proxy = proxy;
        }
        let previous = saved["state"].as_str().unwrap_or("");
        let mut mobile = Mobile {
            state,
            client: entry.client.clone().unwrap(),
            #[cfg(test)]
            base: self.base.clone(),
        };
        let result = if action == "login" {
            let username = string(&request.args["username"]);
            let password = string(&request.args["password"]);
            let authenticator = string(&request.args["authenticatorKey"]);
            if username.is_empty()
                || username.len() > 30
                || password.is_empty()
                || password.len() > 4096
                || authenticator.len() > 128
            {
                return Err(Error::new("Invalid Instagram credentials"));
            }
            if let Err(error) = caa::login(&mut mobile, &username, &password, &authenticator).await
            {
                if error.status == 429 {
                    entry.login_retry_at_ms = api::now_ms().saturating_add(error.retry_after_ms);
                }
                return Err(error);
            }
            entry.login_retry_at_ms = 0;
            json!({"token":token,"viewerId":mobile.state.viewer_id()?})
        } else {
            match operations::invoke(self, &mut mobile, action, &request.args).await {
                Ok(result) => result,
                Err(error) => {
                    if error.status == 401
                        || ["IgLoginRequiredError", "IgUserHasLoggedOutError"]
                            .contains(&error.name.as_str())
                    {
                        let body = json!({"profileId":request.profile_id,"state":previous,"token":token,"expectedToken":token,"reconnectRequired":true});
                        let _ = self
                            .api
                            .convex(Method::POST, "/api/chat/session", Some(&body))
                            .await;
                        self.invalidate_saved_context(&request.profile_id, &mut entry);
                    }
                    return Err(error);
                }
            }
        };
        let state = serde_json::to_string(&mobile.state)
            .map_err(|_| Error::new("Invalid Instagram session"))?;
        if action == "login" || state != previous {
            if state.len() > 250_000 {
                return Err(Error::new("Instagram session exceeded size limit"));
            }
            let mut body = json!({"profileId":request.profile_id,"state":state,"token":token});
            if action != "login" {
                body["expectedToken"] = json!(token);
            }
            let save = self
                .api
                .convex(Method::POST, "/api/chat/session", Some(&body))
                .await;
            if let Ok(result) = &save {
                self.checkpoint(
                    &request.profile_id,
                    &mut entry,
                    &saved,
                    &state,
                    &token,
                    result,
                );
            }
            if let Err(message) = save {
                self.invalidate_saved_context(&request.profile_id, &mut entry);
                // Accepted sends must not be reported as failed and retried by the caller.
                if ["reply", "attachment", "unsend"].contains(&action) {
                    ig_service_common::service_error("instagram.session_save_failed", message);
                } else {
                    return Err(Error::new(message));
                }
            }
        }
        Ok(result)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    pub profile_id: String,
    pub token: Option<String>,
    #[serde(default)]
    pub args: Value,
}
pub fn router(service: Arc<Service>) -> Router {
    let slots = Arc::new(tokio::sync::Semaphore::new(4));
    Router::new()
        .route("/instagram/{action}", post(command))
        .with_state(service)
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let slots = slots.clone();
                async move {
                    let Ok(_permit) = slots.try_acquire_owned() else {
                        return (
                            StatusCode::TOO_MANY_REQUESTS,
                            Json(json!({"error":Error { status: 429, ..Error::new("Too many active Instagram requests") }})),
                        )
                            .into_response();
                    };
                    next.run(request).await
                }
            },
        ))
}
async fn command(
    State(service): State<Arc<Service>>,
    Path(action): Path<String>,
    Json(request): Json<Command>,
) -> Response {
    match service.invoke(&action, &request).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => (StatusCode::BAD_GATEWAY, Json(json!({"error":error}))).into_response(),
    }
}

pub(crate) fn new_session(profile_id: &str, username: &str) -> Session {
    use sha2::{Digest, Sha256};
    let (uuid, phone_id, device_id) = device::identifiers(&format!("{username}:{profile_id}"));
    static PERSONAS: LazyLock<Vec<&str>> =
        LazyLock::new(|| include_str!("devices.txt").lines().collect());
    let selector = Sha256::digest(profile_id);
    let index = u32::from_be_bytes(selector[..4].try_into().unwrap()) as usize % PERSONAS.len();
    Session {
        version: 1,
        uuid,
        phone_id,
        device_id,
        device: PERSONAS[index].into(),
        cookies: Default::default(),
        authorization: String::new(),
        claim: String::new(),
        usdid: None,
        password_key_id: 0,
        password_key: String::new(),
    }
}
pub fn normalize_proxy(raw: &str, protocol: &str) -> Result<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("none") {
        return Ok(String::new());
    }
    let scheme = if protocol.is_empty() {
        "http"
    } else {
        protocol
    };
    static LEGACY: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)^(?:(https?|socks5)://)?(\[[^\]]+\]|[^:@/]+):(\d+):([^:]+):(.+)$")
            .expect("Static proxy pattern")
    });
    let mut url = if let Some(parts) = LEGACY.captures(raw) {
        let mut url: reqwest::Url = format!(
            "{}://{}:{}",
            parts.get(1).map(|v| v.as_str()).unwrap_or(scheme),
            &parts[2],
            &parts[3]
        )
        .parse()
        .map_err(|_| Error::new("Invalid proxy protocol or URL"))?;
        url.set_username(&parts[4])
            .map_err(|_| Error::new("Invalid proxy protocol or URL"))?;
        url.set_password(Some(&parts[5]))
            .map_err(|_| Error::new("Invalid proxy protocol or URL"))?;
        url
    } else {
        let text = if raw.contains("://") {
            raw.into()
        } else {
            format!("{scheme}://{raw}")
        };
        reqwest::Url::parse(&text).map_err(|_| Error::new("Invalid proxy protocol or URL"))?
    };
    if !["http", "https", "socks5"].contains(&url.scheme())
        || url.host_str().is_none()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port() == Some(0)
    {
        return Err(Error::new("Invalid proxy protocol or URL"));
    }
    if url.scheme() == "socks5" && url.port().is_none() {
        url.set_port(Some(1080))
            .map_err(|_| Error::new("Invalid proxy protocol or URL"))?;
    }
    Ok(url.to_string().trim_end_matches('/').into())
}
