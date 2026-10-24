use crate::{
    api::Api,
    native::{
        http::{DisplayPort, Services, JSON_LIMIT},
        Result,
    },
};
use axum::{
    extract::Request,
    response::Response,
    routing::{get, on, MethodFilter},
    Json, Router,
};
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;

pub fn router() -> Router<Arc<Api>> {
    Router::new()
        .route("/api/displays", get(list))
        .route("/api/displays/", get(list))
        .route("/api/displays/{vncPort}/preview", get(preview))
        .route(
            "/api/displays/{vncPort}/clipboard",
            get(clipboard).post(clipboard),
        )
        .layer(RequestBodyLimitLayer::new(JSON_LIMIT))
        .route(
            "/api/displays/{vncPort}/file-picker",
            on(
                MethodFilter::GET
                    .or(MethodFilter::POST)
                    .or(MethodFilter::DELETE),
                file_picker,
            )
            .layer(RequestBodyLimitLayer::new(51 * 1024 * 1024)),
        )
}
async fn list(Services(native): Services) -> Json<Vec<super::Display>> {
    Json(native.displays.list().await)
}
async fn preview(Services(native): Services, DisplayPort(port): DisplayPort) -> Result<Response> {
    native.displays.preview(port).await
}
async fn clipboard(
    Services(native): Services,
    DisplayPort(port): DisplayPort,
    request: Request,
) -> Result<Response> {
    native.displays.clipboard(port, request).await
}
async fn file_picker(
    Services(native): Services,
    DisplayPort(port): DisplayPort,
    request: Request,
) -> Result<Response> {
    native.displays.file_picker(port, request).await
}
