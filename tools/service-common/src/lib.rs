use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};
use serde_json::{json, Map, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
mod logging;
pub use logging::{log_environment, sanitize_log_text, write_log_entry};

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
    service_log(event, message, "error", "error", json!({}));
}

/// Startup metadata uses the same collector schema as request completions.
pub fn service_event(event: &str, message: &str, context: Value) {
    service_log(event, message, "info", "success", context);
}

fn service_log(event: &str, message: &str, level: &str, outcome: &str, context: Value) {
    let service = std::env::var("LOG_SERVICE").unwrap_or_else(|_| "runtime".into());
    let entry = json!({ "id": Uuid::new_v4().to_string(), "ts": now_ms(),
        "event": event, "message": message, "level": level, "source": service,
        "requestId": Uuid::new_v4().to_string(), "outcome": outcome, "context": context,
        "environment": log_environment(&service)
    });
    write_log_entry(entry);
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
    write_log_entry(json!({
        "id": Uuid::new_v4().to_string(), "ts": now_ms(), "event": "http.request",
        "message": "http request", "source": service, "requestId": request_id,
        "level": if failed { "error" } else { "info" },
        "outcome": if failed { "error" } else if status >= 400 { "rejected" } else { "success" },
        "durationMs": started.elapsed().as_millis() as u64, "context": &*fields,
        "environment": log_environment(&service)
    }));
    response
}
