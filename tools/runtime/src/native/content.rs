use super::{Failure, Result};
use crate::api::Api;
use axum::{body::Body, response::Response};
use image::ImageDecoder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::{Mutex, OwnedMutexGuard, Semaphore};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub variants: Vec<String>,
    pub assigned: HashMap<String, usize>,
    pub created_at: u64,
}

/// All manifest access, including browser-worker allocations, has one native owner.
pub struct Content {
    root: PathBuf,
    manifests: std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>,
    generating: std::sync::Mutex<HashSet<String>>,
    images: Arc<Semaphore>,
    #[cfg(test)]
    spoofer: Option<String>,
}

impl Content {
    pub fn new(root: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            root,
            manifests: Default::default(),
            generating: Default::default(),
            images: Arc::new(Semaphore::new(1)),
            #[cfg(test)]
            spoofer: None,
        })
    }
    fn directory(&self, model: &str) -> Result<PathBuf> {
        if !(4..=100).contains(&model.len())
            || !model
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err(Failure::invalid("Invalid model ID"));
        }
        Ok(self.root.join(model))
    }
    fn kind(kind: &str) -> Result<()> {
        if matches!(kind, "posts" | "avatars") {
            Ok(())
        } else {
            Err(Failure::invalid("Choose posts or avatars"))
        }
    }
    // Validation, manifest writes and deletion share a lock only within one model.
    async fn model_lock(&self, model: &str) -> Result<OwnedMutexGuard<()>> {
        self.directory(model)?;
        let lock = {
            let mut locks = self.manifests.lock().unwrap();
            // Holders and waiters keep their Arc alive; unused locks can be discarded.
            locks.retain(|_, lock| Arc::strong_count(lock) > 1);
            locks.entry(model.into()).or_default().clone()
        };
        Ok(lock.lock_owned().await)
    }
    async fn read(&self, model: &str) -> Result<Vec<Item>> {
        match tokio::fs::read(self.directory(model)?.join("manifest.json")).await {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }
    async fn write(&self, model: &str, rows: &[Item]) -> Result<()> {
        let dir = self.directory(model)?;
        tokio::fs::create_dir_all(&dir).await?;
        atomic_write(&dir.join("manifest.json"), &serde_json::to_vec(rows)?).await
    }
    pub async fn list(&self, model: &str) -> Result<Value> {
        let _lock = self.model_lock(model).await?;
        Ok(Value::Array(self.read(model).await?.into_iter().map(|row| json!({"id": row.id, "kind": row.kind, "name": row.name,
            "variantCount": row.variants.len(), "usedCount": row.assigned.len(), "createdAt": row.created_at})).collect()))
    }
    pub async fn add(
        &self,
        api: &Api,
        model: &str,
        kind: &str,
        name: &str,
        bytes: &[u8],
    ) -> Result<Value> {
        let _lock = self.model_lock(model).await?;
        self.require_model(api, model).await?;
        self.add_locked(model, kind, name, bytes).await
    }
    async fn require_model(&self, api: &Api, model: &str) -> Result<()> {
        self.directory(model)?;
        let models = api.convex(reqwest::Method::GET, "/api/lists", None).await?;
        if !models
            .as_array()
            .is_some_and(|rows| rows.iter().any(|row| row["id"] == model))
        {
            return Err(Failure::missing("Model not found"));
        }
        Ok(())
    }
    async fn add_locked(&self, model: &str, kind: &str, name: &str, bytes: &[u8]) -> Result<Value> {
        Self::kind(kind)?;
        if bytes.is_empty() || bytes.len() > 15 * 1024 * 1024 {
            return Err(Failure::invalid("Image must be 1–15 MB"));
        }
        let extension = extension(name)?;
        let id = Uuid::new_v4().to_string();
        let dir = self.directory(model)?.join(kind).join(&id);
        tokio::fs::create_dir_all(&dir).await?;
        let result = async {
            atomic_write(&dir.join(format!("source{extension}")), bytes).await?;
            let mut rows = self.read(model).await?;
            rows.push(Item {
                id: id.clone(),
                kind: kind.into(),
                name: name.rsplit(['/', '\\']).next().unwrap_or(name).into(),
                variants: vec![],
                assigned: HashMap::new(),
                created_at: crate::api::now_ms(),
            });
            self.write(model, &rows).await
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_dir_all(&dir).await;
        }
        result?;
        Ok(json!({"id": id, "variantCount": 0}))
    }
    async fn item(&self, model: &str, kind: &str, id: &str) -> Result<Item> {
        Self::kind(kind)?;
        self.read(model)
            .await?
            .into_iter()
            .find(|r| r.id == id && r.kind == kind)
            .ok_or_else(|| Failure::missing("Image not found"))
    }
    pub async fn copies(&self, model: &str, kind: &str, id: &str) -> Result<Value> {
        let _lock = self.model_lock(model).await?;
        Ok(json!(self.item(model, kind, id).await?.variants))
    }
    pub async fn remove(&self, model: &str, kind: &str, id: &str) -> Result<Value> {
        let _lock = self.model_lock(model).await?;
        if self
            .generating
            .lock()
            .unwrap()
            .contains(&format!("{model}:{id}"))
        {
            return Err(Failure::invalid("Copy generation is running"));
        }
        let item = self.item(model, kind, id).await?;
        let mut rows = self.read(model).await?;
        rows.retain(|r| r.id != id);
        self.write(model, &rows).await?;
        tokio::fs::remove_dir_all(self.directory(model)?.join(kind).join(item.id)).await?;
        Ok(json!({"removed": true}))
    }
    pub async fn remove_model(&self, model: &str) -> Result<()> {
        let _lock = self.model_lock(model).await?;
        if self
            .generating
            .lock()
            .unwrap()
            .iter()
            .any(|key| key.starts_with(&format!("{model}:")))
        {
            return Err(Failure::unavailable("Copy generation is running"));
        }
        match tokio::fs::remove_dir_all(self.directory(model)?).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
    pub async fn model_directories(&self) -> Result<Vec<String>> {
        let mut entries = match tokio::fs::read_dir(&self.root).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut models = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_dir() {
                if let Some(model) = entry
                    .file_name()
                    .to_str()
                    .filter(|model| self.directory(model).is_ok())
                {
                    models.push(model.to_owned());
                }
            }
        }
        Ok(models)
    }
    pub async fn generate(
        self: &Arc<Self>,
        api: &Api,
        model: &str,
        kind: &str,
        id: &str,
    ) -> Result<Value> {
        let key = format!("{model}:{id}");
        {
            let _lock = self.model_lock(model).await?;
            self.require_model(api, model).await?;
            let item = self.item(model, kind, id).await?;
            if !item.variants.is_empty() {
                return Err(Failure::invalid("Copies already exist"));
            }
            if !self.generating.lock().unwrap().insert(key.clone()) {
                return Err(Failure::invalid("Copy generation already running"));
            }
        }
        // The guard removes the in-flight mark even if a caller disconnects.
        struct Generating<'a>(&'a std::sync::Mutex<HashSet<String>>, String);
        impl Drop for Generating<'_> {
            fn drop(&mut self) {
                self.0.lock().unwrap().remove(&self.1);
            }
        }
        let _generation = Generating(&self.generating, key);
        let item = self.item(model, kind, id).await?;
        let dir = self.directory(model)?.join(kind).join(id);
        let result = async {
            let source = dir.join(format!("source{}", extension(&item.name)?));
            let url = crate::api::env("SPOOFER_URL", "http://spoofer:3002/variants");
            #[cfg(test)]
            let url = self.spoofer.clone().unwrap_or(url);
            let response = api
                .client
                .post(url)
                .json(&json!({"source": source}))
                .timeout(std::time::Duration::from_secs(30 * 60))
                .send()
                .await
                .map_err(|_| Failure::unavailable("Spoofer unavailable"))?;
            if !response.status().is_success() {
                return Err(Failure::unavailable("Spoofer could not generate copies"));
            }
            let data = crate::api::bounded_json(response, 1024 * 1024).await?;
            let names: std::collections::BTreeSet<_> = data["outputs"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v["name"].as_str())
                .filter(|v| valid_variant(v))
                .map(str::to_owned)
                .collect();
            if names.len() != 50 || data["failures"].as_array().is_some_and(|v| !v.is_empty()) {
                return Err(Failure::unavailable(
                    "Spoofer did not produce 50 unique copies",
                ));
            }
            let _lock = self.model_lock(model).await?;
            let mut rows = self.read(model).await?;
            let row = rows
                .iter_mut()
                .find(|r| r.id == id && r.kind == kind)
                .ok_or_else(|| Failure::missing("Image not found"))?;
            row.variants = names.into_iter().collect();
            self.write(model, &rows).await?;
            Ok(json!({"id": id, "variantCount": 50}))
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_dir_all(dir.join("variants")).await;
        }
        result
    }
    pub async fn allocate(
        &self,
        model: &str,
        kind: &str,
        profile: &str,
        exclude: &[String],
        count: bool,
    ) -> Result<Value> {
        Self::kind(kind)?;
        if profile.is_empty() || profile.len() > 128 {
            return Err(Failure::invalid("Profile ID is required"));
        }
        let _lock = self.model_lock(model).await?;
        let mut rows = self.read(model).await?;
        let available = |r: &&mut Item| {
            r.kind == kind
                && !exclude.contains(&r.id)
                && (r.assigned.contains_key(profile) || r.assigned.len() < r.variants.len())
        };
        if count {
            return Ok(json!(rows.iter_mut().filter(available).count()));
        }
        let Some(row) = rows.iter_mut().find(available) else {
            return Ok(Value::Null);
        };
        let already_assigned = row.assigned.contains_key(profile);
        let index = match row.assigned.get(profile) {
            Some(index) => *index,
            None => {
                let used: HashSet<_> = row.assigned.values().copied().collect();
                let Some(index) = (0..row.variants.len()).find(|i| !used.contains(i)) else {
                    return Ok(Value::Null);
                };
                row.assigned.insert(profile.into(), index);
                index
            }
        };
        let variant = row
            .variants
            .get(index)
            .filter(|v| valid_variant(v))
            .ok_or_else(|| Failure::unavailable("Invalid content assignment"))?;
        let value = json!({"sourceId": row.id, "path": self.directory(model)?.join(kind).join(&row.id).join("variants").join(variant)});
        if !already_assigned {
            self.write(model, &rows).await?;
        }
        Ok(value)
    }
    pub async fn image(
        &self,
        model: &str,
        kind: &str,
        id: &str,
        variant: Option<&str>,
        preview: bool,
    ) -> Result<Response> {
        let _lock = self.model_lock(model).await?;
        let item = self.item(model, kind, id).await?;
        let dir = self.directory(model)?.join(kind).join(&item.id);
        let (file, mime) = if let Some(variant) = variant {
            if !valid_variant(variant) || !item.variants.iter().any(|name| name == variant) {
                return Err(Failure::missing("Image not found"));
            }
            (dir.join("variants").join(variant), "image/jpeg")
        } else {
            let extension = extension(&item.name)?;
            let mime = match extension.as_str() {
                ".png" => "image/png",
                ".webp" => "image/webp",
                _ => "image/jpeg",
            };
            (dir.join(format!("source{extension}")), mime)
        };
        drop(_lock);
        if preview {
            let destination = file.with_file_name(format!(
                "{}.thumbnail.webp",
                file.file_name().unwrap().to_string_lossy()
            ));
            let bytes = match tokio::fs::read(&destination).await {
                Ok(bytes) => bytes,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    let permit = self
                        .images
                        .clone()
                        .acquire_owned()
                        .await
                        .map_err(|_| Failure::unavailable("Image service stopped"))?;
                    // Another queued request may have filled the disk cache.
                    if let Ok(bytes) = tokio::fs::read(&destination).await {
                        return Ok(image_response(Body::from(bytes), "image/webp"));
                    }
                    let bytes = tokio::task::spawn_blocking(move || {
                        let _permit = permit;
                        thumbnail(&file)
                    })
                    .await
                    .map_err(|_| Failure::unavailable("Image decoder failed"))??;
                    atomic_write(&destination, &bytes).await?;
                    bytes
                }
                Err(e) => return Err(e.into()),
            };
            return Ok(image_response(Body::from(bytes), "image/webp"));
        }
        let file = tokio::fs::File::open(file).await?;
        Ok(image_response(
            Body::from_stream(tokio_util::io::ReaderStream::new(file)),
            mime,
        ))
    }
}
fn image_response(body: Body, mime: &str) -> Response {
    Response::builder()
        .header("Content-Type", mime)
        .header("Cache-Control", "private, max-age=3600")
        .header("Vary", "Authorization")
        .body(body)
        .unwrap()
}
fn extension(name: &str) -> Result<String> {
    let extension = Path::new(name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        Ok(format!(".{extension}"))
    } else {
        Err(Failure::invalid("Upload a JPG, PNG, or WebP image"))
    }
}
fn valid_variant(name: &str) -> bool {
    !name.contains(['/', '\\'])
        && name.to_ascii_lowercase().ends_with(".jpg")
        && !name.contains('\0')
}
pub async fn atomic_write(file: &Path, bytes: &[u8]) -> Result<()> {
    let temp = file.with_file_name(format!(
        "{}.{}.tmp",
        file.file_name().unwrap().to_string_lossy(),
        Uuid::new_v4()
    ));
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let result = async {
        use tokio::io::AsyncWriteExt;
        let mut output = options.open(&temp).await?;
        output.write_all(bytes).await?;
        output.sync_all().await?;
        drop(output);
        tokio::fs::rename(&temp, file).await
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(temp).await;
    }
    result.map_err(Into::into)
}
fn thumbnail(file: &Path) -> Result<Vec<u8>> {
    let mut reader = image::ImageReader::open(file)?.with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(200 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| Failure::invalid("Invalid image"))?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > 40_000_000 {
        return Err(Failure::invalid("Image dimensions are too large"));
    }
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut frame = image::DynamicImage::from_decoder(decoder)
        .map_err(|_| Failure::invalid("Invalid image"))?;
    frame.apply_orientation(orientation);
    let frame = frame.thumbnail(512, 512);
    let mut bytes = std::io::Cursor::new(Vec::new());
    frame
        .write_to(&mut bytes, image::ImageFormat::WebP)
        .map_err(|_| Failure::unavailable("Thumbnail encoding failed"))?;
    Ok(bytes.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn model_cleanup_is_scoped_idempotent_and_waits_for_generation() {
        let root = tempfile::tempdir().unwrap();
        let bank = Content::new(root.path().into());
        let model = root.path().join("model-1");
        let sibling = root.path().join("model-2");
        for dir in [&model, &sibling] {
            tokio::fs::create_dir_all(dir.join("posts/image/variants"))
                .await
                .unwrap();
            tokio::fs::write(dir.join("posts/image/variants/copy.jpg"), b"copy")
                .await
                .unwrap();
            tokio::fs::write(dir.join("manifest.json"), b"[]")
                .await
                .unwrap();
        }
        bank.generating
            .lock()
            .unwrap()
            .insert("model-1:image".into());
        assert!(bank.remove_model("model-1").await.is_err());
        assert!(model.exists());
        bank.generating.lock().unwrap().clear();
        assert!(bank.remove_model("../model-2").await.is_err());
        bank.remove_model("model-1").await.unwrap();
        bank.remove_model("model-1").await.unwrap();
        assert!(!model.exists());
        assert!(sibling.join("posts/image/variants/copy.jpg").exists());
        assert_eq!(bank.model_directories().await.unwrap(), vec!["model-2"]);
    }
    #[tokio::test]
    async fn uploads_cannot_recreate_a_deleted_model() {
        use crate::test_support::Fixture;
        use axum::{response::IntoResponse, Json};
        let fixture = Fixture::start(move |_| async { Json(json!([])).into_response() }).await;
        let root = tempfile::tempdir().unwrap();
        let bank = Content::new(root.path().into());
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.key = "fixture".into();
        assert!(bank
            .add(&api, "model-deleted", "posts", "source.jpg", b"image")
            .await
            .is_err());
        assert!(!root.path().join("model-deleted").exists());
    }
    #[tokio::test]
    async fn slow_model_validation_is_isolated_and_serialized_with_deletion() {
        use crate::test_support::Fixture;
        use axum::{response::IntoResponse, Json};
        use std::time::Duration;

        for generate in [false, true] {
            let entered = Arc::new(tokio::sync::Notify::new());
            let release = Arc::new(tokio::sync::Notify::new());
            let arrival = entered.clone();
            let finish = release.clone();
            let fixture = Fixture::start(move |request| {
                let arrival = arrival.clone();
                let finish = finish.clone();
                async move {
                    if request.uri().path() == "/api/lists" {
                        arrival.notify_one();
                        finish.notified().await;
                        return Json(json!([{"id": "model-1"}])).into_response();
                    }
                    Json(json!({"outputs": (0..50).map(|n|
                        json!({"name": format!("copy_{n}.jpg")})).collect::<Vec<_>>()
                    }))
                    .into_response()
                }
            })
            .await;
            let root = tempfile::tempdir().unwrap();
            let mut bank = Content::new(root.path().into());
            Arc::get_mut(&mut bank).unwrap().spoofer = Some(fixture.url.clone());
            let added = bank
                .add_locked("model-1", "posts", "source.jpg", b"image")
                .await
                .unwrap();
            bank.write(
                "model-2",
                &[Item {
                    id: "source".into(),
                    kind: "posts".into(),
                    name: "source.jpg".into(),
                    variants: vec!["copy.jpg".into()],
                    assigned: HashMap::new(),
                    created_at: 0,
                }],
            )
            .await
            .unwrap();
            let mut api = Api::from_env().unwrap();
            api.convex_url = fixture.url.clone();
            api.key = "fixture".into();
            let native = bank.clone();
            let task = tokio::spawn(async move {
                if generate {
                    native
                        .generate(&api, "model-1", "posts", added["id"].as_str().unwrap())
                        .await
                } else {
                    native
                        .add(&api, "model-1", "posts", "second.jpg", b"image")
                        .await
                }
            });
            tokio::time::timeout(Duration::from_secs(5), entered.notified())
                .await
                .unwrap();

            let deletion = bank.remove_model("model-1");
            tokio::pin!(deletion);
            // Poll deletion first so it is queued behind validation. Other models still work.
            tokio::select! {
                biased;
                result = &mut deletion => panic!("Deletion bypassed model validation: {result:?}"),
                result = tokio::time::timeout(Duration::from_secs(5), async {
                    assert_eq!(bank.list("model-2").await.unwrap().as_array().unwrap().len(), 1);
                    assert_eq!(bank.allocate("model-2", "posts", "profile", &[], false)
                        .await.unwrap()["sourceId"], "source");
                    bank.remove_model("model-2").await.unwrap();
                }) => result.unwrap(),
            }
            release.notify_one();
            let (operation, removal) = tokio::time::timeout(Duration::from_secs(5), async {
                tokio::join!(task, &mut deletion)
            })
            .await
            .unwrap();
            operation.unwrap().unwrap();
            if let Err(error) = removal {
                assert!(generate);
                assert!(error.message.contains("Copy generation is running"));
                bank.remove_model("model-1").await.unwrap();
            }
            assert!(!root.path().join("model-1").exists());
        }
    }
    #[tokio::test]
    async fn concurrent_allocations_are_unique_and_idempotent() {
        let root = tempfile::tempdir().unwrap();
        let bank = Content::new(root.path().into());
        bank.write(
            "model-1",
            &[Item {
                id: "source".into(),
                kind: "posts".into(),
                name: "x.jpg".into(),
                variants: (0..50).map(|n| format!("{n}.jpg")).collect(),
                assigned: HashMap::new(),
                created_at: 0,
            }],
        )
        .await
        .unwrap();
        let mut tasks = Vec::new();
        for n in 0..50 {
            let bank = bank.clone();
            tasks.push(tokio::spawn(async move {
                bank.allocate("model-1", "posts", &format!("p{n}"), &[], false)
                    .await
                    .unwrap()
            }));
        }
        let mut paths = HashSet::new();
        for task in tasks {
            paths.insert(task.await.unwrap()["path"].as_str().unwrap().to_owned());
        }
        assert_eq!(paths.len(), 50);
        assert_eq!(
            bank.allocate("model-1", "posts", "extra", &[], false)
                .await
                .unwrap(),
            Value::Null
        );
        assert_ne!(
            bank.allocate("model-1", "posts", "p0", &[], false)
                .await
                .unwrap(),
            Value::Null
        );
        assert!(bank.list("../escape").await.is_err());
        assert!(bank.copies("model-1", "avatars", "source").await.is_err());
    }
    #[tokio::test]
    async fn originals_and_cached_thumbnails_are_scoped_and_upload_failures_clean_up() {
        let root = tempfile::tempdir().unwrap();
        let bank = Content::new(root.path().into());
        let frame = image::RgbImage::from_pixel(1600, 1000, image::Rgb([18, 52, 86]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(frame)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let added = bank
            .add_locked("model-1", "posts", "original.png", bytes.get_ref())
            .await
            .unwrap();
        let id = added["id"].as_str().unwrap();
        assert_eq!(added["variantCount"], 0);
        assert_eq!(
            bank.allocate("model-1", "posts", "p", &[], false)
                .await
                .unwrap(),
            Value::Null
        );
        assert!(bank
            .image("model-1", "avatars", id, None, false)
            .await
            .is_err());
        assert!(bank
            .image("model-2", "posts", id, None, false)
            .await
            .is_err());
        let response = bank
            .image("model-1", "posts", id, None, true)
            .await
            .unwrap();
        assert_eq!(response.headers()["content-type"], "image/webp");
        let thumb = axum::body::to_bytes(response.into_body(), 2_000_000)
            .await
            .unwrap();
        let image = image::load_from_memory(&thumb).unwrap();
        assert!(image.width() <= 512 && image.height() <= 512);
        let again = bank
            .image("model-1", "posts", id, None, true)
            .await
            .unwrap();
        assert_eq!(
            thumb,
            axum::body::to_bytes(again.into_body(), 2_000_000)
                .await
                .unwrap()
        );
        assert_eq!(
            tokio::fs::read(
                root.path()
                    .join("model-1/posts")
                    .join(id)
                    .join("source.png")
            )
            .await
            .unwrap(),
            bytes.into_inner()
        );
        bank.remove("model-1", "posts", id).await.unwrap();
        assert!(bank
            .list("model-1")
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
        tokio::fs::create_dir_all(root.path().join("model-bad/manifest.json"))
            .await
            .unwrap();
        assert!(bank
            .add_locked("model-bad", "posts", "original.jpg", b"image")
            .await
            .is_err());
        assert!(tokio::fs::read_dir(root.path().join("model-bad/posts"))
            .await
            .unwrap()
            .next_entry()
            .await
            .unwrap()
            .is_none());
    }
    #[tokio::test]
    async fn generation_rejects_duplicate_runs_and_deletion_then_publishes_fifty_copies() {
        use crate::test_support::Fixture;
        use axum::{response::IntoResponse, Json};
        let root = tempfile::tempdir().unwrap();
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let arrival = entered.clone();
        let finish = release.clone();
        let fixture=Fixture::start(move |request| { let arrival=arrival.clone(); let finish=finish.clone(); async move { if request.uri().path()=="/api/lists" { return Json(json!([{"id":"model-1"}])).into_response(); } arrival.notify_one(); finish.notified().await;
            Json(json!({"outputs":(0..50).map(|n|json!({"name":format!("copy_{n}.jpg")})).collect::<Vec<_>>()})).into_response()
        }}).await;
        let mut bank = Content::new(root.path().into());
        Arc::get_mut(&mut bank).unwrap().spoofer = Some(fixture.url.clone());
        let added = bank
            .add_locked("model-1", "posts", "image.jpg", b"original")
            .await
            .unwrap();
        let id = added["id"].as_str().unwrap().to_owned();
        let native = bank.clone();
        let item = id.clone();
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.key = "fixture".into();
        let api = Arc::new(api);
        let task_api = api.clone();
        let task =
            tokio::spawn(
                async move { native.generate(&task_api, "model-1", "posts", &item).await },
            );
        entered.notified().await;
        assert!(bank
            .generate(&api, "model-1", "posts", &id)
            .await
            .unwrap_err()
            .message
            .contains("already running"));
        assert!(bank.remove("model-1", "posts", &id).await.is_err());
        assert!(bank.remove_model("model-1").await.is_err());
        release.notify_one();
        assert_eq!(task.await.unwrap().unwrap()["variantCount"], 50);
        assert_eq!(
            bank.copies("model-1", "posts", &id)
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            50
        );
        assert!(bank
            .generate(&api, "model-1", "posts", &id)
            .await
            .unwrap_err()
            .message
            .contains("already exist"));
        assert_eq!(
            bank.allocate("model-1", "posts", "p", &[id], true)
                .await
                .unwrap(),
            0
        );
    }
    #[tokio::test]
    async fn underproduced_duplicate_and_failed_generations_remove_partial_files() {
        use crate::test_support::Fixture;
        use axum::{response::IntoResponse, Json};
        for names in [
            vec!["same.jpg"; 50],
            vec!["one.jpg"; 12],
            vec!["../bad.jpg"; 50],
            vec![],
        ] {
            let fixture=Fixture::start(move |request| { let names=names.clone(); async move {
                if request.uri().path()=="/api/lists" { return Json(json!([{"id":"model-1"}])).into_response(); }
                if names.is_empty() { return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(); }
                Json(json!({"outputs":names.into_iter().map(|name|json!({"name":name})).collect::<Vec<_>>()})).into_response()
            }}).await;
            let root = tempfile::tempdir().unwrap();
            let mut bank = Content::new(root.path().into());
            Arc::get_mut(&mut bank).unwrap().spoofer = Some(fixture.url.clone());
            let added = bank
                .add_locked("model-1", "posts", "image.jpg", b"original")
                .await
                .unwrap();
            let id = added["id"].as_str().unwrap();
            let mut api = Api::from_env().unwrap();
            api.convex_url = fixture.url.clone();
            api.key = "fixture".into();
            let partial = root.path().join("model-1/posts").join(id).join("variants");
            tokio::fs::create_dir_all(&partial).await.unwrap();
            tokio::fs::write(partial.join("partial.jpg"), b"partial")
                .await
                .unwrap();
            assert!(bank.generate(&api, "model-1", "posts", id).await.is_err());
            assert!(!partial.exists());
            assert_eq!(
                bank.allocate("model-1", "posts", "p", &[], false)
                    .await
                    .unwrap(),
                Value::Null
            );
        }
    }
}
