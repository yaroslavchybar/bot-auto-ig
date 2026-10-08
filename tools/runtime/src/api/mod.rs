pub mod auth;
mod events;
#[cfg(test)]
mod tests;

use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, Path, Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, on, MethodFilter},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;
use tower_http::limit::RequestBodyLimitLayer;

pub fn env(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .unwrap_or_else(|_| fallback.into())
        .trim()
        .into()
}
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub struct Api {
    pub native: std::sync::OnceLock<Arc<crate::native::Native>>,
    pub events: tokio::sync::broadcast::Sender<Value>,
    pub auth: Arc<auth::Auth>,
    pub client: reqwest::Client,
    pub worker_url: String,
    pub key: String,
    pub convex_url: String,
    slots: Arc<Semaphore>,
    pub sockets: Arc<Semaphore>,
    limits: Mutex<HashMap<String, (u64, usize)>>,
    origins: Vec<String>,
}

impl Api {
    pub fn from_env() -> Result<Self, reqwest::Error> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .pool_max_idle_per_host(8)
            .build()?;
        let cloud = env("CONVEX_URL", &env("VITE_CONVEX_URL", ""));
        Ok(Self {
            native: Default::default(),
            events: tokio::sync::broadcast::channel(256).0,
            auth: Arc::new(auth::Auth::from_env(client.clone())),
            client,
            worker_url: format!("http://127.0.0.1:{}", env("WORKER_PORT", "3005")),
            key: env("INTERNAL_API_KEY", ""),
            convex_url: cloud.replace(".convex.cloud", ".convex.site"),
            slots: Arc::new(Semaphore::new(64)),
            sockets: Arc::new(Semaphore::new(128)),
            limits: Mutex::new(HashMap::new()),
            origins: env(
                "ALLOWED_ORIGINS",
                "http://localhost:5173,http://localhost:3000",
            )
            .split(',')
            .map(|value| value.trim().into())
            .collect(),
        })
    }
    pub async fn convex(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, &'static str> {
        let retries = if method == Method::GET { 3 } else { 0 };
        self.convex_request(method, path, body, retries).await
    }
    /// Only idempotent writes opt in: retrying an action claim can duplicate its effects.
    pub async fn convex_retry(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, &'static str> {
        self.convex_request(method, path, body, 3).await
    }
    async fn convex_request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        retries: u32,
    ) -> Result<Value, &'static str> {
        if self.convex_url.is_empty() || self.key.is_empty() {
            return Err("Convex is not configured");
        }
        for attempt in 0..=retries {
            let mut request = self
                .client
                .request(method.clone(), format!("{}{path}", self.convex_url))
                .bearer_auth(&self.key)
                .timeout(Duration::from_secs(30));
            if let Some(body) = body {
                request = request.json(body);
            }
            match request.send().await {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        // A malformed successful response is not safe to retry.
                        return bounded_json(response, 10 * 1024 * 1024).await;
                    }
                    if attempt == retries || !(status.as_u16() == 429 || status.is_server_error()) {
                        return Err("Convex rejected the request");
                    }
                }
                Err(error) => {
                    if attempt == retries || error.is_builder() {
                        return Err("Convex request failed");
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(
                1000 * (1 << attempt) + rand::random::<u64>() % 1000,
            ))
            .await;
        }
        unreachable!("Convex attempts always return a response or error")
    }
    fn allow(&self, key: String, limit: usize) -> bool {
        let now = now_ms();
        let mut limits = self.limits.lock().unwrap();
        if limits.len() >= 10_000 {
            limits.retain(|_, (expires, _)| *expires > now);
        }
        if limits.len() >= 10_000 && !limits.contains_key(&key) {
            return false;
        }
        let window = limits.entry(key).or_insert((now + 60_000, 0));
        if window.0 <= now {
            *window = (now + 60_000, 0);
        }
        if window.1 >= limit {
            return false;
        }
        window.1 += 1;
        true
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Operation {
    id: String,
    method: String,
    path: String,
    body: String,
    max_body: usize,
    image_read: bool,
}

pub fn router(state: Arc<Api>) -> Router {
    let definitions: Vec<Operation> =
        serde_json::from_str(include_str!("worker-routes.json")).expect("Static worker routes");
    let mut routes: Router<Arc<Api>> = Router::new();
    for operation in definitions {
        let path = operation
            .path
            .split('/')
            .map(|part| {
                part.strip_prefix(':')
                    .map(|name| format!("{{{name}}}"))
                    .unwrap_or_else(|| part.into())
            })
            .collect::<Vec<_>>()
            .join("/");
        let filter = match operation.method.as_str() {
            "GET" => MethodFilter::GET,
            "POST" => MethodFilter::POST,
            "PUT" => MethodFilter::PUT,
            "DELETE" => MethodFilter::DELETE,
            "ALL" => MethodFilter::GET
                .or(MethodFilter::POST)
                .or(MethodFilter::DELETE),
            _ => panic!("Unknown worker route method"),
        };
        let max_body = operation.max_body;
        let operation = Arc::new(operation);
        let handler = on(
            filter,
            move |State(state): State<Arc<Api>>,
                  Path(params): Path<HashMap<String, String>>,
                  request: Request| {
                invoke(state, operation.clone(), params, request)
            },
        )
        .layer(RequestBodyLimitLayer::new(max_body));
        routes = routes.route(&path, handler.clone());
        if !path.contains('{') {
            routes = routes.route(&format!("{path}/"), handler);
        }
    }
    routes
        .with_state(state.clone())
        .merge(auth::router(state.auth.clone()))
        .route("/api/health", get(health).with_state(state.clone()))
        .route(
            "/api/lead-lists/{operation}",
            on(MethodFilter::POST, lead_list).with_state(state.clone()),
        )
        .route("/ws", get(events::upgrade).with_state(state.clone()))
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .layer(middleware::from_fn_with_state(state, policy))
        .layer(middleware::from_fn(ig_service_common::request_log))
}

pub fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "success": false, "error": { "code": code, "message": message } })),
    )
        .into_response()
}

fn client_ip(request: &Request) -> String {
    let forwarded = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok());
    if let Some(header) = forwarded {
        let mut parts = header.rsplit(',').map(str::trim);
        let last = parts.next();
        let selected = parts.next().or(last);
        if let Some(ip) = selected.and_then(|value| value.parse::<std::net::IpAddr>().ok()) {
            return ip.to_string();
        }
    }
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|address| address.0.ip().to_string())
        .unwrap_or_else(|| "unknown".into())
}

async fn policy(State(state): State<Arc<Api>>, request: Request, next: Next) -> Response {
    let permit = state.slots.clone().try_acquire_owned();
    let origin = request.headers().get(header::ORIGIN).cloned();
    let origin_allowed = !state.auth.production
        || origin
            .as_ref()
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| state.origins.iter().any(|allowed| allowed == value));
    let path = request.uri().path();
    let mut response = if permit.is_err() {
        error(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Too many simultaneous requests",
        )
    } else if request.method() == Method::OPTIONS {
        StatusCode::OK.into_response()
    } else {
        let public = path.starts_with("/api/auth/") || path == "/api/health" || path == "/ws";
        let internal = (path == "/api/automations" || path.starts_with("/api/automations/"))
            && !state.key.is_empty()
            && request
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                == Some(format!("Bearer {}", state.key).as_str());
        if !public
            && !state.auth.bypass
            && !internal
            && state
                .auth
                .verify(auth::session_token(request.headers()))
                .is_none()
        {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Unauthorized: authentication required" })),
            )
                .into_response()
        } else {
            let (bucket, limit) = if path == "/api/auth/tg-link" {
                ("login", 10)
            } else if path == "/api/auth/tg-poll" {
                ("poll", 120)
            } else if path.contains("/content/")
                && path.ends_with("/image")
                && request.method() == Method::GET
            {
                ("images", 600)
            } else {
                ("api", 100)
            };
            if (!public || bucket != "api")
                && !state.allow(format!("{bucket}:{}", client_ip(&request)), limit)
            {
                error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "RATE_LIMITED",
                    "Too many requests, please try again later",
                )
            } else {
                next.run(request).await
            }
        }
    };
    let headers = response.headers_mut();
    if origin_allowed {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            origin.unwrap_or_else(|| HeaderValue::from_static("*")),
        );
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(
            "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token, X-Request-Id",
        ),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("X-Request-Id"),
    );
    headers.append(header::VARY, HeaderValue::from_static("Origin"));
    if let Ok(permit) = permit {
        let (parts, body) = response.into_parts();
        let stream = futures_util::stream::unfold(
            (body.into_data_stream(), permit),
            |(mut stream, permit)| async move {
                stream.next().await.map(|item| (item, (stream, permit)))
            },
        );
        response = Response::from_parts(parts, Body::from_stream(stream));
    }
    response
}

async fn health(State(state): State<Arc<Api>>) -> Response {
    let ready = state
        .client
        .get(format!("{}/health", state.worker_url))
        .bearer_auth(&state.key)
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success());
    if !ready {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "WORKER_UNAVAILABLE",
            "Browser worker is starting",
        );
    }
    Json(json!({ "status": "ok", "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) })).into_response()
}

async fn lead_list(
    State(state): State<Arc<Api>>,
    Path(operation): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if !["rename", "delete"].contains(&operation.as_str()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if body["listId"].as_str().is_none_or(str::is_empty)
        || operation == "rename"
            && body["name"]
                .as_str()
                .is_none_or(|value| value.trim().is_empty())
    {
        return error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            if operation == "rename" {
                "List ID and name are required"
            } else {
                "List ID is required"
            },
        );
    }
    match state
        .convex(
            Method::POST,
            &format!("/api/lead-lists/{operation}"),
            Some(&body),
        )
        .await
    {
        Ok(value) => Json(value).into_response(),
        Err(message) => error(StatusCode::BAD_GATEWAY, "EXTERNAL_SERVICE_ERROR", message),
    }
}

async fn invoke(
    state: Arc<Api>,
    operation: Arc<Operation>,
    params: HashMap<String, String>,
    request: Request,
) -> Response {
    if crate::native::Native::handles(&operation.id) {
        if let Some(native) = state.native.get() {
            return native.invoke(&operation.id, &params, request).await;
        }
    }
    if operation.id == "profiles.get.list" || operation.id == "profiles.get.by-id" {
        let path = if operation.id == "profiles.get.list" {
            "/api/profiles".into()
        } else {
            {
                let query = reqwest::Url::parse(&format!(
                    "http://local/?{}",
                    request.uri().query().unwrap_or("")
                ))
                .unwrap();
                let pairs: HashMap<_, _> = query.query_pairs().into_owned().collect();
                let id = pairs
                    .get("profileId")
                    .or_else(|| pairs.get("id"))
                    .map(|v| v.trim())
                    .unwrap_or("");
                if id.is_empty() {
                    return error(
                        StatusCode::BAD_REQUEST,
                        "VALIDATION_ERROR",
                        "profileId is required",
                    );
                }
                let url =
                    reqwest::Url::parse_with_params("http://local/", [("profileId", id)]).unwrap();
                format!("/api/profiles/by-id?{}", url.query().unwrap())
            }
        };
        return match state.convex(Method::GET, &path, None).await {
            Ok(mut value) => {
                fn strip(value: &mut Value, cookies: bool) {
                    if let Some(row) = value.as_object_mut() {
                        for key in ["sessionId", "login", "testIp"] {
                            row.remove(key);
                        }
                        if cookies {
                            row.remove("cookiesJson");
                        }
                    }
                }
                if let Some(rows) = value.as_array_mut() {
                    for row in rows {
                        strip(row, true);
                    }
                } else {
                    strip(&mut value, false);
                }
                if value.is_null() {
                    error(StatusCode::NOT_FOUND, "NOT_FOUND", "Profile not found")
                } else {
                    Json(value).into_response()
                }
            }
            Err(message) => error(StatusCode::BAD_GATEWAY, "EXTERNAL_SERVICE_ERROR", message),
        };
    }
    let query = request
        .uri()
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    let method = request.method().clone();
    let request_id = request
        .headers()
        .get("x-request-id")
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_str(&Uuid::new_v4().to_string()).unwrap());
    let content_type = if operation.body == "json" {
        "application/json"
    } else {
        "application/octet-stream"
    };
    let exceeded = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mark_exceeded = exceeded.clone();
    let body = request.into_body();
    let body = if operation.body == "json" {
        match to_bytes(body, operation.max_body).await {
            Ok(bytes) if bytes.is_empty() || serde_json::from_slice::<Value>(&bytes).is_ok() => {
                reqwest::Body::from(bytes)
            }
            Ok(_) => {
                return error(
                    StatusCode::BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "Invalid JSON body",
                )
            }
            Err(_) => {
                return error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "PAYLOAD_TOO_LARGE",
                    "Request body too large",
                )
            }
        }
    } else {
        reqwest::Body::wrap_stream(body.into_data_stream().map(move |part| {
            if let Err(error) = &part {
                let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
                while let Some(error) = source {
                    if error.is::<http_body_util::LengthLimitError>() {
                        mark_exceeded.store(true, std::sync::atomic::Ordering::Relaxed);
                        break;
                    }
                    source = error.source();
                }
            }
            part
        }))
    };
    let upstream = state
        .client
        .post(format!(
            "{}/commands/{}{query}",
            state.worker_url, operation.id
        ))
        .bearer_auth(&state.key)
        .header("x-request-id", request_id)
        .header("x-worker-method", method.as_str())
        .header(
            "x-worker-params",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&params).unwrap()),
        )
        .header(header::CONTENT_TYPE, content_type)
        .timeout(Duration::from_secs(30 * 60))
        .body(body)
        .send()
        .await;
    let upstream = match upstream {
        Ok(response) => response,
        Err(_) => {
            if exceeded.load(std::sync::atomic::Ordering::Relaxed) {
                return error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "PAYLOAD_TOO_LARGE",
                    "Request body too large",
                );
            }
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "WORKER_UNAVAILABLE",
                "Browser worker unavailable",
            );
        }
    };
    let mut response = Response::builder().status(upstream.status());
    for name in [
        header::CONTENT_TYPE,
        header::CACHE_CONTROL,
        header::VARY,
        header::RETRY_AFTER,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            response = response.header(name, value);
        }
    }
    if operation.image_read {
        response = response.header(header::CACHE_CONTROL, "private, max-age=3600");
    }
    response
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap()
}

pub async fn bounded_json(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Value, &'static str> {
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err("Response too large");
    }
    // Small reservations avoid trusting a large advertised length from an upstream.
    let capacity = response
        .content_length()
        .unwrap_or(0)
        .min(limit as u64)
        .min(64 * 1024);
    let mut bytes = Vec::with_capacity(capacity as usize);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read response")?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("Response too large");
        }
        bytes.extend_from_slice(&chunk);
    }
    fn parse(bytes: &[u8]) -> Result<Value, &'static str> {
        serde_json::from_slice(bytes.strip_prefix(b"for (;;);").unwrap_or(bytes))
            .map_err(|_| "Invalid JSON response")
    }
    if bytes.len() > 64 * 1024 {
        // Hold capacity inside the blocking task, even if its caller disconnects.
        static PARSERS: Semaphore = Semaphore::const_new(2);
        let permit = PARSERS
            .acquire()
            .await
            .map_err(|_| "Could not parse response")?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            parse(&bytes)
        })
        .await
        .map_err(|_| "Could not parse response")?
    } else {
        parse(&bytes)
    }
}

use uuid::Uuid;
