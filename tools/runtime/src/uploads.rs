use axum::{
    extract::{Query, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};
use tempfile::TempDir;
use tokio::{
    io::AsyncWriteExt,
    sync::{Mutex, Semaphore},
};
use uuid::Uuid;

pub struct Upload {
    _directory: TempDir,
    expires: Instant,
}
impl Upload {
    pub fn is_live(&self) -> bool {
        self.expires > Instant::now()
    }
}
pub struct Uploads {
    pub entries: Mutex<HashMap<String, Upload>>,
    pub slots: Arc<Semaphore>,
}

/// Force-stopped helpers cannot drop TempDir handles; expire their owned directories on restart.
pub async fn cleanup_orphans(root: &std::path::Path, minimum_age: Duration) -> std::io::Result<()> {
    let mut entries = tokio::fs::read_dir(root).await?;
    while let Some(entry) = entries.next_entry().await? {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("ig-chat-upload-")
            || !entry.file_type().await?.is_dir()
        {
            continue;
        }
        let metadata = entry.metadata().await?;
        let age = metadata
            .created()
            .or_else(|_| metadata.modified())
            .ok()
            .and_then(|time| SystemTime::now().duration_since(time).ok());
        if age.is_some_and(|age| age >= minimum_age) {
            // read_dir gives direct children; symlinks are excluded by file_type above.
            let _ = tokio::fs::remove_dir_all(entry.path()).await;
        }
    }
    Ok(())
}
#[derive(Deserialize)]
pub struct Kind {
    kind: String,
}

pub fn valid_header(kind: &str, header: &[u8]) -> bool {
    match kind {
        "photo" => header.starts_with(&[0xff, 0xd8]),
        "video" => header.get(4..8) == Some(b"ftyp"),
        "voice" => true,
        _ => false,
    }
}

/// Spool bounded uploads to disk with backpressure, without collecting their bodies.
pub async fn stage(
    State(state): State<Arc<Uploads>>,
    Query(kind): Query<Kind>,
    request: Request,
) -> Response {
    if !matches!(kind.kind.as_str(), "photo" | "video" | "voice") {
        return rejection(StatusCode::UNPROCESSABLE_ENTITY, "Invalid attachment kind");
    }
    let Ok(_permit) = state.slots.clone().try_acquire_owned() else {
        return rejection(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many simultaneous uploads",
        );
    };
    {
        let mut entries = state.entries.lock().await;
        entries.retain(|_, upload| upload.is_live());
        if entries.len() >= 32 {
            return rejection(StatusCode::TOO_MANY_REQUESTS, "Too many pending uploads");
        }
    }
    let limit = if kind.kind == "video" {
        25_000_000
    } else {
        10_000_000
    };
    let Ok(directory) = tempfile::Builder::new().prefix("ig-chat-upload-").tempdir() else {
        return rejection(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Upload storage unavailable",
        );
    };
    let path = directory.path().join("input");
    let result =
        tokio::time::timeout(Duration::from_secs(120), receive(request, &path, limit)).await;
    let (mut size, header) = match result {
        Ok(Ok(value)) => value,
        Ok(Err(status)) => {
            return rejection(status, "Attachment is empty, incomplete or too large")
        }
        Err(_) => return rejection(StatusCode::REQUEST_TIMEOUT, "Upload timed out"),
    };
    if !valid_header(&kind.kind, &header) {
        return rejection(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Choose a JPEG photo or MP4 video",
        );
    }
    let mut prepared = path;
    if kind.kind == "voice" {
        prepared = directory.path().join("voice.m4a");
        let mut command = tokio::process::Command::new("ffmpeg");
        command
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-threads",
                "1",
                "-i",
            ])
            .arg(directory.path().join("input"))
            .args([
                "-vn", "-t", "120", "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-ar", "44100",
            ])
            .arg(&prepared)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let result = tokio::time::timeout(Duration::from_secs(60), command.status()).await;
        if !matches!(result, Ok(Ok(status)) if status.success()) {
            return rejection(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Audio could not be converted to an Instagram voice message",
            );
        }
        size = tokio::fs::metadata(&prepared)
            .await
            .map(|value| value.len())
            .unwrap_or(0);
        if size == 0 || size > 10_000_000 {
            return rejection(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Voice message is too large",
            );
        }
        let _ = tokio::fs::remove_file(directory.path().join("input")).await;
    }
    let id = Uuid::new_v4().to_string();
    let mut entries = state.entries.lock().await;
    entries.retain(|_, upload| upload.is_live());
    if entries.len() >= 32 {
        return rejection(StatusCode::TOO_MANY_REQUESTS, "Too many pending uploads");
    }
    let response = Json(
        json!({"id": id, "path": prepared, "size": size, "voiceConverted": kind.kind == "voice"}),
    );
    entries.insert(
        id,
        Upload {
            _directory: directory,
            expires: Instant::now() + Duration::from_secs(15 * 60),
        },
    );
    response.into_response()
}

async fn receive(
    request: Request,
    path: &PathBuf,
    limit: u64,
) -> Result<(u64, Vec<u8>), StatusCode> {
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stream = request.into_body().into_data_stream();
    let mut size = 0u64;
    let mut header = Vec::with_capacity(12);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| StatusCode::BAD_REQUEST)?;
        size += chunk.len() as u64;
        if size > limit {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }
        let prefix = (12 - header.len()).min(chunk.len());
        header.extend_from_slice(&chunk[..prefix]);
        file.write_all(&chunk)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    file.flush()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if size == 0 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok((size, header))
}

pub async fn remove(
    State(state): State<Arc<Uploads>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    state.entries.lock().await.remove(&id);
    Json(json!({"ok": true}))
}

fn rejection(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;

    #[tokio::test]
    async fn orphan_cleanup_only_removes_owned_expired_directories() {
        let root = tempfile::tempdir().unwrap();
        let owned = root.path().join("ig-chat-upload-orphan");
        let other = root.path().join("unrelated");
        tokio::fs::create_dir(&owned).await.unwrap();
        tokio::fs::create_dir(&other).await.unwrap();
        cleanup_orphans(root.path(), Duration::from_secs(900))
            .await
            .unwrap();
        assert!(owned.exists());
        cleanup_orphans(root.path(), Duration::ZERO).await.unwrap();
        assert!(!owned.exists());
        assert!(other.exists());
    }
    #[tokio::test]
    async fn large_and_empty_uploads_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("upload");
        assert_eq!(
            receive(Request::new(Body::from(vec![0; 100])), &path, 99)
                .await
                .unwrap_err(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(
            receive(Request::new(Body::empty()), &path, 99)
                .await
                .unwrap_err(),
            StatusCode::BAD_REQUEST
        );
    }
    #[test]
    fn magic_is_checked_before_uploading() {
        assert!(valid_header("photo", &[0xff, 0xd8]));
        assert!(!valid_header("photo", b"not a jpeg"));
        assert!(valid_header("video", b"0000ftyp"));
        assert!(!valid_header("video", b"short"));
    }
}
