use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};
use serde_json::{json, Map, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone)]
pub struct RequestContext(pub Arc<Mutex<Map<String, Value>>>);

impl RequestContext {
    pub fn add(&self, key: &str, value: impl Into<Value>) {
        self.0.lock().unwrap().insert(key.into(), value.into());
    }
}

/// Startup failures use the same schema as request completions and reach the collector.
pub fn service_error(event: &str, message: &str) {
    let service = std::env::var("LOG_SERVICE").unwrap_or_else(|_| "runtime".into());
    eprintln!(
        "{}",
        json!({ "id": Uuid::new_v4().to_string(), "ts": now_ms(),
            "event": event, "message": message, "level": "error", "source": service,
            "requestId": Uuid::new_v4().to_string(), "outcome": "error", "context": {},
            "environment": { "service": service, "runtime": "rust",
                "commitHash": std::env::var("COMMIT_SHA").unwrap_or_else(|_| "unknown".into()) }
        })
    );
}

/// Log one completion event. Payloads, headers, paths on disk and credentials stay out.
pub async fn request_log(mut request: Request, next: Next) -> Response {
    let started = Instant::now();
    let incoming = request
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok());
    let request_id = incoming
        .filter(|value| {
            (8..=128).contains(&value.len())
                && value
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        })
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let context = RequestContext(Arc::new(Mutex::new(Map::new())));
    request
        .headers_mut()
        .insert("x-request-id", HeaderValue::from_str(&request_id).unwrap());
    context.add("method", request.method().as_str());
    context.add("path", request.uri().path());
    request.extensions_mut().insert(context.clone());
    let mut response = next.run(request).await;
    let status = response.status().as_u16();
    context.add("statusCode", status);
    response
        .headers_mut()
        .insert("x-request-id", HeaderValue::from_str(&request_id).unwrap());
    let fields = context.0.lock().unwrap();
    let failed = fields
        .get("failed")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || status >= 500;
    let service = std::env::var("LOG_SERVICE").unwrap_or_else(|_| "runtime".into());
    let env = |key, fallback: &str| std::env::var(key).unwrap_or_else(|_| fallback.into());
    println!(
        "{}",
        json!({
            "id": Uuid::new_v4().to_string(), "ts": now_ms(), "event": "http.request",
            "message": "http request", "source": service, "requestId": request_id,
            "level": if failed { "error" } else { "info" },
            "outcome": if failed { "error" } else if status >= 400 { "rejected" } else { "success" },
            "durationMs": started.elapsed().as_millis() as u64, "context": &*fields,
            "environment": { "service": service, "runtime": "rust", "version": env("SERVICE_VERSION", "1.0.0"),
                "commitHash": env("COMMIT_SHA", "unknown"), "region": env("REGION", "unknown"),
                "instanceId": env("INSTANCE_ID", &service), "nodeEnv": env("NODE_ENV", "production") }
        })
    );
    response
}
