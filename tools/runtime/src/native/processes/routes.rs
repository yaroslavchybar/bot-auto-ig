use crate::{
    api::Api,
    native::{
        http::{JsonBody, Services, JSON_LIMIT},
        Failure, Result,
    },
};
use axum::{routing::post, Json, Router};
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;

pub fn router() -> Router<Arc<Api>> {
    Router::new()
        .route("/api/automations/stop", post(stop))
        .route("/api/automations/stop/", post(stop))
        .layer(RequestBodyLimitLayer::new(JSON_LIMIT))
}
async fn stop(Services(native): Services, JsonBody(body): JsonBody) -> Result<Json<Value>> {
    let stopped = native
        .processes
        .stop_automations(body["automationId"].as_str().filter(|s| !s.is_empty()))
        .await?;
    if stopped.is_empty() {
        return Err(Failure::invalid("No automation running"));
    }
    Ok(Json(json!({"success":true,"stopped":stopped})))
}
