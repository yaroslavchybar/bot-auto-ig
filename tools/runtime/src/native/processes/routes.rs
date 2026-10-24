use crate::{
    api::Api,
    native::{
        http::{JsonBody, Services, JSON_LIMIT},
        Failure, Result,
    },
};
use axum::{
    extract::Query,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;

pub fn router() -> Router<Arc<Api>> {
    Router::new()
        .route("/api/automations/status", get(status))
        .route("/api/automations/status/", get(status))
        .route("/api/automations/run", post(run))
        .route("/api/automations/run/", post(run))
        .route("/api/automations/stop", post(stop))
        .route("/api/automations/stop/", post(stop))
        .layer(RequestBodyLimitLayer::new(JSON_LIMIT))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusQuery {
    automation_id: Option<String>,
}
async fn status(Services(native): Services, Query(query): Query<StatusQuery>) -> Json<Value> {
    Json(
        native
            .processes
            .status_value(query.automation_id.as_deref())
            .await,
    )
}
async fn run(Services(native): Services, JsonBody(body): JsonBody) -> Result<Json<Value>> {
    native
        .processes
        .start_automation(body["automationId"].as_str().unwrap_or(""))
        .await?;
    Ok(Json(json!({"success":true,"message":"Automation started"})))
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
