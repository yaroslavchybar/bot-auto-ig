mod cache;
pub mod model;
mod pictures;
#[cfg(test)]
mod tests;

use super::{Failure, Result};
use crate::{
    api::Api,
    instagram::{self, Command, Service as Mobile},
};
use axum::{
    body::to_bytes,
    extract::Request,
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use cache::Cache;
use model::{Inbox, Thread};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, sync::Arc};
use tokio::sync::Mutex;

#[derive(Default)]
struct Entry {
    token: String,
    inbox: Option<Inbox>,
    checked: u64,
    threads: HashMap<String, u64>,
    failures: HashMap<String, (u64, String)>,
    published: Option<(String, Vec<String>)>,
}
pub struct Chat {
    api: Arc<Api>,
    mobile: Arc<Mobile>,
    db: Arc<std::sync::Mutex<Cache>>,
    profiles: Mutex<HashMap<String, Arc<Mutex<Entry>>>>,
    commands: Arc<tokio::sync::Semaphore>,
    picture_slots: Arc<tokio::sync::Semaphore>,
}
impl Chat {
    pub fn update_contexts(
        &self,
        contexts: Vec<instagram::SessionContext>,
        connection: Arc<super::subscriptions::Subscriptions>,
    ) {
        self.mobile.update_contexts(contexts, connection);
    }
    pub fn clear_contexts(&self) {
        self.mobile.clear_contexts();
    }
    pub fn new(api: Arc<Api>, mobile: Arc<Mobile>, file: &Path) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            api,
            mobile,
            db: Arc::new(std::sync::Mutex::new(Cache::open(file)?)),
            profiles: Default::default(),
            commands: Arc::new(tokio::sync::Semaphore::new(4)),
            picture_slots: Arc::new(tokio::sync::Semaphore::new(4)),
        }))
    }
    async fn db<T: Send + 'static>(
        &self,
        action: impl FnOnce(&mut Cache) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || action(&mut db.lock().unwrap()))
            .await
            .map_err(|_| Failure::unavailable("Chat storage task failed"))?
    }
    async fn entry(&self, id: &str) -> Result<Arc<Mutex<Entry>>> {
        if id.trim().is_empty() || id.len() > 128 {
            return Err(Failure::invalid("Select a profile"));
        }
        let mut entries = self.profiles.lock().await;
        if let Some(entry) = entries.get(id) {
            return Ok(entry.clone());
        }
        if entries.len() >= 32 {
            if let Some(key) = entries
                .iter()
                .find(|(_, entry)| Arc::strong_count(entry) == 1 && entry.try_lock().is_ok())
                .map(|(key, _)| key.clone())
            {
                entries.remove(&key);
            } else {
                return Err(Failure::unavailable("Too many active Chat profiles"));
            }
        }
        let entry = Arc::new(Mutex::new(Entry::default()));
        entries.insert(id.into(), entry.clone());
        Ok(entry)
    }
    async fn mobile(
        &self,
        action: &str,
        id: &str,
        args: Value,
        token: Option<&str>,
    ) -> Result<Value> {
        let _permit = self
            .commands
            .acquire()
            .await
            .map_err(|_| Failure::unavailable("Chat stopped"))?;
        self.mobile
            .invoke(
                action,
                &Command {
                    profile_id: id.into(),
                    args,
                    token: token.map(str::to_owned),
                },
            )
            .await
            .map_err(map_instagram)
    }
    async fn load(&self, id: &str, entry: &mut Entry) -> Result<Value> {
        let session = self.mobile("load", id, json!({}), None).await?;
        let token = instagram::string(&session["token"]);
        let viewer = instagram::string(&session["viewerId"]);
        let profile = id.to_owned();
        let bound = token.clone();
        let rebound = self
            .db(move |db| db.connect(&profile, &bound, &viewer))
            .await?;
        if entry.token != token || rebound {
            *entry = Entry {
                token,
                ..Default::default()
            };
        }
        Ok(session)
    }
    async fn publish(&self, id: &str, entry: &mut Entry) -> Result<()> {
        let profile = id.to_owned();
        let unread_thread_ids = self.db(move |db| db.unread_thread_ids(&profile)).await?;
        let key = (entry.token.clone(), unread_thread_ids.clone());
        if entry.published.as_ref() == Some(&key) {
            return Ok(());
        }
        if self
            .api
            .convex(
                Method::POST,
                "/api/chat/count",
                Some(&json!({"profileId": id, "token": entry.token, "unreadThreadIds": unread_thread_ids})),
            )
            .await
            .is_ok()
        {
            entry.published = Some(key);
        }
        Ok(())
    }
    fn changed(&self, id: &str, thread: Option<&str>, message: Option<&str>) {
        let mut event = json!({"type": "chat_changed", "profileId": id});
        if let Some(thread) = thread {
            event["threadId"] = json!(thread);
        }
        if let Some(message) = message {
            event["messageId"] = json!(message);
        }
        let _ = self.api.events.send(event);
    }
    pub async fn inbox(&self, id: &str, force: bool) -> Result<Inbox> {
        let lock = self.entry(id).await?;
        let mut entry = lock.lock().await;
        let now = crate::api::now_ms();
        if !force
            && entry.inbox.as_ref().is_some_and(|i| !i.connected)
            && now.saturating_sub(entry.checked) < 60_000
        {
            return Ok(entry.inbox.clone().unwrap());
        }
        match self.load(id, &mut entry).await {
            Ok(_) => {}
            Err(error) if error.message == "Connect this profile to Instagram Chat first" => {
                let profile = id.to_owned();
                self.db(move |db| db.clear(&profile)).await?;
                entry.inbox = Some(Inbox::default());
                entry.checked = now;
                return Ok(Inbox::default());
            }
            Err(error) => return Err(error),
        }
        let old = if let Some(inbox) = &entry.inbox {
            inbox.clone()
        } else {
            let id = id.to_owned();
            self.db(move |db| db.inbox(&id)).await?
        };
        entry.inbox = Some(old.clone());
        // Refresh all picture URLs daily; unread-only snapshots miss quiet contacts.
        let profile = id.to_owned();
        let needs_pictures = self.db(move |db| db.needs_picture_urls(&profile)).await?;
        if !force
            && !needs_pictures
            && old.synced_at != 0
            && now.saturating_sub(entry.checked.max(old.synced_at)) < 60_000
        {
            return Ok(old);
        }
        if !force {
            if let Some((until, message)) = entry
                .failures
                .get("inbox")
                .filter(|(until, _)| *until > now)
            {
                let _ = until;
                return if old.synced_at > 0 {
                    Ok(old)
                } else {
                    Err(Failure::unavailable(message.clone()))
                };
            }
        }
        // Recent snapshots must include read/sent chats. Merge them with older
        // contacts between daily picture refreshes instead of replacing the inbox.
        let partial = old.synced_at > 0 && !needs_pictures;
        let fetched = self
            .mobile(
                "inbox",
                id,
                json!({"onlyUnread": false}),
                Some(&entry.token),
            )
            .await;
        let data = match fetched {
            Ok(data) => data,
            Err(error) => {
                entry
                    .failures
                    .insert("inbox".into(), (now + 120_000, error.message.clone()));
                return if old.synced_at > 0 {
                    Ok(old)
                } else {
                    Err(error)
                };
            }
        };
        let items = data["threads"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|v| model::thread(v, true))
            .collect();
        let viewer = instagram::string(&data["viewerId"]);
        let token = entry.token.clone();
        let profile = id.to_owned();
        let saved = self
            .db(move |db| db.save_inbox(&profile, &token, &viewer, items, partial))
            .await?;
        if old.threads != saved.threads {
            self.changed(id, None, None);
        }
        entry.inbox = Some(saved.clone());
        entry.checked = now;
        entry.failures.remove("inbox");
        self.publish(id, &mut entry).await?;
        Ok(saved)
    }
    pub async fn thread(&self, id: &str, thread: &str, force: bool) -> Result<Thread> {
        let lock = self.entry(id).await?;
        let mut entry = lock.lock().await;
        self.load(id, &mut entry).await?;
        let profile = id.to_owned();
        let thread_id = thread.to_owned();
        let old = self.db(move |db| db.thread(&profile, &thread_id)).await?;
        let now = crate::api::now_ms();
        if !force
            && entry
                .threads
                .get(thread)
                .is_some_and(|at| now.saturating_sub(*at) < 20_000)
        {
            if let Some(old) = old {
                return Ok(old);
            }
        }
        if !force {
            if let Some((_, message)) = entry.failures.get(thread).filter(|(until, _)| *until > now)
            {
                return old.ok_or_else(|| Failure::unavailable(message.clone()));
            }
        }
        let data = match self
            .mobile(
                "thread",
                id,
                json!({"threadId": thread}),
                Some(&entry.token),
            )
            .await
        {
            Ok(data) => data,
            Err(error) => {
                if entry.failures.len() >= 100 {
                    entry.failures.clear();
                }
                entry
                    .failures
                    .insert(thread.into(), (now + 120_000, error.message.clone()));
                return old.ok_or(error);
            }
        };
        if data["thread"].is_null() {
            return Err(Failure::unavailable("Instagram returned no DM thread"));
        }
        let item = model::thread(&data["thread"], false);
        let profile = id.to_owned();
        let token = entry.token.clone();
        let saved = self
            .db(move |db| db.save_thread(&profile, &token, item, now))
            .await?;
        if old.as_ref() != Some(&saved) {
            self.changed(id, Some(thread), None);
        }
        if entry.threads.len() >= 100 {
            entry.threads.clear();
        }
        entry.threads.insert(thread.into(), now);
        entry.failures.remove(thread);
        entry.inbox = None;
        entry.checked = 0;
        self.publish(id, &mut entry).await?;
        Ok(saved)
    }
    pub async fn retain(&self, mut ids: Vec<String>) -> Result<()> {
        let mut profiles = self.profiles.lock().await;
        profiles.retain(|id, entry| ids.contains(id) || Arc::strong_count(entry) > 1);
        // In-flight requests retain both layers. Block new entries until pruning finishes.
        ids.extend(profiles.keys().cloned());
        let result = self.db(move |db| db.retain(&ids)).await;
        drop(profiles);
        result
    }
    pub async fn clear(&self, id: &str) -> Result<()> {
        let lock = self.entry(id).await?;
        let mut entry = lock.lock().await;
        let profile = id.to_owned();
        self.db(move |db| db.clear(&profile)).await?;
        *entry = Entry::default();
        self.changed(id, None, None);
        Ok(())
    }
    fn refresh(self: &Arc<Self>, id: &str, thread: &str) {
        let chat = self.clone();
        let id = id.to_owned();
        let thread = thread.to_owned();
        tokio::spawn(async move {
            if let Err(error) = chat.thread(&id, &thread, true).await {
                ig_service_common::service_error("chat.refresh_failed", &error.message);
            }
        });
    }
    async fn profile(&self, id: &str) -> Result<Value> {
        if id.is_empty() || id.len() > 128 {
            return Err(Failure::invalid("Select a profile"));
        }
        let query = reqwest::Url::parse_with_params("http://local/", [("profileId", id)]).unwrap();
        let profile = self
            .api
            .convex(
                Method::GET,
                &format!("/api/profiles/by-id?{}", query.query().unwrap()),
                None,
            )
            .await?;
        if profile.is_null() {
            Err(Failure::missing("Profile not found"))
        } else {
            Ok(profile)
        }
    }
    pub async fn public(
        self: &Arc<Self>,
        operation: &str,
        params: &HashMap<String, String>,
        request: Request,
    ) -> Response {
        match self.handle(operation, params, request).await {
            Ok(response) => response,
            Err(error) => error.into_response(),
        }
    }
    async fn handle(
        self: &Arc<Self>,
        operation: &str,
        params: &HashMap<String, String>,
        request: Request,
    ) -> Result<Response> {
        let query = super::query(request.uri().query().unwrap_or(""));
        let id = params.get("profileId").map(String::as_str).unwrap_or("");
        let thread = params.get("threadId").map(String::as_str).unwrap_or("");
        if operation == "chat.get.archives" {
            return Ok(Json(
                self.api
                    .convex(Method::GET, "/api/chat/archives", None)
                    .await?,
            )
            .into_response());
        }
        if operation == "chat.get.threads" {
            let profiles = self.api.convex(Method::GET, "/api/profiles", None).await?;
            let profiles: Vec<_> = profiles
                .as_array()
                .into_iter()
                .flatten()
                .filter(|p| p["igLoggedIn"] == true && p["status"] != "deleting")
                .cloned()
                .collect();
            let mut threads = Vec::new();
            let mut errors = Vec::new();
            use futures_util::{stream, StreamExt};
            let force = query.get("refresh").is_some_and(|v| v == "1");
            let results: Vec<_> = stream::iter(profiles.into_iter().map(|profile| {
                let chat = self.clone();
                async move {
                    let id = instagram::string(&profile["id"]);
                    let inbox = chat.inbox(&id, force).await;
                    (id, instagram::string(&profile["name"]), inbox)
                }
            }))
            .buffer_unordered(4)
            .collect()
            .await;
            for (id, name, inbox) in results {
                match inbox {
                    Ok(inbox) => {
                        for thread in inbox.threads {
                            let mut value = serde_json::to_value(thread)?;
                            value["profileId"] = json!(id);
                            value["profileName"] = json!(name);
                            value["viewerId"] = json!(inbox.viewer_id);
                            threads.push(value);
                        }
                    }
                    Err(_) => {
                        errors.push(json!({"profileName": name, "message": "Could not load inbox"}))
                    }
                }
            }
            return Ok(Json(json!({"threads": threads, "errors": errors})).into_response());
        }
        let profile = self.profile(id).await?;
        if operation == "chat.get.profileId_avatars_userId_image" {
            return self
                .picture(
                    id,
                    params.get("userId").map(String::as_str).unwrap_or(""),
                    &profile,
                )
                .await;
        }
        if !thread.is_empty() {
            valid_id(thread)?;
        }
        if operation == "chat.get.profileId_session" {
            return Ok(Json(self.mobile("has", id, json!({}), None).await?).into_response());
        }
        if operation == "chat.delete.profileId_session" {
            let lock = self.entry(id).await?;
            let mut entry = lock.lock().await;
            self.mobile("logout", id, json!({}), None).await?;
            let profile = id.to_owned();
            self.db(move |db| db.clear(&profile)).await?;
            *entry = Entry::default();
            self.changed(id, None, None);
            return Ok(Json(json!({"connected": false})).into_response());
        }
        if operation == "chat.get.profileId_threads" {
            let inbox = self
                .inbox(id, query.get("refresh").is_some_and(|v| v == "1"))
                .await?;
            if !inbox.connected {
                return Err(Failure::invalid(
                    "Connect this profile to Instagram Chat first",
                ));
            }
            return Ok(Json(inbox).into_response());
        }
        if operation == "chat.get.profileId_threads_threadId" {
            return Ok(Json(
                self.thread(id, thread, query.get("refresh").is_some_and(|v| v == "1"))
                    .await?,
            )
            .into_response());
        }
        if operation.ends_with("_older") {
            return Ok(Json(self.older(id, thread, &query).await?).into_response());
        }
        if operation.ends_with("_attachment") {
            let kind = query.get("kind").map(String::as_str).unwrap_or("");
            if !matches!(kind, "photo" | "video" | "voice") {
                return Err(Failure::invalid("Choose a photo, video, or voice message"));
            }
            let context = context(query.get("clientContext").map(String::as_str))?;
            let video = if kind == "video" {
                Some(video(&query)?)
            } else {
                None
            };
            let uploads = self.mobile.uploads.clone();
            let staged = crate::uploads::stage(
                axum::extract::State(uploads.clone()),
                axum::extract::Query(crate::uploads::Kind { kind: kind.into() }),
                request,
            )
            .await;
            if !staged.status().is_success() {
                return Ok(staged);
            }
            let bytes = to_bytes(staged.into_body(), 4096)
                .await
                .map_err(|_| Failure::unavailable("Upload failed"))?;
            let staged: Value = serde_json::from_slice(&bytes)?;
            let upload_id = instagram::string(&staged["id"]);
            let result = async {
                let lock = self.entry(id).await?;
                let mut entry = lock.lock().await;
                self.load(id, &mut entry).await?;
                let result = self.mobile("attachment", id, json!({"threadId": thread, "kind": kind, "uploadId": upload_id, "clientContext": context, "video": video}), Some(&entry.token)).await?;
                entry.threads.remove(thread);
                entry.inbox = None;
                Ok::<_, Failure>(result)
            }.await;
            uploads.entries.lock().await.remove(&upload_id);
            let result = result?;
            let mut sent = model::message(&result["payload"]);
            if sent.kind == "text" {
                sent.kind = kind.into();
            }
            sent.media_type = Some(kind.into());
            sent.client_context = Some(context);
            if sent.timestamp == 0.0 {
                sent.timestamp = crate::api::now_ms() as f64;
            }
            self.refresh(id, thread);
            return Ok(Json(json!({"success": true, "message": sent})).into_response());
        }
        let bytes = to_bytes(request.into_body(), 1024 * 1024)
            .await
            .map_err(|_| Failure::invalid("Request body too large"))?;
        let body: Value = if bytes.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&bytes)?
        };
        if operation == "chat.post.profileId_archive" {
            let archived = body["archived"]
                .as_bool()
                .ok_or_else(|| Failure::invalid("Invalid archive status"))?;
            let thread = body["threadId"].as_str().unwrap_or("");
            valid_id(thread)?;
            let rows = self
                .api
                .convex(
                    Method::POST,
                    "/api/chat/archives",
                    Some(&json!({"profileId": id, "threadId": thread, "archived": archived})),
                )
                .await?;
            let _ = self
                .api
                .events
                .send(json!({"type": "chat_changed", "profileId": id, "threadId": thread, "archivesChanged": true}));
            return Ok(Json(rows).into_response());
        }
        let lock = self.entry(id).await?;
        let mut entry = lock.lock().await;
        if operation == "chat.post.profileId_session" {
            if profile["igLoggedIn"] != true || profile["status"] == "deleting" {
                return Err(Failure::invalid("Turn on Logged in for this profile"));
            }
            let credentials = credentials(body["credentials"].as_str().unwrap_or(""))?;
            self.mobile("login", id, credentials, None).await?;
            *entry = Entry::default();
            self.load(id, &mut entry).await?;
            return Ok(Json(json!({"connected": true})).into_response());
        }
        self.load(id, &mut entry).await?;
        let response = if operation.ends_with("_reply") {
            let text = body["text"]
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.chars().count() <= 1000)
                .ok_or_else(|| Failure::invalid("Reply must contain 1 to 1000 characters"))?
                .trim();
            let context = context(body["clientContext"].as_str())?;
            let value = self
                .mobile(
                    "reply",
                    id,
                    json!({"threadId": thread, "text": text, "clientContext": context}),
                    Some(&entry.token),
                )
                .await?;
            let mut sent = model::message(&value["payload"]);
            sent.text = text.into();
            sent.client_context = Some(context);
            if sent.timestamp == 0.0 {
                sent.timestamp = crate::api::now_ms() as f64;
            }
            json!({"success": true, "message": sent})
        } else if operation.ends_with("_reaction") {
            let item = body["messageId"].as_str().unwrap_or("");
            valid_id(item)?;
            let kind = body["kind"]
                .as_str()
                .filter(|s| {
                    !s.is_empty()
                        && s.len() <= 40
                        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                })
                .ok_or_else(|| Failure::invalid("Invalid reaction"))?;
            let emoji = body["emoji"]
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.chars().count() <= 16)
                .ok_or_else(|| Failure::invalid("Invalid reaction"))?;
            let remove = body["remove"]
                .as_bool()
                .ok_or_else(|| Failure::invalid("Invalid reaction"))?;
            let context = body["clientContext"].as_str();
            if context.is_some_and(|s| s.len() > 256 || s.chars().any(char::is_control)) {
                return Err(Failure::invalid("Invalid original message context"));
            }
            self.mobile("reaction", id, json!({"threadId": thread, "itemId": item, "kind": kind, "emoji": emoji, "remove": remove, "clientContext": context}), Some(&entry.token)).await?;
            json!({"success": true})
        } else if operation.ends_with("_unsend") {
            let item = body["messageId"].as_str().unwrap_or("");
            valid_id(item)?;
            self.mobile(
                "unsend",
                id,
                json!({"threadId": thread, "itemId": item}),
                Some(&entry.token),
            )
            .await?;
            let owner = id.to_owned();
            let token = entry.token.clone();
            let thread_id = thread.to_owned();
            let message_id = item.to_owned();
            match self
                .db(move |db| db.unsend(&owner, &token, &thread_id, &message_id))
                .await
            {
                Ok(owners) => {
                    for owner in owners {
                        self.changed(&owner, Some(thread), Some(item));
                        if owner != id {
                            let profiles = self.profiles.lock().await;
                            if let Some(other) = profiles.get(&owner) {
                                if let Ok(mut other) = other.try_lock() {
                                    other.inbox = None;
                                    other.threads.remove(thread);
                                }
                            }
                        }
                    }
                }
                Err(error) => {
                    ig_service_common::service_error("chat.unsend_cache_failed", &error.message)
                }
            }
            json!({"success": true})
        } else {
            return Err(Failure::missing("Unknown Chat operation"));
        };
        entry.threads.remove(thread);
        entry.inbox = None;
        drop(entry);
        self.refresh(id, thread);
        Ok(Json(response).into_response())
    }
    async fn older(
        &self,
        id: &str,
        thread: &str,
        query: &HashMap<String, String>,
    ) -> Result<Value> {
        let before = query
            .get("before")
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.0)
            .ok_or_else(|| Failure::invalid("Invalid Chat history cursor"))?;
        let before_id = query.get("beforeId");
        let mut cursor = query.get("cursor").cloned().unwrap_or_default();
        if before_id.is_some_and(|s| s.len() > 100) || cursor.len() > 2000 {
            return Err(Failure::invalid("Invalid Chat history cursor"));
        }
        let lock = self.entry(id).await?;
        let mut entry = lock.lock().await;
        self.load(id, &mut entry).await?;
        let mut messages: HashMap<String, model::Message> = HashMap::new();
        let mut seen = std::collections::HashSet::from([cursor.clone()]);
        let mut has_older = true;
        for _ in 0..6 {
            let page_cursor = cursor.clone();
            let data = self
                .mobile(
                    "thread",
                    id,
                    json!({"threadId": thread, "cursor": cursor}),
                    Some(&entry.token),
                )
                .await?;
            if data["thread"].is_null() {
                return Err(Failure::unavailable("Instagram returned no DM thread"));
            }
            let mut thread = model::thread(&data["thread"], false);
            thread
                .messages
                .sort_by(|a, b| b.timestamp.total_cmp(&a.timestamp));
            let boundary =
                before_id.and_then(|id| thread.messages.iter().position(|m| &m.id == id));
            let candidates: Vec<_> = thread
                .messages
                .into_iter()
                .skip(boundary.map_or(0, |i| i + 1))
                .filter(|m| {
                    (boundary.is_some() || m.timestamp < before) && !messages.contains_key(&m.id)
                })
                .collect();
            let remaining = 10 - messages.len();
            let extra = candidates.len() > remaining;
            for message in candidates.into_iter().take(remaining) {
                messages.insert(message.id.clone(), message);
            }
            if extra {
                cursor = page_cursor;
                has_older = true;
                break;
            }
            has_older = data["thread"]["has_older"] == true;
            cursor = if has_older {
                instagram::string(&data["thread"]["oldest_cursor"])
            } else {
                String::new()
            };
            if has_older && (cursor.is_empty() || !seen.insert(cursor.clone())) {
                return Err(Failure::unavailable(
                    "Instagram DM thread cursor repeated or missing",
                ));
            }
            if !has_older || messages.len() >= 10 {
                break;
            }
        }
        let mut messages: Vec<_> = messages.into_values().collect();
        messages.sort_by(|a, b| b.timestamp.total_cmp(&a.timestamp));
        Ok(json!({"messages": messages, "nextCursor": cursor, "hasOlder": has_older}))
    }
}
fn map_instagram(error: instagram::Error) -> Failure {
    let invalid = matches!(
        error.name.as_str(),
        "IgLoginBadPasswordError" | "IgLoginInvalidUserError" | "IgLoginTwoFactorRequiredError"
    ) || error.message == "Connect this profile to Instagram Chat first";
    Failure {
        status: if invalid {
            StatusCode::BAD_REQUEST
        } else if error.status == 429 {
            StatusCode::TOO_MANY_REQUESTS
        } else {
            StatusCode::BAD_GATEWAY
        },
        message: error.message,
    }
}
fn valid_id(id: &str) -> Result<()> {
    if !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(Failure::invalid("Invalid thread ID"))
    }
}
fn context(value: Option<&str>) -> Result<String> {
    match value {
        None => Ok(uuid::Uuid::new_v4().to_string()),
        Some(s) if s.len() == 36 && uuid::Uuid::parse_str(s).is_ok() => Ok(s.into()),
        _ => Err(Failure::invalid("Invalid Chat message ID")),
    }
}
fn credentials(line: &str) -> Result<Value> {
    let invalid = || Failure::invalid("Enter username:password:authenticator key");
    if line.len() > 1200 {
        return Err(invalid());
    }
    let (username, rest) = line.split_once(':').ok_or_else(invalid)?;
    let (password, key) = rest.rsplit_once(':').ok_or_else(invalid)?;
    let username = username.trim();
    let key: String = key
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(char::to_uppercase)
        .collect();
    if username.is_empty()
        || username.len() > 30
        || !username
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_')
        || password.is_empty()
        || password.len() > 1024
        || !(16..=128).contains(&key.len())
        || !key
            .bytes()
            .all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b))
    {
        return Err(invalid());
    }
    Ok(json!({"username": username, "password": password, "authenticatorKey": key}))
}
fn video(query: &HashMap<String, String>) -> Result<Value> {
    let width = query
        .get("width")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let height = query
        .get("height")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let duration = query
        .get("duration")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);
    if !(1..=8192).contains(&width)
        || !(1..=8192).contains(&height)
        || !duration.is_finite()
        || duration <= 0.0
        || duration > 300.0
    {
        return Err(Failure::invalid(
            "Could not read video dimensions or duration",
        ));
    }
    Ok(json!({"width": width, "height": height, "duration": duration}))
}
