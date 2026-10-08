pub mod proxy;
pub mod setup;
#[cfg(test)]
mod tests;

use super::{
    content::Content,
    profiles::{self, Profiles},
    subscriptions::Subscriptions,
    Failure, Result,
};
use crate::{
    api::{self, Api},
    instagram::{Command, Service},
};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use axum::{
    extract::Request,
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use rand::RngCore;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{watch, Mutex, OwnedMutexGuard, Semaphore};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub username: String,
    pub password: String,
    pub authenticator_key: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Encrypted {
    pub username_hash: String,
    pub ciphertext: String,
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(raw: &str) -> Result<Vec<u8>> {
    if raw.len() != 64 || !raw.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Failure::invalid(
            "IG_CREDENTIALS_KEY must be a 32-byte hex key",
        ));
    }
    (0..raw.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&raw[i..i + 2], 16).map_err(|_| Failure::invalid("Invalid hex key"))
        })
        .collect()
}
fn key() -> Result<Vec<u8>> {
    unhex(
        std::env::var("IG_CREDENTIALS_KEY")
            .unwrap_or_default()
            .trim(),
    )
}
fn username_hash(key: &[u8], name: &str) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).unwrap();
    mac.update(b"ig-username-lookup-v1");
    let lookup = mac.finalize().into_bytes();
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&lookup).unwrap();
    mac.update(name.to_lowercase().as_bytes());
    hex(&mac.finalize().into_bytes())
}
fn encrypt(key: &[u8], credentials: &Credentials) -> Result<Encrypted> {
    let hash = username_hash(key, &credentials.username);
    let mut iv = [0; 12];
    rand::rngs::OsRng.fill_bytes(&mut iv);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| Failure::invalid("Invalid credential key"))?;
    let payload = serde_json::to_vec(credentials)?;
    let sealed = cipher
        .encrypt(
            Nonce::from_slice(&iv),
            Payload {
                msg: &payload,
                aad: &unhex(&hash)?,
            },
        )
        .map_err(|_| Failure::unavailable("Credential encryption failed"))?;
    let (encrypted, tag) = sealed.split_at(sealed.len() - 16);
    Ok(Encrypted {
        username_hash: hash,
        ciphertext: format!(
            "v1.{}.{}.{}",
            URL_SAFE_NO_PAD.encode(iv),
            URL_SAFE_NO_PAD.encode(tag),
            URL_SAFE_NO_PAD.encode(encrypted)
        ),
    })
}
fn decrypt(key: &[u8], row: &Encrypted) -> Result<Credentials> {
    let invalid = || Failure::invalid("Invalid encrypted IG credential");
    let parts: Vec<_> = row.ciphertext.split('.').collect();
    if parts.len() != 4
        || parts[0] != "v1"
        || !row
            .username_hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid());
    }
    let iv = URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| invalid())?;
    let tag = URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| invalid())?;
    if iv.len() != 12 || tag.len() != 16 {
        return Err(invalid());
    }
    let mut data = URL_SAFE_NO_PAD.decode(parts[3]).map_err(|_| invalid())?;
    data.extend(tag);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| invalid())?;
    let payload = cipher
        .decrypt(
            Nonce::from_slice(&iv),
            Payload {
                msg: &data,
                aad: &unhex(&row.username_hash).map_err(|_| invalid())?,
            },
        )
        .map_err(|_| invalid())?;
    let value: Credentials = serde_json::from_slice(&payload).map_err(|_| invalid())?;
    if username_hash(key, &value.username) != row.username_hash {
        return Err(invalid());
    }
    Ok(value)
}
pub fn parse_credentials(line: &str) -> Result<Credentials> {
    let invalid = || Failure::invalid("Every line must be username:password:2FA key");
    if line.encode_utf16().count() > 1200 {
        return Err(invalid());
    }
    let (username, rest) = line.split_once(':').ok_or_else(invalid)?;
    let (password, auth) = rest.rsplit_once(':').ok_or_else(invalid)?;
    let auth: String = auth
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(char::to_uppercase)
        .collect();
    let username = username.trim();
    if !valid_username(username)
        || password.is_empty()
        || password.encode_utf16().count() > 1024
        || !(16..=128).contains(&auth.len())
        || !auth
            .bytes()
            .all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b))
    {
        return Err(invalid());
    }
    Ok(Credentials {
        username: username.into(),
        password: password.into(),
        authenticator_key: auth,
    })
}
pub fn valid_username(name: &str) -> bool {
    (1..=30).contains(&name.len())
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_')
}
pub struct Accounts {
    pub api: Arc<Api>,
    pub profiles: Arc<Profiles>,
    pub mobile: Arc<Service>,
    pub content: Arc<Content>,
    pub proxies: Arc<proxy::Proxies>,
    subscriptions: Arc<Subscriptions>,
    actions: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    slots: Arc<Semaphore>,
    stop: watch::Sender<bool>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    jobs: Mutex<tokio::task::JoinSet<()>>,
    #[cfg(test)]
    credential_key: Option<Vec<u8>>,
}
impl Accounts {
    pub async fn public(
        self: &Arc<Self>,
        operation: &str,
        params: &HashMap<String, String>,
        request: Request,
    ) -> Result<Response> {
        let query = super::query(request.uri().query().unwrap_or(""));
        let value = match operation {
            "ig-accounts.get.list" => self.list().await?,
            "ig-accounts.get.page" => {
                self.page(
                    query.get("search").map(String::as_str).unwrap_or(""),
                    query.get("cursor").map(String::as_str),
                    query.get("profileId").map(String::as_str),
                )
                .await?
            }
            "ig-accounts.get.available-count" => self.store("availableCount", json!({})).await?,
            "ig-accounts.get.blacklist" => self.proxies.blacklist().await?,
            "ig-accounts.get.warmup" => self.store("modelSetupList", json!({})).await?,
            "ig-accounts.get.credentials_id" => {
                let account = self.account("byId", json!({"id":params.get("id")})).await?;
                if account.is_null() {
                    return Err(Failure::missing("Credential not found"));
                }
                account
            }
            "ig-accounts.post.import" => {
                let body = super::body(request).await?;
                let raw = body["text"]
                    .as_str()
                    .ok_or_else(|| Failure::invalid("Choose a TXT file"))?;
                self.import(raw).await?
            }
            "ig-accounts.post.warmup_profileId_reconcile" => {
                let body = super::body(request).await?;
                self.reconcile_setup(
                    params.get("profileId").map(String::as_str).unwrap_or(""),
                    profiles::text(&body, "resolution"),
                )
                .await?;
                json!({"ok":true})
            }
            "ig-accounts.post.create-batch" => {
                let body = super::body(request).await?;
                let count = body["count"]
                    .as_u64()
                    .filter(|n| (1..=100).contains(n))
                    .ok_or_else(|| Failure::invalid("Choose 1–100 profiles"))?
                    as usize;
                let model = profiles::text(&body, "modelId");
                let models = self.api.convex(Method::GET, "/api/lists", None).await?;
                if !models
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|m| m["id"] == model)
                {
                    return Err(Failure::invalid("Choose a model"));
                }
                let accounts = self.available(count).await?;
                if accounts.len() < count {
                    return Err(Failure::invalid(format!(
                        "Only {} unused credentials are available",
                        accounts.len()
                    )));
                }
                let created=self.api.convex(Method::POST,"/api/profiles/create-for-model",Some(&json!({"modelId":model,"accounts":accounts.iter().map(|a|json!({"id":a["id"],"username":a["username"]})).collect::<Vec<_>>()}))).await?;
                for row in created.as_array().into_iter().flatten() {
                    self.queue(profiles::text(row, "profileId").into()).await;
                }
                json!({"count":created.as_array().map_or(0,Vec::len),"created":created})
            }
            "ig-accounts.post.profileId_connect" => {
                let body = super::body(request).await?;
                let profile_id = params.get("profileId").map(String::as_str).unwrap_or("");
                let profile = self.profiles.by_id(profile_id).await?;
                if profile.is_null() || profile["status"] == "deleting" {
                    return Err(Failure::invalid("Choose a logged-in profile"));
                }
                let mut account = if let Some(id) = body["credentialId"].as_str() {
                    self.account("byId", json!({"id":id})).await?
                } else {
                    Value::Null
                };
                if account.is_null() {
                    if let Some(raw) = body["credentials"].as_str() {
                        if profile["igLoggedIn"] != true {
                            return Err(Failure::invalid("Choose a logged-in profile"));
                        }
                        let parsed = parse_credentials(raw)?;
                        self.import(raw).await?;
                        account = self
                            .account(
                                "byUsernameHash",
                                json!({"usernameHash":username_hash(&self.credential_key()?,&parsed.username)}),
                            )
                            .await?;
                    }
                }
                if account.is_null()
                    || account["profileId"]
                        .as_str()
                        .is_some_and(|p| p != profile_id)
                {
                    return Err(Failure::invalid("Choose an available credential"));
                }
                if account["status"] == "connected" && account["profileId"] == profile_id {
                    if let Some(retry) = self.reconnect(profiles::text(&account, "id")).await? {
                        let mut response = api::error(
                            axum::http::StatusCode::TOO_MANY_REQUESTS,
                            "RATE_LIMITED",
                            "Instagram is limiting requests. Wait before trying again.",
                        );
                        response.headers_mut().insert(
                            "Retry-After",
                            axum::http::HeaderValue::from_str(&retry.div_ceil(1000).to_string())
                                .unwrap(),
                        );
                        return Ok(response);
                    }
                    json!({"ok":true})
                } else {
                    if profile["igLoggedIn"] != true {
                        return Err(Failure::invalid("Choose a logged-in profile"));
                    }
                    self.store("assign", json!({"id":account["id"],"profileId":profile_id}))
                        .await?;
                    self.queue(profile_id.into()).await;
                    return Ok((
                        axum::http::StatusCode::ACCEPTED,
                        Json(json!({"queued":true,"username":account["username"]})),
                    )
                        .into_response());
                }
            }
            _ => return Err(Failure::missing("Unknown account operation")),
        };
        Ok(Json(value).into_response())
    }
    pub fn new(
        api: Arc<Api>,
        profiles: Arc<Profiles>,
        mobile: Arc<Service>,
        content: Arc<Content>,
        subscriptions: Arc<Subscriptions>,
    ) -> Arc<Self> {
        let (stop, _) = watch::channel(false);
        Arc::new(Self {
            proxies: proxy::Proxies::new(profiles.root.clone()),
            api,
            profiles,
            mobile,
            content,
            subscriptions,
            actions: Default::default(),
            slots: Arc::new(Semaphore::new(4)),
            stop,
            tasks: Default::default(),
            jobs: Default::default(),
            #[cfg(test)]
            credential_key: None,
        })
    }
    fn credential_key(&self) -> Result<Vec<u8>> {
        #[cfg(test)]
        if let Some(key) = &self.credential_key {
            return Ok(key.clone());
        }
        key()
    }
    pub async fn store(&self, operation: &str, mut body: Value) -> Result<Value> {
        // JSON null does not satisfy Convex's optional string/id validators.
        body.as_object_mut()
            .ok_or_else(|| Failure::invalid("Invalid account request"))?
            .retain(|key, value| !value.is_null() || (operation == "page" && key == "cursor"));
        body["operation"] = json!(operation);
        Ok(self
            .api
            .convex(Method::POST, "/api/ig-accounts-store", Some(&body))
            .await?)
    }
    pub async fn account(&self, operation: &str, body: Value) -> Result<Value> {
        let row = self.store(operation, body).await?;
        if row.is_null() {
            return Ok(Value::Null);
        }
        account_row(&row, &self.credential_key()?)
    }
    pub async fn account_for_profile(&self, id: &str) -> Result<Value> {
        self.account("byProfile", json!({"profileId":id})).await
    }
    pub async fn import(&self, raw: &str) -> Result<Value> {
        let lines: Vec<_> = raw
            .lines()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if lines.len() > 1000 {
            return Err(Failure::invalid("Import at most 1000 accounts at a time"));
        }
        let credentials: Vec<_> = lines
            .iter()
            .map(|s| parse_credentials(s))
            .collect::<Result<_>>()?;
        let key = self.credential_key()?;
        let mut imported = 0;
        for chunk in credentials.chunks(100) {
            let rows: Vec<_> = chunk
                .iter()
                .map(|c| encrypt(&key, c))
                .collect::<Result<_>>()?;
            imported += self.store("import", json!({"rows":rows})).await?["imported"]
                .as_u64()
                .unwrap_or(0);
        }
        Ok(json!({"imported":imported,"skipped":lines.len() as u64-imported}))
    }
    pub async fn list(&self) -> Result<Value> {
        let rows = self.store("list", json!({})).await?;
        let key = self.credential_key()?;
        Ok(json!(rows
            .as_array()
            .into_iter()
            .flatten()
            .map(|row| public_row(row, &key))
            .collect::<Vec<_>>()))
    }
    pub async fn page(
        &self,
        search: &str,
        cursor: Option<&str>,
        profile: Option<&str>,
    ) -> Result<Value> {
        if search.len() > 200 {
            return Err(Failure::invalid("Invalid page parameters"));
        }
        let key = self.credential_key()?;
        let term = search.trim().to_lowercase();
        let mut cursor = cursor.map(str::to_owned);
        let mut rows = Vec::new();
        for batch in 0..5 {
            let result = self
                .store(
                    "page",
                    json!({"cursor":cursor,"count":50-rows.len(),"profileId":profile}),
                )
                .await?;
            rows.extend(
                result["page"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|r| public_row(r, &key))
                    .filter(|r| profiles::text(r, "username").to_lowercase().contains(&term)),
            );
            if result["isDone"] == true || rows.len() >= 50 || batch == 4 {
                return Ok(
                    json!({"page":rows,"continueCursor":result["continueCursor"],"isDone":result["isDone"]}),
                );
            }
            let next = result["continueCursor"].as_str().unwrap_or("").to_owned();
            if cursor.as_deref() == Some(&next) {
                return Err(Failure::unavailable("Pagination cursor did not advance"));
            }
            cursor = Some(next);
        }
        unreachable!()
    }
    pub async fn available(&self, count: usize) -> Result<Vec<Value>> {
        let key = self.credential_key()?;
        let mut rows = Vec::new();
        let mut cursor: Option<String> = None;
        while rows.len() < count {
            let page = self
                .store(
                    "available",
                    json!({"count":20.max(count-rows.len()),"cursor":cursor}),
                )
                .await?;
            rows.extend(
                page["page"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|r| account_row(r, &key).ok())
                    .take(count - rows.len()),
            );
            if page["isDone"] == true {
                break;
            }
            let next = profiles::text(&page, "continueCursor").to_owned();
            if cursor.as_deref() == Some(&next) {
                return Err(Failure::unavailable("Pagination cursor did not advance"));
            }
            cursor = Some(next);
        }
        Ok(rows)
    }
    pub async fn set_username(&self, id: &str, username: &str) -> Result<()> {
        if !valid_username(username) {
            return Err(Failure::invalid("Invalid IG username"));
        }
        let account = self.account("byId", json!({"id":id})).await?;
        if account.is_null() {
            return Err(Failure::missing("Credential not found"));
        }
        if profiles::text(&account, "username").eq_ignore_ascii_case(username) {
            return Ok(());
        }
        let encrypted = encrypt(
            &self.credential_key()?,
            &Credentials {
                username: username.into(),
                password: profiles::text(&account, "password").into(),
                authenticator_key: profiles::text(&account, "authenticatorKey").into(),
            },
        )?;
        let mut body = serde_json::to_value(encrypted)?;
        body["id"] = json!(id);
        self.store("setUsername", body).await?;
        Ok(())
    }
    pub async fn action_lock(&self, profile: &str) -> Result<OwnedMutexGuard<()>> {
        let mut actions = self.actions.lock().await;
        actions.retain(|_, v| Arc::strong_count(v) > 1);
        if actions.len() >= 1000 && !actions.contains_key(profile) {
            return Err(Failure::unavailable("Too many account operations"));
        }
        actions
            .entry(profile.into())
            .or_default()
            .clone()
            .try_lock_owned()
            .map_err(|_| profiles::conflict("Wait for the current Instagram request to finish"))
    }
    pub async fn sync_name(
        &self,
        profile_id: &str,
        account_id: &str,
        username: &str,
    ) -> Result<()> {
        let result = async {
            let profile = self.profiles.by_id(profile_id).await?;
            if profile.is_null() {
                return Err(Failure::missing("Profile not found"));
            }
            if profile["renameFrom"].is_string() {
                return Err(profiles::conflict("Profile rename is still in progress"));
            }
            if profile["name"] != username {
                self.profiles
                    .update(profiles::text(&profile, "name"), json!({"name":username}))
                    .await?;
            }
            Ok(())
        }
        .await;
        let mut body = json!({"id":account_id,"status":"connected"});
        if let Err(error) = result {
            body["error"] = json!(format!("Profile name sync failed: {}", error.message));
        }
        self.store("setState", body).await?;
        Ok(())
    }
    pub async fn mobile_login(&self, profile: &str, account: &Value) -> Result<()> {
        self.mobile
            .invoke(
                "login",
                &Command {
                    profile_id: profile.into(),
                    token: None,
                    args: account.clone(),
                },
            )
            .await
            .map_err(|e| Failure {
                status: axum::http::StatusCode::from_u16(e.status)
                    .unwrap_or(axum::http::StatusCode::BAD_GATEWAY),
                message: e.message,
            })?;
        self.sync_name(
            profile,
            profiles::text(account, "id"),
            profiles::text(account, "username"),
        )
        .await
    }
    pub async fn reconnect(&self, id: &str) -> Result<Option<u64>> {
        let account = self.account("byId", json!({"id":id})).await?;
        let profile = profiles::text(&account, "profileId");
        if profile.is_empty() || account["status"] != "connected" {
            return Err(Failure::invalid("Account is not connected to a profile"));
        }
        let _guard = self.action_lock(profile).await?;
        let _slot = self
            .slots
            .acquire()
            .await
            .map_err(|_| Failure::unavailable("Account service stopped"))?;
        let row = self.profiles.by_id(profile).await?;
        if row.is_null() || row["status"] == "deleting" {
            return Err(Failure::invalid("Profile is unavailable"));
        }
        if profiles::text(&row, "proxy").is_empty() {
            return Err(Failure::invalid("Profile has no Work proxy"));
        }
        match self
            .mobile
            .invoke(
                "login",
                &Command {
                    profile_id: profile.into(),
                    token: None,
                    args: account.clone(),
                },
            )
            .await
        {
            Ok(_) => {
                self.sync_name(
                    profile,
                    profiles::text(&account, "id"),
                    profiles::text(&account, "username"),
                )
                .await?;
                Ok(None)
            }
            Err(e) if e.status == 429 => Ok(Some(e.retry_after_ms)),
            Err(e) => Err(Failure::invalid(e.message)),
        }
    }
    pub async fn queue(self: &Arc<Self>, profile: String) {
        let state = self.clone();
        self.launch(async move {
            let Ok(_guard) = state.action_lock(&profile).await else {
                return;
            };
            let Ok(_slot) = state.slots.clone().acquire_owned().await else {
                return;
            };
            if *state.stop.borrow() {
                return;
            }
            let _ = state.login(&profile, false).await;
        })
        .await;
    }
    async fn launch(&self, work: impl std::future::Future<Output = ()> + Send + 'static) {
        let mut jobs = self.jobs.lock().await;
        while jobs.try_join_next().is_some() {}
        if *self.stop.borrow() || jobs.len() >= 1000 {
            return;
        }
        jobs.spawn(work);
    }
    pub async fn login(&self, id: &str, mobile: bool) -> Result<()> {
        let started = Instant::now();
        let mut context = json!({"profileId": id, "connectMobile": mobile, "outcome": "skipped"});
        let result = self.login_inner(id, mobile, &mut context).await;
        completion("accounts.login", context, started, result.as_ref().err());
        result
    }
    async fn login_inner(&self, id: &str, mobile: bool, context: &mut Value) -> Result<()> {
        let account = self.account_for_profile(id).await?;
        let profile = self.profiles.by_id(id).await?;
        if account.is_null()
            || account["status"] != "assigned"
            || profile.is_null()
            || profile["status"] == "deleting"
            || profile["renameFrom"].is_string()
            || (!mobile && !account["browserLoggedInAt"].is_null())
            || (mobile && profile["using"] == true)
        {
            return Ok(());
        }
        context["accountId"] = account["id"].clone();
        context["outcome"] = json!("success");
        let result = async {
            if profile["igLoggedIn"]==true { return self.mobile_login(id,&account).await; }
            let country = self.proxies.exit(profiles::text(&profile,"proxy"),true).await?["country"].as_str().unwrap_or("").to_owned();
            context["country"] = json!(country);
            let blocked = self.proxies.blacklist().await?;
            let proxies = self.store("loginProxies",json!({})).await?;
            let mut rejected = 0;
            let mut seen = std::collections::HashSet::new();
            for proxy in proxies.as_array().into_iter().flatten() {
                if proxy["country"]!=country || proxy["loginCooldownUntil"].as_u64().unwrap_or(0)>api::now_ms() { continue; }
                let Ok(exit) = self.proxies.exit(profiles::text(proxy,"proxy"),false).await else { continue; };
                let ip = profiles::text(&exit,"ip").to_owned();
                if exit["country"]!=country || blocked.as_array().into_iter().flatten().any(|v| v["ip"]==ip) || !seen.insert(ip.clone()) { continue; }
                let Some(exit_guard) = self.proxies.claim_exit(&ip).await else { continue; };
                let token = uuid::Uuid::new_v4().to_string(); let proxy_id = profiles::text(proxy,"_id"); let account_id = profiles::text(&account,"id");
                context["loginProxyId"] = json!(proxy_id);
                if self.store("claimLoginProxy",json!({"id":account_id,"loginProxyId":proxy_id,"token":token})).await?!=true { continue; }
                let mut browser_finished = false;
                let attempt = async {
                    let response = self.api.client.post(format!("{}/commands/browser.login",self.api.worker_url)).bearer_auth(&self.api.key).json(&json!({"attemptId":token,"profileName":profile["name"],"proxy":proxy["proxy"],"account":account})).timeout(Duration::from_secs(300)).send().await.map_err(|_| Failure::unavailable("Browser login worker unavailable"))?;
                    if !response.status().is_success() { return Err(Failure::unavailable("Browser login worker failed")); }
                    let value = api::bounded_json(response,4096).await?;
                    if value["rejected"]==true {
                        browser_finished = true;
                        rejected += 1;
                        context["rejectedAttempts"] = json!(rejected);
                        self.proxies.block(json!({"ip":ip,"country":country,"proxyName":proxy["name"],"reason":"Instagram rejected login","createdAt":api::now_ms()})).await?;
                        return Ok(false);
                    }
                    if value["ok"]!=true { return Err(Failure::unavailable("Browser login did not confirm a session")); }
                    browser_finished = true;
                    use rand::Rng;
                    let cooldown = rand::thread_rng().gen_range(3*86_400_000_u64..=5*86_400_000);
                    let result = self.store("recordBrowserLogin",json!({"id":account_id,"browserLoggedInAt":api::now_ms(),"loginProxyId":proxy_id,"claimToken":token,"cooldownMs":cooldown})).await?;
                    if result["cooldownRecorded"]!=true { ig_service_common::service_error("accounts.proxy_claim_expired","Browser login succeeded after proxy claim expired"); }
                    Ok(true)
                }.await;
                if !browser_finished && self.cancel_browser_login(&token).await.is_err() {
                    self.proxies.quarantine(exit_guard).await;
                    ig_service_common::service_error("accounts.login_cancel_unconfirmed","Browser cleanup unconfirmed; proxy IP quarantined until runtime restart and claim will expire");
                } else if self.store("releaseLoginProxy",json!({"id":account_id,"loginProxyId":proxy_id,"token":token})).await.is_err() { ig_service_common::service_error("accounts.proxy_release_failed","Proxy claim will expire"); }
                if attempt? { return Ok(()); }
                if rejected>=2 { context["outcome"]=json!("rejected"); self.store("setState",json!({"id":account_id,"status":"invalid","error":"Instagram rejected login on two different proxy IPs"})).await?; return Ok(()); }
            }
            Err(Failure::unavailable("No working Login proxy found in the required country"))
        }.await;
        if let Err(error) = result {
            context["outcome"] = json!("paused");
            context["reason"] = json!(error.message);
            self.store("setState",json!({"id":account["id"],"status":"assigned","error":error.message,"retryAfter":api::now_ms()+3_600_000})).await?;
        }
        Ok(())
    }
    async fn cancel_browser_login(&self, token: &str) -> Result<()> {
        let response = self
            .api
            .client
            .post(format!(
                "{}/commands/browser.cancel-login",
                self.api.worker_url
            ))
            .bearer_auth(&self.api.key)
            .json(&json!({"attemptId":token}))
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|_| Failure::unavailable("Browser login cancellation unavailable"))?;
        if !response.status().is_success()
            || api::bounded_json(response, 4096).await?["cancelled"] != true
        {
            return Err(Failure::unavailable("Browser login cleanup unconfirmed"));
        }
        Ok(())
    }
    pub async fn start(self: &Arc<Self>) {
        let mut tasks = self.tasks.lock().await;
        if !tasks.is_empty() || *self.stop.borrow() {
            return;
        }
        for kind in ["login", "maintenance", "setup", "model"] {
            let state = self.clone();
            let mut stop = self.stop.subscribe();
            tasks.push(tokio::spawn(async move {
                loop {
                    let work = async { match kind { "login" => state.watch_login().await, "maintenance" => state.watch_maintenance().await, "model" => state.watch_model().await, _ => state.periodic_setup().await } };
                    tokio::select! { _ = stop.changed() => break, result = work => if let Err(e)=result { ig_service_common::service_error("accounts.coordination_failed", &e.message); } }
                    tokio::select! { _ = stop.changed() => break, _ = tokio::time::sleep(Duration::from_secs(3)) => {} }
                }
            }));
        }
    }
    pub async fn shutdown(&self) {
        self.stop.send_replace(true);
        for task in self.tasks.lock().await.drain(..) {
            let _ = task.await;
        }
        // Logins run inside the main Bun process, outside the supervised worker tree.
        // Drain them before aborting jobs or allowing the controller to stop Bun.
        let has_jobs = !self.jobs.lock().await.is_empty();
        if has_jobs && self.stop_browser_logins().await.is_err() {
            ig_service_common::service_error(
                "accounts.browser_shutdown_failed",
                "Browser login shutdown was not acknowledged",
            );
        }
        // Stop issuing work and give in-flight actions time to persist their result.
        let mut jobs = self.jobs.lock().await;
        if tokio::time::timeout(Duration::from_secs(30), async {
            while jobs.join_next().await.is_some() {}
        })
        .await
        .is_err()
        {
            jobs.shutdown().await;
        }
    }
    async fn stop_browser_logins(&self) -> Result<()> {
        let response = self
            .api
            .client
            .post(format!("{}/commands/browser.shutdown", self.api.worker_url))
            .bearer_auth(&self.api.key)
            .json(&json!({}))
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|_| Failure::unavailable("Browser login shutdown unavailable"))?;
        if !response.status().is_success()
            || api::bounded_json(response, 4096).await?["stopped"] != true
        {
            return Err(Failure::unavailable("Browser login cleanup unconfirmed"));
        }
        Ok(())
    }
    async fn watch_model(self: &Arc<Self>) -> Result<()> {
        let mut events = self.profiles.processes.setup.subscribe();
        loop {
            match events.recv().await {
                Ok((profile, automation)) => {
                    let state = self.clone();
                    self.launch(async move {
                        if let Err(error) = state.advance_setup(&profile, &automation).await {
                            ig_service_common::service_error("model.setup_failed", &error.message);
                        }
                    })
                    .await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    ig_service_common::service_error(
                        "model.setup_lagged",
                        "Model setup will resume after the next session",
                    )
                }
                Err(_) => return Err(Failure::unavailable("Model setup channel ended")),
            }
        }
    }
    async fn watch_login(self: &Arc<Self>) -> Result<()> {
        use futures_util::StreamExt;
        let mut subscription = self
            .subscriptions
            .subscribe("igAccounts:loginWork", json!({}))
            .await?;
        let mut rows = Value::Null;
        loop {
            let now = api::now_ms();
            let at = rows
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| r["retryAfter"].as_u64())
                .min()
                .unwrap_or(now + 900_000)
                .max(now + 1000);
            tokio::select! {
                update=subscription.next() => { let Some(update)=update else { return Err(Failure::unavailable("Login subscription ended")); }; rows=super::subscriptions::value(update).unwrap_or(Value::Null); },
                _=tokio::time::sleep(Duration::from_millis(at-now)) => {}
            }
            for row in rows.as_array().into_iter().flatten() {
                if row["retryAfter"].as_u64().unwrap_or(0) <= api::now_ms() {
                    self.queue(profiles::text(row, "profileId").into()).await;
                }
            }
        }
    }
    async fn watch_maintenance(&self) -> Result<()> {
        use futures_util::StreamExt;
        let mut subscription = self
            .subscriptions
            .subscribe("profiles/queries:maintenanceWork", json!({}))
            .await?;
        let mut pending = false;
        let mut timer = tokio::time::interval(Duration::from_secs(5));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! { update=subscription.next() => { let Some(update)=update else { return Err(Failure::unavailable("Maintenance subscription ended")); }; pending=super::subscriptions::value(update).ok().and_then(|v|v.as_array().map(|v|!v.is_empty())).unwrap_or(false); }, _=timer.tick()=>{} }
            if pending {
                self.profiles.retry().await?;
            }
        }
    }
    async fn periodic_setup(&self) -> Result<()> {
        let mut timer = tokio::time::interval(Duration::from_secs(900));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            self.sync_names().await?;
            self.sweep_setup().await?;
        }
    }
    async fn sync_names(&self) -> Result<()> {
        let key = self.credential_key()?;
        let mut cursor: Option<String> = None;
        loop {
            let page = self
                .store("connectedNames", json!({"cursor":cursor}))
                .await?;
            for row in page["page"].as_array().into_iter().flatten() {
                let Ok(account) = account_row(&row["account"], &key) else {
                    continue;
                };
                let profile = profiles::text(&account, "profileId");
                if profile.is_empty()
                    || row["renameFrom"].is_string()
                    || row["profileStatus"] == "deleting"
                    || (row["profileName"] == account["username"]
                        && !profiles::text(&account, "error")
                            .starts_with("Profile name sync failed: "))
                {
                    continue;
                }
                if let Ok(_guard) = self.action_lock(profile).await {
                    self.sync_name(
                        profile,
                        profiles::text(&account, "id"),
                        profiles::text(&account, "username"),
                    )
                    .await?;
                }
            }
            if page["isDone"] == true {
                return Ok(());
            }
            let next = profiles::text(&page, "continueCursor").to_owned();
            if cursor.as_deref() == Some(&next) {
                return Err(Failure::unavailable("Pagination cursor did not advance"));
            }
            cursor = Some(next);
        }
    }
}
fn account_row(row: &Value, key: &[u8]) -> Result<Value> {
    let encrypted: Encrypted = serde_json::from_value(row.clone())?;
    let mut value = serde_json::to_value(decrypt(key, &encrypted)?)?;
    value["id"] = row["_id"].clone();
    for field in [
        "status",
        "profileId",
        "error",
        "createdAt",
        "retryAfter",
        "browserLoggedInAt",
        "reconnectRequired",
    ] {
        if !row[field].is_null() {
            value[field] = row[field].clone();
        }
    }
    Ok(value)
}
fn public_row(row: &Value, key: &[u8]) -> Value {
    match account_row(row, key) {
        Ok(mut value) => {
            for field in ["password", "authenticatorKey", "retryAfter"] {
                value.as_object_mut().unwrap().remove(field);
            }
            value
        }
        Err(_) => {
            let mut value = json!({"id":row["_id"],"username":"","status":"invalid","error":"Credential cannot be decrypted","createdAt":row["createdAt"]});
            if !row["profileId"].is_null() {
                value["profileId"] = row["profileId"].clone();
            }
            value
        }
    }
}

fn completion(event: &str, context: Value, started: Instant, error: Option<&Failure>) {
    println!(
        "{}",
        json!({
            "id": uuid::Uuid::new_v4().to_string(), "ts": api::now_ms(),
            "requestId": uuid::Uuid::new_v4().to_string(), "event": event, "source": "runtime",
            "level": if error.is_some() { "error" } else { "info" },
            "outcome": if error.is_some() { "error" } else { context["outcome"].as_str().unwrap_or("success") },
            "durationMs": started.elapsed().as_millis() as u64, "context": context,
            "error": error.map(|e| json!({"type":"AccountError","message":e.message})),
            "environment": {"service":"runtime","runtime":"rust","commitHash":api::env("COMMIT_SHA","unknown"),
                "version":api::env("SERVICE_VERSION","1.0.0"),"region":api::env("REGION","unknown"),"instanceId":api::env("INSTANCE_ID","runtime")}
        })
    );
}
