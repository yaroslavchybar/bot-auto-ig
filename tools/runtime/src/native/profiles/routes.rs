use super::strip;
use crate::{
    api::Api,
    native::{
        http::{JsonBody, Services, JSON_LIMIT},
        Failure, Result,
    },
};
use axum::{
    extract::{Path, Query},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;

pub fn router() -> Router<Arc<Api>> {
    Router::new()
        .route("/api/profiles", get(list).post(create))
        .route("/api/profiles/", get(list).post(create))
        .route("/api/profiles/by-id", get(by_id))
        .route("/api/profiles/by-id/", get(by_id))
        .route(
            "/api/profiles/{name}",
            axum::routing::put(update).delete(remove),
        )
        .route("/api/profiles/{name}/start", post(start))
        .route("/api/profiles/{name}/stop", post(stop))
        .route("/api/profiles/reconcile-runtime", post(reconcile))
        .route("/api/profiles/reconcile-runtime/", post(reconcile))
        .layer(RequestBodyLimitLayer::new(JSON_LIMIT))
}

async fn list(Services(native): Services) -> Result<Json<Value>> {
    let mut rows = native.profiles.list().await?;
    for row in rows.as_array_mut().into_iter().flatten() {
        strip(row, true);
    }
    Ok(Json(rows))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileQuery {
    profile_id: Option<String>,
    id: Option<String>,
}
async fn by_id(
    Services(native): Services,
    Query(query): Query<ProfileQuery>,
) -> Result<Json<Value>> {
    let mut row = native
        .profiles
        .by_id(query.profile_id.or(query.id).as_deref().unwrap_or(""))
        .await?;
    if row.is_null() {
        return Err(Failure::missing("Profile not found"));
    }
    strip(&mut row, false);
    Ok(Json(row))
}
async fn create(Services(native): Services, JsonBody(body): JsonBody) -> Result<Json<Value>> {
    Ok(Json(native.profiles.create(body).await?))
}
async fn update(
    Services(native): Services,
    Path(name): Path<String>,
    JsonBody(body): JsonBody,
) -> Result<Json<Value>> {
    native.profiles.update(&name, body).await?;
    Ok(Json(json!({"success":true})))
}
async fn remove(Services(native): Services, Path(name): Path<String>) -> Result<Json<Value>> {
    native.profiles.delete(&name).await?;
    Ok(Json(json!({"success":true})))
}
async fn start(Services(native): Services, Path(name): Path<String>) -> Result<Json<Value>> {
    native.processes.start_manual(&name).await?;
    Ok(Json(
        json!({"success":true,"message":format!("Browser started for {name}")}),
    ))
}
async fn stop(Services(native): Services, Path(name): Path<String>) -> Result<Json<Value>> {
    if !native.processes.stop(false, &name, false).await? {
        return Err(Failure::invalid("No browser running for this profile"));
    }
    Ok(Json(
        json!({"success":true,"message":format!("Browser stopped for {name}")}),
    ))
}
async fn reconcile(Services(native): Services) -> Result<Json<Value>> {
    let mut value = native.profiles.reconcile().await?;
    value["success"] = json!(true);
    Ok(Json(value))
}
