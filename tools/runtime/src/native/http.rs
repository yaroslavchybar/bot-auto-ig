use super::{Failure, Native, Result};
use crate::api::{self, Api};
use axum::{
    extract::{FromRequest, FromRequestParts, Path, Request},
    http::{request::Parts, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Router,
};
use serde_json::Value;
use std::sync::Arc;

#[cfg(test)]
mod tests;

pub const JSON_LIMIT: usize = 1024 * 1024;

pub struct Services(pub Arc<Native>);
impl FromRequestParts<Arc<Api>> for Services {
    type Rejection = Response;

    async fn from_request_parts(
        _: &mut Parts,
        state: &Arc<Api>,
    ) -> std::result::Result<Self, Response> {
        state.native.get().cloned().map(Self).ok_or_else(|| {
            api::error(
                StatusCode::SERVICE_UNAVAILABLE,
                "NATIVE_UNAVAILABLE",
                "Native services unavailable",
            )
        })
    }
}

/// Keep accepting empty bodies and JSON without requiring a Content-Type header.
pub struct JsonBody(pub Value);
impl<S: Send + Sync> FromRequest<S> for JsonBody {
    type Rejection = Failure;

    async fn from_request(request: Request, _: &S) -> Result<Self> {
        super::body(request).await.map(Self)
    }
}

pub struct DisplayPort(pub u16);
impl<S: Send + Sync> FromRequestParts<S> for DisplayPort {
    type Rejection = Failure;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self> {
        let Path(port) = Path::<u16>::from_request_parts(parts, state)
            .await
            .map_err(|_| Failure::invalid("Invalid display port"))?;
        Ok(Self(port))
    }
}

pub fn router() -> Router<Arc<Api>> {
    super::profiles::routes::router()
        .merge(super::accounts::routes::router())
        .merge(super::content::routes::router())
        .merge(super::processes::routes::router())
        .merge(super::displays::routes::router())
        .route_layer(axum::middleware::from_fn(complete_mutations))
}

/// Once accepted, mutations keep their locks and cleanup even if the caller disconnects.
async fn complete_mutations(request: Request, next: Next) -> Response {
    if matches!(*request.method(), Method::GET | Method::HEAD) {
        return next.run(request).await;
    }
    tokio::spawn(async move { next.run(request).await })
        .await
        .unwrap_or_else(|_| Failure::unavailable("Native operation failed").into_response())
}
