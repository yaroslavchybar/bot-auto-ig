use super::Content;
use crate::{
    api::Api,
    native::{
        http::{Services, JSON_LIMIT},
        Failure, Result,
    },
};
use axum::{
    body::to_bytes,
    extract::{Path, Query, Request},
    http::StatusCode,
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;

pub fn router() -> Router<Arc<Api>> {
    Router::new()
        .route("/api/ig-accounts/models/{modelId}/content", get(list))
        .route(
            "/api/ig-accounts/models/{modelId}/content/{kind}/{contentId}/image",
            get(image),
        )
        .route(
            "/api/ig-accounts/models/{modelId}/content/{kind}/{contentId}/copies/{variant}/image",
            get(copy_image),
        )
        .route(
            "/api/ig-accounts/models/{modelId}/content/{kind}/{contentId}/copies",
            get(copies).post(generate),
        )
        .route(
            "/api/ig-accounts/models/{modelId}/content/{kind}/{contentId}",
            axum::routing::delete(remove),
        )
        .layer(RequestBodyLimitLayer::new(JSON_LIMIT))
        .route(
            "/api/ig-accounts/models/{modelId}/content/{kind}",
            post(add).layer(RequestBodyLimitLayer::new(15 * 1024 * 1024)),
        )
}

async fn storage_key(api: &Api, model: &str) -> Result<String> {
    Content::storage_key(api, model).await.map_err(|error| {
        if error.status == StatusCode::NOT_FOUND {
            Failure::invalid("Model not found")
        } else {
            error
        }
    })
}
#[derive(Deserialize)]
struct ContentQuery {
    thumbnail: Option<String>,
    name: Option<String>,
}
async fn list(Services(native): Services, Path(model): Path<String>) -> Result<Json<Value>> {
    let model = storage_key(&native.api, &model).await?;
    Ok(Json(native.content.list(&model).await?))
}
async fn image(
    Services(native): Services,
    Path((model, kind, id)): Path<(String, String, String)>,
    Query(query): Query<ContentQuery>,
) -> Result<Response> {
    let model = storage_key(&native.api, &model).await?;
    native
        .content
        .image(
            &model,
            &kind,
            &id,
            None,
            query.thumbnail.as_deref() == Some("1"),
        )
        .await
}
async fn copy_image(
    Services(native): Services,
    Path((model, kind, id, variant)): Path<(String, String, String, String)>,
    Query(query): Query<ContentQuery>,
) -> Result<Response> {
    let model = storage_key(&native.api, &model).await?;
    native
        .content
        .image(
            &model,
            &kind,
            &id,
            Some(&variant),
            query.thumbnail.as_deref() == Some("1"),
        )
        .await
}
async fn copies(
    Services(native): Services,
    Path((model, kind, id)): Path<(String, String, String)>,
) -> Result<Json<Value>> {
    let model = storage_key(&native.api, &model).await?;
    Ok(Json(native.content.copies(&model, &kind, &id).await?))
}
async fn generate(
    Services(native): Services,
    Path((model, kind, id)): Path<(String, String, String)>,
) -> Result<Json<Value>> {
    let model = storage_key(&native.api, &model).await?;
    Ok(Json(
        native
            .content
            .generate(&native.api, &model, &kind, &id)
            .await?,
    ))
}
async fn remove(
    Services(native): Services,
    Path((model, kind, id)): Path<(String, String, String)>,
) -> Result<Json<Value>> {
    let model = storage_key(&native.api, &model).await?;
    Ok(Json(native.content.remove(&model, &kind, &id).await?))
}
async fn add(
    Services(native): Services,
    Path((model, kind)): Path<(String, String)>,
    Query(query): Query<ContentQuery>,
    request: Request,
) -> Result<Json<Value>> {
    let model = storage_key(&native.api, &model).await?;
    let bytes = to_bytes(request.into_body(), 15 * 1024 * 1024)
        .await
        .map_err(|_| Failure {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "Image must be 1–15 MB".into(),
        })?;
    Ok(Json(
        native
            .content
            .add(
                &native.api,
                &model,
                &kind,
                query.name.as_deref().unwrap_or(""),
                &bytes,
            )
            .await?,
    ))
}
