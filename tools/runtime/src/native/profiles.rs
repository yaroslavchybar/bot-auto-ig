use super::{processes::Processes, Failure, Result};
use crate::api::Api;
use axum::{extract::Request, response::IntoResponse, Json};
use axum::{
    extract::{
        ws::{Message, WebSocketUpgrade},
        State,
    },
    response::Response,
};
use reqwest::Method;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

pub struct Profiles {
    pub api: Arc<Api>,
    pub processes: Arc<Processes>,
    pub(super) root: PathBuf,
}
impl Profiles {
    pub async fn public(
        &self,
        operation: &str,
        params: &HashMap<String, String>,
        request: Request,
    ) -> Result<Response> {
        let query = super::query(request.uri().query().unwrap_or(""));
        let name = params.get("name").map(String::as_str).unwrap_or("");
        let value = match operation {
            "profiles.get.list" => {
                let mut rows = self.list().await?;
                for row in rows.as_array_mut().into_iter().flatten() {
                    strip(row, true);
                }
                rows
            }
            "profiles.get.by-id" => {
                let mut row = self
                    .by_id(
                        query
                            .get("profileId")
                            .or_else(|| query.get("id"))
                            .map(String::as_str)
                            .unwrap_or(""),
                    )
                    .await?;
                if row.is_null() {
                    return Err(Failure::missing("Profile not found"));
                }
                strip(&mut row, false);
                row
            }
            "profiles.post.list" => self.create(super::body(request).await?).await?,
            "profiles.put.name" => {
                self.update(name, super::body(request).await?).await?;
                json!({"success":true})
            }
            "profiles.delete.name" => {
                self.delete(name).await?;
                json!({"success":true})
            }
            "profiles.post.reconcile-runtime" => {
                let mut value = self.reconcile().await?;
                value["success"] = json!(true);
                value
            }
            "profiles.post.sync-status" => {
                let body = super::body(request).await?;
                self.sync(
                    text(&body, "name"),
                    text(&body, "status"),
                    body["using"] == true,
                )
                .await?;
                json!({"success":true})
            }
            _ => return Err(Failure::missing("Unknown profile operation")),
        };
        Ok(Json(value).into_response())
    }
    pub fn new(api: Arc<Api>, processes: Arc<Processes>, root: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            api,
            processes,
            root,
        })
    }
    pub async fn by_name(&self, name: &str) -> Result<Value> {
        validate_name(name)?;
        let query = reqwest::Url::parse_with_params("http://local/", [("name", name)]).unwrap();
        Ok(self
            .api
            .convex(
                Method::GET,
                &format!("/api/profiles/by-name?{}", query.query().unwrap()),
                None,
            )
            .await?)
    }
    pub async fn by_id(&self, id: &str) -> Result<Value> {
        if id.is_empty() || id.len() > 128 {
            return Err(Failure::invalid("id is required"));
        }
        let query = reqwest::Url::parse_with_params("http://local/", [("profileId", id)]).unwrap();
        Ok(self
            .api
            .convex(
                Method::GET,
                &format!("/api/profiles/by-id?{}", query.query().unwrap()),
                None,
            )
            .await?)
    }
    pub async fn list(&self) -> Result<Value> {
        Ok(self.api.convex(Method::GET, "/api/profiles", None).await?)
    }
    async fn locks(&self, names: Vec<String>) -> Result<Vec<Connection>> {
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || lock_names(&root, names))
            .await
            .map_err(|_| Failure::unavailable("Profile lock task failed"))?
    }
    pub async fn create(&self, body: Value) -> Result<Value> {
        let body = normalize_input(body)?;
        self.api
            .convex(Method::POST, "/api/profiles", Some(&body))
            .await?;
        tokio::fs::create_dir_all(self.root.join("data/profiles")).await?;
        Ok(json!({"success": true}))
    }
    pub async fn update(&self, old: &str, body: Value) -> Result<()> {
        validate_name(old)?;
        let mut body = normalize_input(body)?;
        let name = text(&body, "name").to_owned();
        let _starting = self.processes.starting.lock().await;
        self.processes.stop_owners(&[old.into()]).await?;
        let _locks = self.locks(vec![old.into(), name.clone()]).await?;
        body["oldName"] = json!(old);
        let updated = self
            .api
            .convex(Method::POST, "/api/profiles/update-by-name", Some(&body))
            .await?;
        if updated.is_null() {
            return Err(conflict("Profile update failed"));
        }
        let profile = self.by_name(&name).await?;
        self.finish(&profile)
            .await
            .map_err(|_| pending("Rename is pending. Folder moves will retry automatically."))
    }
    pub async fn delete(&self, name: &str) -> Result<()> {
        validate_name(name)?;
        let _starting = self.processes.starting.lock().await;
        let profile = self
            .api
            .convex(
                Method::POST,
                "/api/profiles/begin-delete",
                Some(&json!({"name":name})),
            )
            .await?;
        if profile.is_null() {
            return Ok(());
        }
        self.maintain(&profile)
            .await
            .map_err(|_| pending("Deletion is pending. Cleanup will retry automatically."))
    }
    async fn maintain(&self, profile: &Value) -> Result<()> {
        let mut names = vec![text(profile, "name").to_owned()];
        if let Some(old) = profile["renameFrom"].as_str() {
            names.push(old.into());
        }
        self.processes.stop_owners(&names).await?;
        let _locks = self.locks(names).await?;
        self.finish(profile).await
    }
    async fn finish(&self, profile: &Value) -> Result<()> {
        let root = self.root.join("data/profiles");
        let profile = profile.clone();
        let id = text(&profile, "id").to_owned();
        let deleting = profile["status"] == "deleting";
        if id.is_empty() {
            return Err(Failure::invalid("Profile id is missing"));
        }
        if !deleting && profile["renameFrom"].is_null() {
            return Ok(());
        }
        tokio::task::spawn_blocking(move || finish_files(&root, &profile))
            .await
            .map_err(|_| Failure::unavailable("Profile cleanup task failed"))??;
        self.api
            .convex(
                Method::POST,
                if deleting {
                    "/api/profiles/finish-delete"
                } else {
                    "/api/profiles/finish-rename"
                },
                Some(&json!({"profileId": id})),
            )
            .await?;
        Ok(())
    }
    pub async fn retry(&self) -> Result<()> {
        let _starting = self.processes.starting.lock().await;
        for profile in self.list().await?.as_array().into_iter().flatten() {
            if profile["status"] == "deleting" || profile["renameFrom"].is_string() {
                if let Err(error) = self.maintain(profile).await {
                    ig_service_common::service_error(
                        "profiles.maintenance_pending",
                        &error.message,
                    );
                }
            }
        }
        Ok(())
    }
    pub async fn reconcile(&self) -> Result<Value> {
        let _starting = self.processes.starting.lock().await;
        if self.processes.ownership().await["processCount"]
            .as_u64()
            .unwrap_or(0)
            > 0
        {
            return Ok(json!({"cleared":0,"errors":[]}));
        }
        let mut cleared = 0;
        let mut errors = Vec::new();
        for row in self.list().await?.as_array().into_iter().flatten() {
            if row["using"] != true && row["status"] != "running" {
                continue;
            }
            // Ad-hoc login sessions also hold this lock, even without a supervised process.
            let Ok(_locks) = self.locks(vec![text(row, "name").into()]).await else {
                continue;
            };
            match self.sync(text(row, "name"), "idle", false).await {
                Ok(()) => cleared += 1,
                Err(e) => errors.push(e.message),
            }
        }
        Ok(json!({"cleared":cleared,"errors":errors}))
    }
    pub async fn sync(&self, name: &str, status: &str, using: bool) -> Result<()> {
        validate_name(name)?;
        if status.is_empty() {
            return Err(Failure::invalid("status is required"));
        }
        self.api
            .convex(
                Method::POST,
                "/api/profiles/sync-status",
                Some(&json!({"name":name,"status":status,"using":using})),
            )
            .await?;
        Ok(())
    }
}
fn strip(value: &mut Value, cookies: bool) {
    if let Some(row) = value.as_object_mut() {
        for key in ["sessionId", "login", "testIp"] {
            row.remove(key);
        }
        if cookies {
            row.remove("cookiesJson");
        }
    }
}
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
pub fn conflict(message: &str) -> Failure {
    Failure {
        status: axum::http::StatusCode::CONFLICT,
        message: message.into(),
    }
}
fn pending(message: &str) -> Failure {
    Failure {
        status: axum::http::StatusCode::SERVICE_UNAVAILABLE,
        message: message.into(),
    }
}
pub fn validate_name(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    if name.is_empty()
        || name.len() > 255
        || name.trim() != name
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name.chars().any(|c| "\0\\/<>:\"|?*".contains(c))
        || ["con", "prn", "aux", "nul"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err(Failure::invalid("Invalid profile name"));
    }
    Ok(())
}
// Keep the SQLite files permanently: unlinking one would create a second lock inode.
fn lock_names(root: &Path, mut names: Vec<String>) -> Result<Vec<Connection>> {
    for name in &names {
        validate_name(name)?;
    }
    names = names.into_iter().map(|n| n.to_lowercase()).collect();
    names.sort();
    names.dedup();
    let root = root.join("data/profile-locks");
    std::fs::create_dir_all(&root)?;
    let mut locks = Vec::new();
    for name in names {
        let db = Connection::open(root.join(format!("{name}.sqlite")))?;
        db.execute_batch("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE")
            .map_err(|_| conflict("Profile is already open"))?;
        locks.push(db);
    }
    Ok(locks)
}
fn finish_files(root: &Path, profile: &Value) -> Result<()> {
    let name = text(profile, "name");
    validate_name(name)?;
    let old = profile["renameFrom"].as_str();
    if let Some(old) = old {
        validate_name(old)?;
    }
    if !root.exists() {
        return Ok(());
    }
    if canonical_root(root)? != root {
        return Err(Failure::invalid("Profile root is redirected"));
    }
    if profile["status"] == "deleting" {
        for name in std::iter::once(name).chain(old) {
            let path = root.join(name);
            for attempt in 0..=5 {
                let result = match std::fs::symlink_metadata(&path) {
                    Ok(meta) if meta.file_type().is_symlink() => std::fs::remove_file(&path),
                    Ok(_) => std::fs::remove_dir_all(&path),
                    Err(e) => Err(e),
                };
                match result {
                    Ok(()) => break,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                    Err(e) if attempt == 5 => return Err(e.into()),
                    Err(_) => std::thread::sleep(Duration::from_millis(200)),
                }
            }
        }
    } else if let Some(old) = old {
        let from = root.join(old);
        let to = root.join(name);
        match std::fs::symlink_metadata(&from) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
            Ok(_) => {}
        }
        if std::fs::symlink_metadata(&to).is_ok() && from != to {
            #[cfg(windows)]
            if from.to_string_lossy().to_lowercase() != to.to_string_lossy().to_lowercase() {
                return Err(conflict("Rename destination already exists"));
            }
            #[cfg(not(windows))]
            return Err(conflict("Rename destination already exists"));
        }
        std::fs::rename(from, to)?;
    }
    #[cfg(unix)]
    std::fs::File::open(root)?.sync_all()?;
    Ok(())
}
fn canonical_root(root: &Path) -> Result<PathBuf> {
    let resolved = std::fs::canonicalize(root)?;
    #[cfg(windows)]
    {
        Ok(PathBuf::from(
            resolved
                .to_string_lossy()
                .strip_prefix(r"\\?\")
                .unwrap_or(&resolved.to_string_lossy()),
        ))
    }
    #[cfg(not(windows))]
    {
        Ok(resolved)
    }
}
pub async fn lease(State(state): State<Arc<Profiles>>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(4096)
        .on_upgrade(move |mut socket| async move {
            let Ok(Some(Ok(Message::Text(input)))) =
                tokio::time::timeout(Duration::from_secs(10), socket.recv()).await
            else {
                return;
            };
            let result = async {
                let input: Value = serde_json::from_str(&input)?;
                let name = text(&input, "profileName");
                let locks = state.locks(vec![name.into()]).await?;
                let profile = state.by_name(name).await?;
                if profile.is_null() {
                    return Err(Failure::missing("Profile not found"));
                }
                if profile["status"] == "deleting" || profile["renameFrom"].is_string() {
                    return Err(conflict("Profile maintenance is in progress"));
                }
                Ok(locks)
            }
            .await;
            match result {
                Ok(_locks) => {
                    if socket
                        .send(Message::Text(json!({"ready":true}).to_string().into()))
                        .await
                        .is_ok()
                    {
                        super::displays::lifetime(&mut socket).await;
                    }
                }
                Err(error) => {
                    let _ = socket
                        .send(Message::Text(
                            json!({"error":error.message}).to_string().into(),
                        ))
                        .await;
                }
            }
        })
}
pub fn normalize_input(mut body: Value) -> Result<Value> {
    if !body.is_object() {
        return Err(Failure::invalid("Invalid profile input"));
    }
    validate_name(text(&body, "name"))?;
    if !body["cookiesJson"].is_null() {
        body["cookiesJson"] = cookies(&body["cookiesJson"])?;
    }
    Ok(body)
}
fn cookies(input: &Value) -> Result<Value> {
    let parsed;
    let value = if let Some(raw) = input.as_str() {
        if raw.trim().is_empty() {
            return Ok(json!(""));
        }
        parsed = serde_json::from_str::<Value>(raw)
            .map_err(|_| Failure::invalid("Cookies JSON must be valid JSON"))?;
        &parsed
    } else {
        input
    };
    let list = value
        .as_array()
        .or_else(|| value["cookies"].as_array())
        .or_else(|| value["cookie"].as_array())
        .or_else(|| value["data"]["cookies"].as_array())
        .ok_or_else(|| Failure::invalid("Cookies JSON must contain a cookies array"))?;
    let mut normalized = Vec::new();
    for item in list {
        let name = text(item, "name").trim();
        let value = text(item, "value").trim();
        let url = text(item, "url").trim();
        let domain = text(item, "domain").trim();
        if name.is_empty() || (url.is_empty() && domain.is_empty()) {
            return Err(Failure::invalid(
                "Cookie must include name and domain or url",
            ));
        }
        let mut row = json!({"name":name,"value":value});
        if !url.is_empty() {
            row["url"] = json!(url);
        } else {
            row["domain"] = json!(domain);
            row["path"] = json!(item["path"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("/"));
        }
        let expires = [
            &item["expires"],
            &item["expirationDate"],
            &item["expire_time"],
        ]
        .into_iter()
        .find(|v| !v.is_null());
        if let Some(n) = expires
            .and_then(|v| v.as_f64().or_else(|| v.as_str()?.trim().parse().ok()))
            .filter(|n| n.is_finite())
        {
            row["expires"] = json!(n);
        }
        for (key, aliases) in [
            ("httpOnly", vec!["httpOnly", "http_only"]),
            ("secure", vec!["secure"]),
        ] {
            let v = aliases.iter().map(|k| &item[k]).find(|v| !v.is_null());
            let b = v.and_then(|v| {
                v.as_bool()
                    .or_else(|| v.as_f64().map(|n| n != 0.0))
                    .or_else(|| match v.as_str()?.trim().to_lowercase().as_str() {
                        "true" | "1" => Some(true),
                        "false" | "0" => Some(false),
                        _ => None,
                    })
            });
            if let Some(b) = b {
                row[key] = json!(b);
            }
        }
        let site = item["sameSite"]
            .as_str()
            .or_else(|| item["same_site"].as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let site = match site.as_str() {
            "strict" => "Strict",
            "lax" => "Lax",
            "none" | "no_restriction" | "unspecified" => "None",
            _ => "",
        };
        if !site.is_empty() {
            row["sameSite"] = json!(site);
        }
        normalized.push(row);
    }
    Ok(json!(serde_json::to_string(&normalized)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn failed_rename_keeps_destination_browser_running() {
        use crate::test_support::{body, Fixture};
        let root = tempfile::tempdir().unwrap();
        let workers = root.path().join("server/browser");
        tokio::fs::create_dir_all(&workers).await.unwrap();
        tokio::fs::write(workers.join("manual.ts"), "process.stdin.on('data', data => { if(data.toString().includes('stop')) process.exit(0) });").await.unwrap();
        let statuses = Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let observed = statuses.clone();
        let fixture = Fixture::start(move |request| {
            let observed = observed.clone();
            async move {
                match request.uri().path() {
                    "/api/profiles/by-name" => {
                        Json(json!({"id":"b","name":"B","status":"idle"})).into_response()
                    }
                    "/api/profiles/sync-status" => {
                        observed.lock().await.push(body(request).await);
                        Json(json!({"ok":true})).into_response()
                    }
                    "/api/profiles/update-by-name" => (
                        axum::http::StatusCode::CONFLICT,
                        Json(json!({"error":"Profile name is already in use"})),
                    )
                        .into_response(),
                    _ => panic!("Unexpected profile request"),
                }
            }
        })
        .await;
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.key = "fixture".into();
        let api = Arc::new(api);
        let processes = Processes::new(api.clone(), root.path().into());
        let profiles = Profiles::new(api, processes.clone(), root.path().into());
        processes.start_manual("B").await.unwrap();
        // Cover both a live browser's destination lock and a rejected database rename.
        let lock = lock_names(root.path(), vec!["B".into()]).unwrap();
        assert_eq!(
            profiles
                .update("A", json!({"name":"B"}))
                .await
                .unwrap_err()
                .status,
            axum::http::StatusCode::CONFLICT
        );
        assert_eq!(processes.ownership().await["manuals"], json!(["B"]));
        drop(lock);
        assert!(profiles.update("A", json!({"name":"B"})).await.is_err());
        assert_eq!(processes.ownership().await["manuals"], json!(["B"]));
        assert_eq!(
            statuses.lock().await.as_slice(),
            [json!({"name":"B","status":"running","using":true})]
        );
        processes.shutdown().await.unwrap();
    }
    #[test]
    fn locks_are_exclusive_case_insensitive_and_release_on_drop() {
        let dir = tempfile::tempdir().unwrap();
        let lock = lock_names(dir.path(), vec!["Shared".into()]).unwrap();
        assert!(lock_names(dir.path(), vec!["shared".into()]).is_err());
        drop(lock);
        let _next = lock_names(dir.path(), vec!["Shared".into()]).unwrap();
        for name in ["", "..", "../bad", "con", "COM1.txt", "name.", " name"] {
            assert!(validate_name(name).is_err());
        }
    }
    #[test]
    fn rename_and_delete_are_retry_safe_and_do_not_overwrite_a_destination() {
        let dir = tempfile::tempdir().unwrap();
        let root = canonical_root(dir.path()).unwrap().join("profiles");
        std::fs::create_dir_all(root.join("Old")).unwrap();
        std::fs::write(root.join("Old/cookies"), b"keep").unwrap();
        let row = json!({"name":"New","renameFrom":"Old"});
        finish_files(&root, &row).unwrap();
        finish_files(&root, &row).unwrap();
        assert_eq!(std::fs::read(root.join("New/cookies")).unwrap(), b"keep");
        std::fs::create_dir_all(root.join("Old")).unwrap();
        assert!(finish_files(&root, &row).is_err());
        let row = json!({"name":"New","renameFrom":"Old","status":"deleting"});
        finish_files(&root, &row).unwrap();
        finish_files(&root, &row).unwrap();
        assert!(!root.join("Old").exists() && !root.join("New").exists());
    }
    #[cfg(unix)]
    #[test]
    fn cleanup_unlinks_redirected_profiles_and_rejects_redirected_roots() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("profiles");
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep"), b"keep").unwrap();
        symlink(&outside, root.join("Name")).unwrap();
        finish_files(&root, &json!({"name":"Name","status":"deleting"})).unwrap();
        assert!(outside.join("keep").exists());
        let redirected = dir.path().join("redirected");
        symlink(&outside, &redirected).unwrap();
        assert!(finish_files(&redirected, &json!({"name":"Name","status":"deleting"})).is_err());
    }
    #[test]
    fn cookie_import_normalizes_export_formats() {
        let normalized=normalize_input(json!({"name":"Profile","cookiesJson":{"data":{"cookies":[{"name":" sessionid ","value":" token ","domain":".instagram.com","expirationDate":"123","http_only":"true","secure":1,"same_site":"no_restriction"}]}}})).unwrap();
        let cookies: Value =
            serde_json::from_str(normalized["cookiesJson"].as_str().unwrap()).unwrap();
        assert_eq!(
            cookies,
            json!([{"name":"sessionid","value":"token","domain":".instagram.com","path":"/","expires":123.0,"httpOnly":true,"secure":true,"sameSite":"None"}])
        );
        assert!(normalize_input(json!({"name":"Profile","cookiesJson":"invalid"})).is_err());
        assert!(
            normalize_input(json!({"name":"Profile","cookiesJson":[{"name":"sessionid"}]}))
                .is_err()
        );
    }
}
