use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use ig_service_common::RequestContext;
use serde::Deserialize;
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};
use tokio::sync::Semaphore;

#[derive(Clone)]
struct Service {
    root: PathBuf,
    queue: Arc<Semaphore>,
    pending: Arc<Semaphore>,
}
#[derive(Deserialize)]
struct Input {
    source: String,
}

fn source_parts(root: &Path, source: &Path) -> Result<Vec<String>, &'static str> {
    let relative = source
        .strip_prefix(root)
        .map_err(|_| "Invalid source path")?;
    let parts: Vec<_> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().to_string())
        .collect();
    if parts.len() != 4
        || !(4..=100).contains(&parts[0].len())
        || !parts[0]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        || !matches!(parts[1].as_str(), "posts" | "avatars")
        || !uuid_like(&parts[2])
        || !matches!(
            parts[3].to_ascii_lowercase().as_str(),
            "source.jpg" | "source.jpeg" | "source.png" | "source.webp"
        )
    {
        return Err("Invalid source path");
    }
    Ok(parts)
}

fn uuid_like(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

async fn variants(
    State(state): State<Service>,
    Extension(context): Extension<RequestContext>,
    Json(input): Json<Input>,
) -> Response {
    let Ok(_pending) = state.pending.clone().try_acquire_owned() else {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"Too many pending images"})),
        )
            .into_response();
    };
    let source = PathBuf::from(input.source);
    let parts = match source_parts(&state.root, &source) {
        Ok(parts) => parts,
        Err(error) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"error":error})),
            )
                .into_response()
        }
    };
    // Canonical paths also prevent a symlink inside the source bank escaping it.
    let (Ok(root), Ok(source)) = (
        tokio::fs::canonicalize(&state.root).await,
        tokio::fs::canonicalize(&source).await,
    ) else {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error":"Source image is missing"})),
        )
            .into_response();
    };
    if !source.starts_with(root) {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    context.add("modelId", parts[0].clone());
    context.add("contentKind", parts[1].clone());
    context.add("sourceId", parts[2].clone());
    let queued = Instant::now();
    let permit = match state.queue.acquire_owned().await {
        Ok(permit) => permit,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    context.add("queueWaitMs", queued.elapsed().as_millis() as u64);
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        crate::variant_engine::generate(&source, &source.parent().unwrap().join("variants"), 50)
    })
    .await;
    match result {
        Ok(Ok(result)) => {
            context.add(
                "outputCount",
                result["outputs"].as_array().map_or(0, Vec::len) as u64,
            );
            context.add(
                "failureCount",
                result["failures"].as_array().map_or(0, Vec::len) as u64,
            );
            context.add(
                "failed",
                !result["failures"].as_array().is_some_and(Vec::is_empty),
            );
            Json(result).into_response()
        }
        Ok(Err(error)) => {
            context.add("failed", true);
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"error":error})),
            )
                .into_response()
        }
        Err(_) => {
            context.add("failed", true);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"Image processing failed"})),
            )
                .into_response()
        }
    }
}

pub async fn serve() -> Result<(), Box<dyn std::error::Error>> {
    std::env::set_var("LOG_SERVICE", "spoofer");
    let root =
        std::env::var("SPOOFER_DATA_ROOT").unwrap_or_else(|_| "/app/data/model-content".into());
    let app = Router::new()
        .route("/health", get(|| async { Json(json!({"ok":true})) }))
        .route("/variants", post(variants))
        .with_state(Service {
            root: PathBuf::from(root),
            queue: Arc::new(Semaphore::new(1)),
            pending: Arc::new(Semaphore::new(32)),
        })
        .layer(DefaultBodyLimit::max(2048))
        .layer(middleware::from_fn(ig_service_common::request_log));
    let port = std::env::var("SPOOFER_PORT").unwrap_or_else(|_| "3002".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sources_cannot_escape_model_bank() {
        let root = Path::new("/app/data/model-content");
        assert!(source_parts(root, Path::new("/app/data/model-content/model123/posts/11111111-1111-4111-8111-111111111111/source.jpg")).is_ok());
        assert!(source_parts(root, Path::new("/app/data/model-content/../password")).is_err());
        assert!(source_parts(root, Path::new("/etc/password")).is_err());
    }
}
