use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;
const SESSION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const LOGIN_MS: u64 = 10 * 60 * 1000;

#[derive(Clone)]
pub struct Auth {
    pub production: bool,
    pub bypass: bool,
    pub admin_id: String,
    bot_token: String,
    bot_username: String,
    webhook_secret: String,
    webhook_ready: Arc<AtomicBool>,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    client: reqwest::Client,
    #[cfg(test)]
    bot_base: Option<String>,
}
#[derive(Clone)]
struct Pending {
    created_at: u64,
    user: Option<User>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub photo_url: String,
}

impl Auth {
    pub fn from_env(client: reqwest::Client) -> Self {
        let production = super::env("NODE_ENV", "development") == "production";
        Self {
            production,
            bypass: !production && super::env("DISABLE_AUTH", "") == "true",
            admin_id: super::env("TELEGRAM_ADMIN_ID", ""),
            bot_token: super::env("TELEGRAM_BOT_TOKEN", ""),
            bot_username: super::env("TELEGRAM_BOT_USERNAME", "")
                .trim_start_matches('@')
                .into(),
            webhook_secret: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
            webhook_ready: Arc::new(AtomicBool::new(false)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            client,
            #[cfg(test)]
            bot_base: None,
        }
    }
    pub fn verify(&self, token: &str) -> Option<User> {
        if self.bot_token.is_empty() {
            return None;
        }
        let (payload, signature) = token.split_once('.')?;
        let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
        let mut mac =
            HmacSha256::new_from_slice(&Sha256::digest(self.bot_token.as_bytes())).ok()?;
        mac.update(payload.as_bytes());
        mac.verify_slice(&signature).ok()?;
        let data: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
        let uid = data["uid"].as_str()?;
        if self.admin_id.is_empty()
            || uid != self.admin_id
            || data["exp"].as_u64()? < super::now_ms()
        {
            return None;
        }
        let profile = &data["profile"];
        let first_name = profile["firstName"]
            .as_str()
            .filter(|value| !value.is_empty())
            .unwrap_or("Admin");
        Some(User {
            id: uid.into(),
            first_name: first_name.into(),
            last_name: profile["lastName"].as_str().unwrap_or("").into(),
            username: profile["username"].as_str().unwrap_or("").into(),
            photo_url: profile["photoUrl"].as_str().unwrap_or("").into(),
        })
    }
    fn sign(&self, user: &User) -> String {
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({ "uid": user.id,
            "exp": super::now_ms() + SESSION_MS, "profile": {
                "firstName": user.first_name, "lastName": user.last_name,
                "username": user.username, "photoUrl": user.photo_url } }))
            .unwrap(),
        );
        let mut mac =
            HmacSha256::new_from_slice(&Sha256::digest(self.bot_token.as_bytes())).unwrap();
        mac.update(payload.as_bytes());
        format!(
            "{payload}.{}",
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
        )
    }
    fn configured(&self) -> bool {
        !self.bot_token.is_empty() && !self.bot_username.is_empty()
    }
    fn config(&self) -> Value {
        json!({ "botUsername": self.bot_username,
        "isConfigured": self.configured(), "isDevLoginEnabled": !self.production })
    }
    fn session(&self, user: User) -> Response {
        let token = self.sign(&user);
        let cookie = format!(
            "app_session={token}; HttpOnly; Path=/; SameSite=Lax; Max-Age={}{}",
            SESSION_MS / 1000,
            if self.production { "; Secure" } else { "" }
        );
        let full_name = format!("{} {}", user.first_name, user.last_name)
            .trim()
            .to_string();
        let mut response = Json(
            json!({ "user": { "id": user.id, "firstName": user.first_name,
            "lastName": user.last_name, "fullName": full_name, "username": user.username,
            "photoUrl": user.photo_url }, "token": token }),
        )
        .into_response();
        response
            .headers_mut()
            .insert(header::SET_COOKIE, cookie.parse().unwrap());
        response
    }
    async fn bot_api(&self, method: &str, body: Value) -> Result<(), ()> {
        if self.bot_token.is_empty() {
            return Err(());
        }
        let url = format!("https://api.telegram.org/bot{}/{method}", self.bot_token);
        #[cfg(test)]
        let url = self
            .bot_base
            .as_ref()
            .map(|base| format!("{base}/{method}"))
            .unwrap_or(url);
        let response = self
            .client
            .post(url)
            .timeout(Duration::from_secs(15))
            .json(&body)
            .send()
            .await
            .map_err(|_| ())?;
        if !response.status().is_success() {
            return Err(());
        }
        let value = super::bounded_json(response, 256 * 1024)
            .await
            .map_err(|_| ())?;
        if value["ok"] != true {
            return Err(());
        }
        Ok(())
    }
    pub async fn register_webhook(&self) {
        let base = [
            super::env("PUBLIC_BASE_URL", ""),
            super::env("APP_PUBLIC_URL", ""),
            super::env("ALLOWED_ORIGINS", "")
                .split(',')
                .next()
                .unwrap_or("")
                .trim()
                .into(),
        ]
        .into_iter()
        .find(|v| !v.is_empty())
        .unwrap_or_default();
        self.register_webhook_at(&base).await;
    }
    async fn register_webhook_at(&self, base: &str) {
        if base.is_empty() || !self.configured() {
            return;
        }
        let body = json!({ "url": format!("{}/api/auth/tg-webhook", base.trim_end_matches('/')),
            "secret_token": self.webhook_secret, "drop_pending_updates": true });
        let mut delay = Duration::from_secs(5);
        loop {
            if self.bot_api("setWebhook", body.clone()).await.is_ok() {
                self.webhook_ready.store(true, Ordering::Relaxed);
                return;
            }
            ig_service_common::service_error(
                "auth.webhook_failed",
                "Telegram login webhook registration failed",
            );
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(Duration::from_secs(300));
        }
    }
}

pub fn session_token(headers: &HeaderMap) -> &str {
    if let Some(cookie) = headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
    {
        for part in cookie.split(';') {
            if let Some(("app_session", token)) = part.trim().split_once('=') {
                if !token.is_empty() {
                    return token;
                }
            }
        }
    }
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("")
        .trim()
}

fn error(code: StatusCode, message: &str) -> Response {
    (code, Json(json!({ "error": message }))).into_response()
}
fn valid_token(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn router(auth: Arc<Auth>) -> Router {
    Router::new()
        .route("/api/auth/config", get(config))
        .route("/api/auth/me", get(me))
        .route("/api/auth/dev-login", post(dev_login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/tg-link", post(tg_link))
        .route("/api/auth/tg-poll", get(tg_poll))
        .route("/api/auth/tg-webhook", post(tg_webhook))
        .with_state(auth)
}
async fn config(State(auth): State<Arc<Auth>>) -> Json<Value> {
    Json(auth.config())
}
async fn me(State(auth): State<Arc<Auth>>, headers: HeaderMap) -> Json<Value> {
    if let Some(user) = auth.verify(session_token(&headers)) {
        let full_name = format!("{} {}", user.first_name, user.last_name)
            .trim()
            .to_string();
        Json(
            json!({ "authenticated": true, "user": { "id": user.id, "firstName": user.first_name,
            "lastName": user.last_name, "fullName": full_name, "username": user.username, "photoUrl": user.photo_url } }),
        )
    } else {
        let mut value = auth.config();
        value["authenticated"] = json!(false);
        Json(value)
    }
}
async fn dev_login(State(auth): State<Arc<Auth>>) -> Response {
    if auth.production {
        return error(StatusCode::FORBIDDEN, "Dev login is disabled");
    }
    auth.session(User {
        id: if auth.admin_id.is_empty() {
            "1".into()
        } else {
            auth.admin_id.clone()
        },
        first_name: "Dev Admin".into(),
        last_name: "".into(),
        username: "admin".into(),
        photo_url: "".into(),
    })
}
async fn logout(State(auth): State<Arc<Auth>>) -> Response {
    let mut response = Json(json!({ "success": true })).into_response();
    let cookie = format!("app_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT{}",
        if auth.production { "; Secure" } else { "" });
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie.parse().unwrap());
    response
}
async fn tg_link(State(auth): State<Arc<Auth>>) -> Response {
    if !auth.configured() {
        return error(
            StatusCode::BAD_REQUEST,
            "Telegram login is not configured on the server.",
        );
    }
    if !auth.webhook_ready.load(Ordering::Relaxed) {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Telegram login is not available right now. Try again shortly.",
        );
    }
    let mut pending = auth.pending.lock().unwrap();
    let now = super::now_ms();
    pending.retain(|_, entry| now.saturating_sub(entry.created_at) <= LOGIN_MS);
    if pending.len() >= 1000 {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Login is busy. Try again shortly.",
        );
    }
    let token = Uuid::new_v4().simple().to_string();
    pending.insert(
        token.clone(),
        Pending {
            created_at: now,
            user: None,
        },
    );
    Json(json!({ "token": token, "bot": auth.bot_username, "url": format!("https://t.me/{}?start={token}", auth.bot_username) })).into_response()
}
async fn tg_poll(
    State(auth): State<Arc<Auth>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let token = query.get("token").map(String::as_str).unwrap_or("");
    let expired = || (StatusCode::NOT_FOUND, Json(json!({ "status": "expired" }))).into_response();
    if !valid_token(token) {
        return expired();
    }
    let mut pending = auth.pending.lock().unwrap();
    let Some(entry) = pending.get(token) else {
        return expired();
    };
    if super::now_ms().saturating_sub(entry.created_at) > LOGIN_MS {
        pending.remove(token);
        return expired();
    }
    if entry.user.is_none() {
        return Json(json!({ "status": "pending" })).into_response();
    }
    let user = pending.remove(token).unwrap().user.unwrap();
    if auth.admin_id.is_empty() || auth.admin_id != user.id {
        return error(StatusCode::FORBIDDEN, "Access is restricted to the admin.");
    }
    auth.session(user)
}
async fn tg_webhook(
    State(auth): State<Arc<Auth>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    if headers
        .get("x-telegram-bot-api-secret-token")
        .and_then(|value| value.to_str().ok())
        != Some(auth.webhook_secret.as_str())
    {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "ok": false }))).into_response();
    }
    let message = &body["message"];
    let text = message["text"].as_str().unwrap_or("");
    let token = text
        .strip_prefix("/start")
        .filter(|suffix| suffix.starts_with(char::is_whitespace))
        .map(str::trim_start)
        .and_then(|suffix| suffix.get(..32))
        .filter(|token| valid_token(token));
    let from = &message["from"];
    if let (Some(token), Some(id)) = (token, from["id"].as_u64().filter(|id| *id > 0)) {
        let confirmed = {
            let mut pending = auth.pending.lock().unwrap();
            if let Some(entry) = pending.get_mut(token).filter(|entry| {
                entry.user.is_none() && super::now_ms().saturating_sub(entry.created_at) <= LOGIN_MS
            }) {
                entry.user = Some(User {
                    id: id.to_string(),
                    first_name: from["first_name"]
                        .as_str()
                        .filter(|name| !name.is_empty())
                        .unwrap_or("User")
                        .into(),
                    last_name: "".into(),
                    username: from["username"].as_str().unwrap_or("").into(),
                    photo_url: "".into(),
                });
                true
            } else {
                false
            }
        };
        if confirmed {
            tokio::spawn(async move {
                let _ = auth.bot_api("sendMessage", json!({ "chat_id": id, "text": "Logged in. Return to the site to continue." })).await;
            });
        }
    }
    Json(json!({ "ok": true })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn webhook_registration_retries_until_success() {
        use crate::test_support::{body, Fixture};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut auth = Auth::from_env(reqwest::Client::new());
        auth.bot_token = "fixture".into();
        auth.bot_username = "fixture_bot".into();
        let expected = json!({
            "url": "https://example.test/api/auth/tg-webhook",
            "secret_token": auth.webhook_secret,
            "drop_pending_updates": true
        });
        let attempts = Arc::new(Mutex::new(Vec::new()));
        let bot = Fixture::start({
            let attempts = attempts.clone();
            let ready = auth.webhook_ready.clone();
            move |request| {
                let attempts = attempts.clone();
                let ready = ready.clone();
                let expected = expected.clone();
                async move {
                    assert_eq!(request.uri().path(), "/setWebhook");
                    assert_eq!(body(request).await, expected);
                    assert!(!ready.load(Ordering::Relaxed));
                    let attempt = {
                        let mut attempts = attempts.lock().unwrap();
                        attempts.push(tokio::time::Instant::now());
                        attempts.len()
                    };
                    match attempt {
                        1 => StatusCode::BAD_GATEWAY.into_response(),
                        2 => Json(json!({"ok":false})).into_response(),
                        _ => Json(json!({"ok":true})).into_response(),
                    }
                }
            }
        })
        .await;
        auth.bot_base = Some(bot.url.clone());
        // Missing URLs and unconfigured clients must not send any requests.
        auth.register_webhook_at("").await;
        let mut unconfigured = auth.clone();
        unconfigured.bot_username.clear();
        unconfigured
            .register_webhook_at("https://example.test")
            .await;
        assert!(attempts.lock().unwrap().is_empty());
        assert!(!auth.webhook_ready.load(Ordering::Relaxed));

        tokio::time::timeout(
            Duration::from_secs(25),
            auth.register_webhook_at("https://example.test/"),
        )
        .await
        .expect("registration should recover after HTTP and Telegram API failures");
        assert!(auth.webhook_ready.load(Ordering::Relaxed));
        let attempts = attempts.lock().unwrap();
        assert_eq!(attempts.len(), 3);
        assert!(attempts[1] - attempts[0] >= Duration::from_secs(5));
        assert!(attempts[2] - attempts[1] >= Duration::from_secs(10));
    }
    #[tokio::test]
    async fn telegram_link_is_single_use_and_webhook_requires_its_secret() {
        use crate::test_support::Fixture;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let bot = Fixture::start(|_| async { Json(json!({"ok":true})).into_response() }).await;
        let client = reqwest::Client::new();
        let mut auth = Auth::from_env(client.clone());
        auth.bot_token = "fixture".into();
        auth.bot_username = "fixture_bot".into();
        auth.admin_id = "123".into();
        auth.bot_base = Some(bot.url.clone());
        auth.webhook_ready.store(true, Ordering::Relaxed);
        let secret = auth.webhook_secret.clone();
        let public = Fixture::router(router(Arc::new(auth.clone()))).await;
        let link: Value = client
            .post(format!("{}/api/auth/tg-link", public.url))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let token = link["token"].as_str().unwrap();
        assert!(valid_token(token));
        assert_eq!(
            link["url"],
            format!("https://t.me/fixture_bot?start={token}")
        );
        let poll = format!("{}/api/auth/tg-poll?token={token}", public.url);
        assert_eq!(
            client
                .get(&poll)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()["status"],
            "pending"
        );
        let webhook = format!("{}/api/auth/tg-webhook", public.url);
        let body = json!({"message":{"text":format!("/start {token}"),"from":{"id":123,"first_name":"Admin"}}});
        assert_eq!(
            client
                .post(&webhook)
                .json(&body)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .post(&webhook)
                .header("x-telegram-bot-api-secret-token", &secret)
                .json(&body)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        // A later confirmation cannot replace the first identity.
        client
            .post(&webhook)
            .header("x-telegram-bot-api-secret-token", &secret)
            .json(&json!({"message":{"text":format!("/start {token}"),"from":{"id":456}}}))
            .send()
            .await
            .unwrap();
        let confirmed = client.get(&poll).send().await.unwrap();
        assert!(confirmed.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .contains("HttpOnly"));
        let confirmed: Value = confirmed.json().await.unwrap();
        assert_eq!(confirmed["user"]["id"], "123");
        assert_eq!(
            auth.verify(confirmed["token"].as_str().unwrap())
                .unwrap()
                .id,
            "123"
        );
        assert_eq!(
            client.get(&poll).send().await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
        auth.pending.lock().unwrap().insert(
            "0".repeat(32),
            Pending {
                created_at: super::super::now_ms() - LOGIN_MS - 1,
                user: None,
            },
        );
        assert_eq!(
            client
                .get(format!(
                    "{}/api/auth/tg-poll?token={}",
                    public.url,
                    "0".repeat(32)
                ))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    #[test]
    fn sessions_require_valid_signature_expiry_and_admin_identity() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut auth = Auth::from_env(reqwest::Client::new());
        auth.bot_token = "test-secret".into();
        auth.admin_id = "123".into();
        let user = User {
            id: "123".into(),
            first_name: "Admin".into(),
            last_name: "".into(),
            username: "admin".into(),
            photo_url: "".into(),
        };
        let token = auth.sign(&user);
        assert_eq!(auth.verify(&token).unwrap().id, "123");
        assert!(auth.verify(&format!("{token}extra")).is_none());
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({"uid":"123","exp":super::super::now_ms()-1})).unwrap(),
        );
        let mut mac =
            HmacSha256::new_from_slice(&Sha256::digest(auth.bot_token.as_bytes())).unwrap();
        mac.update(payload.as_bytes());
        assert!(auth
            .verify(&format!(
                "{payload}.{}",
                URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
            ))
            .is_none());
        auth.admin_id = "456".into();
        assert!(auth.verify(&token).is_none());
        auth.admin_id = "123".into();
        auth.bot_token.clear();
        assert!(auth.verify(&token).is_none());
    }
}
