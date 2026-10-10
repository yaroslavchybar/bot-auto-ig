use super::{profiles, Accounts, Failure, Result};
use crate::{api, instagram::Command};
use axum::{
    extract::{
        ws::{Message, WebSocketUpgrade},
        State,
    },
    response::Response,
};
use chrono::{TimeZone, Utc};
use reqwest::Method;
use serde_json::{json, Value};
use std::{collections::HashSet, sync::Arc, time::Duration};

pub fn date(timestamp: u64) -> String {
    Utc.timestamp_millis_opt(timestamp as i64)
        .single()
        .unwrap_or_default()
        .with_timezone(&chrono_tz::Europe::Kyiv)
        .format("%Y-%m-%d")
        .to_string()
}
pub fn day(start: u64, now: u64) -> i64 {
    let parse = |ts| chrono::NaiveDate::parse_from_str(&date(ts), "%Y-%m-%d").unwrap();
    (parse(now) - parse(start)).num_days() + 1
}
impl Accounts {
    pub async fn patch_setup(&self, id: &str, patch: Value, clear: &[&str]) -> Result<()> {
        self.store(
            "modelSetupPatch",
            json!({"profileId":id,"patch":patch,"clear":clear}),
        )
        .await?;
        Ok(())
    }
    async fn setup_state(&self, id: &str) -> Result<Value> {
        Ok(self
            .store("modelSetupList", json!({}))
            .await?
            .as_array()
            .into_iter()
            .flatten()
            .find(|s| s["profileId"] == id)
            .cloned()
            .unwrap_or(Value::Null))
    }
    pub async fn reconcile_setup(&self, id: &str, resolution: &str) -> Result<()> {
        if !["completed", "failed"].contains(&resolution) {
            return Err(Failure::invalid("Choose completed or failed"));
        }
        let _guard = self.action_lock(id).await?;
        let state = self.setup_state(id).await?;
        if state["pending"].is_null() {
            return Err(Failure::invalid("No model setup action needs review"));
        }
        if resolution == "completed"
            && ["username", "name"].contains(&profiles::text(&state["pending"], "kind"))
        {
            let username = profiles::text(&state, "targetUsername");
            if username.is_empty() {
                return Err(Failure::invalid("The target username is missing"));
            }
            let account = self.account_for_profile(id).await?;
            if account.is_null() {
                return Err(Failure::missing("The IG account is missing"));
            }
            self.set_username(profiles::text(&account, "id"), username)
                .await?;
            self.store(
                "modelSetupReconcile",
                json!({"profileId":id,"resolution":resolution}),
            )
            .await?;
            self.sync_name(id, profiles::text(&account, "id"), username)
                .await?;
        } else {
            self.store(
                "modelSetupReconcile",
                json!({"profileId":id,"resolution":resolution}),
            )
            .await?;
        }
        Ok(())
    }
    pub async fn sweep_setup(&self) -> Result<()> {
        let automations = self
            .api
            .convex(Method::GET, "/api/automations", None)
            .await?;
        let owners: HashSet<_> = automations
            .as_array()
            .into_iter()
            .flatten()
            .filter(|a| {
                a["isActive"] == true
                    && a["routine"].is_object()
                    && a["listIds"].as_array().is_some_and(|v| v.len() == 1)
            })
            .filter_map(|a| a["listIds"][0].as_str())
            .collect();
        if owners.is_empty() {
            return Ok(());
        }
        let profiles = self.profiles.list().await?;
        let existing = self.store("modelSetupList", json!({})).await?;
        for profile in profiles.as_array().into_iter().flatten() {
            if profile["igLoggedIn"] != true || profile["status"] == "deleting" {
                continue;
            }
            let Some(model) = profile["listIds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .find(|id| owners.contains(id))
            else {
                continue;
            };
            let id = profiles::text(profile, "id");
            if existing
                .as_array()
                .into_iter()
                .flatten()
                .any(|s| s["profileId"] == id && s["modelId"] == model)
            {
                continue;
            }
            let account = match self.account_for_profile(id).await {
                Ok(account) => account,
                Err(error) => {
                    ig_service_common::service_error("model.enrollment_failed", &error.message);
                    continue;
                }
            };
            if account["browserLoggedInAt"].is_number() || account["status"] == "connected" {
                self.store("modelSetupEnroll",json!({"profileId":id,"modelId":model,"startedAt":api::timestamp_ms(&account["browserLoggedInAt"]).unwrap_or(api::now_ms())})).await?;
            }
        }
        Ok(())
    }
    pub async fn advance_setup(&self, id: &str, automation_id: &str) -> Result<()> {
        let Ok(_guard) = self.action_lock(id).await else {
            return Ok(());
        };
        let _slot = self
            .slots
            .acquire()
            .await
            .map_err(|_| Failure::unavailable("Account service stopped"))?;
        let result = self.advance_setup_locked(id, automation_id).await;
        if let Err(error) = &result {
            let _ = self
                .patch_setup(id, json!({"error":error.message}), &[])
                .await;
        }
        result
    }
    async fn advance_setup_locked(&self, id: &str, automation_id: &str) -> Result<()> {
        let url =
            reqwest::Url::parse_with_params("http://local/", [("automationId", automation_id)])
                .unwrap();
        let automation = self
            .api
            .convex(
                Method::GET,
                &format!("/api/automations/by-id?{}", url.query().unwrap()),
                None,
            )
            .await?;
        let Some(model_id) = automation["listIds"]
            .as_array()
            .filter(|a| a.len() == 1)
            .and_then(|a| a[0].as_str())
        else {
            return Ok(());
        };
        if automation["isActive"] != true || !automation["routine"].is_object() {
            return Ok(());
        }
        let profiles = self.profiles.list().await?;
        let Some(profile) = profiles
            .as_array()
            .into_iter()
            .flatten()
            .find(|p| p["id"] == id)
        else {
            return Ok(());
        };
        if !profile["listIds"]
            .as_array()
            .is_some_and(|v| v.iter().any(|v| v == model_id))
            || profile["igLoggedIn"] != true
            || profiles::text(profile, "proxy").is_empty()
            || profile["using"] == true
            || profile["status"] == "deleting"
            || profile["renameFrom"].is_string()
        {
            return Ok(());
        }
        let models = self.api.convex(Method::GET, "/api/lists", None).await?;
        let Some(model) = models
            .as_array()
            .into_iter()
            .flatten()
            .find(|m| m["id"] == model_id)
        else {
            return Ok(());
        };
        let account = self.account_for_profile(id).await?;
        if account.is_null()
            || (account["browserLoggedInAt"].is_null() && account["status"] != "connected")
        {
            return Ok(());
        }
        let mut snapshot = self.store("modelSetupList", json!({})).await?;
        if !snapshot
            .as_array()
            .into_iter()
            .flatten()
            .any(|s| s["profileId"] == id && s["modelId"] == model_id)
        {
            self.store("modelSetupEnroll",json!({"profileId":id,"modelId":model_id,"startedAt":api::timestamp_ms(&account["browserLoggedInAt"]).unwrap_or(api::now_ms())})).await?;
            snapshot = self.store("modelSetupList", json!({})).await?;
        }
        let Some(state) = snapshot
            .as_array()
            .into_iter()
            .flatten()
            .find(|s| s["profileId"] == id && s["modelId"] == model_id)
        else {
            return Ok(());
        };
        if !state["pending"].is_null() {
            return Ok(());
        }
        let today = day(
            api::timestamp_ms(&state["startedAt"]).unwrap_or(api::now_ms()),
            api::now_ms(),
        );
        if today < 3 {
            return Ok(());
        }
        if account["status"] != "connected" {
            if account["browserLoggedInAt"].is_null()
                || api::timestamp_ms(&account["retryAfter"]).unwrap_or(0) > api::now_ms()
            {
                return Ok(());
            }
            self.login(id, true).await?;
            if self.account_for_profile(id).await?["status"] != "connected" {
                return Ok(());
            }
        }
        if self
            .api
            .convex(
                Method::POST,
                "/api/routines/ready",
                Some(&json!({"automationId":automation_id,"profileId":id,"checkpoint":true})),
            )
            .await?
            != true
        {
            return Ok(());
        }
        let enrolled: HashSet<_> = snapshot
            .as_array()
            .into_iter()
            .flatten()
            .filter(|s| s["modelId"] == model_id)
            .filter_map(|s| s["profileId"].as_str())
            .collect();
        let mut members: Vec<_> = profiles
            .as_array()
            .into_iter()
            .flatten()
            .filter(|p| {
                enrolled.contains(profiles::text(p, "id"))
                    && p["listIds"]
                        .as_array()
                        .is_some_and(|v| v.iter().any(|v| v == model_id))
            })
            .collect();
        members.sort_by_key(|p| api::timestamp_ms(&p["createdAt"]).unwrap_or(0));
        let Some(index) = members.iter().position(|p| p["id"] == id) else {
            return Ok(());
        };
        if state["nameDone"] != true {
            let mut used: HashSet<String> = profiles
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| profiles::text(p, "name").to_lowercase())
                .chain(
                    snapshot
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|s| s["targetUsername"].as_str())
                        .map(str::to_lowercase),
                )
                .collect();
            used.remove(&profiles::text(profile, "name").to_lowercase());
            used.remove(&profiles::text(state, "targetUsername").to_lowercase());
            return self.apply_username(state, model, index, used).await;
        }
        if state["fullNameDone"] != true
            && (state["fullName"].is_string()
                || !profiles::text(model, "fullName").trim().is_empty()
                || model["fullNames"].as_array().is_some_and(|v| {
                    v.iter()
                        .any(|n| n.as_str().is_some_and(|n| !n.trim().is_empty()))
                }))
        {
            let name = if let Some(name) = state["fullName"].as_str() {
                name.into()
            } else {
                self.group_name(model_id, index / 4, model).await?
            };
            self.patch_setup(
                id,
                json!({"pending":{"kind":"fullName","date":date(api::now_ms())},"fullName":name}),
                &[],
            )
            .await?;
            return self
                .mobile_step(id, "fullName", json!({"fullName":name}), "fullNameDone")
                .await;
        }
        if state["postSourceIds"].as_array().map_or(0, Vec::len)
            >= state["postTarget"].as_u64().unwrap_or(9) as usize
        {
            if state["outreachReadyMarked"] != true {
                self.patch_setup(id, json!({"outreachReadyMarked":true}), &["error"])
                    .await?;
            }
            return Ok(());
        }
        if today < 4 || state["avatarDone"] == true {
            return Ok(());
        }
        let content = self
            .content
            .allocate(model_id, "avatars", id, &[], false)
            .await?;
        if content.is_null() {
            return Ok(());
        }
        // Read before marking pending: a disk failure cannot have touched Instagram.
        use base64::Engine;
        let bytes = tokio::fs::read(profiles::text(&content, "path")).await?;
        self.patch_setup(id,json!({"pending":{"kind":"avatar","sourceId":content["sourceId"],"date":date(api::now_ms())},"avatarSourceId":content["sourceId"]}),&[]).await?;
        self.mobile_step(
            id,
            "avatar",
            json!({"image":base64::engine::general_purpose::STANDARD.encode(bytes)}),
            "avatarDone",
        )
        .await
    }
    async fn mobile_step(&self, id: &str, action: &str, args: Value, done: &str) -> Result<()> {
        match self
            .mobile
            .invoke(
                action,
                &Command {
                    profile_id: id.into(),
                    token: None,
                    args,
                },
            )
            .await
        {
            Ok(_) => {
                let mut patch = json!({});
                patch[done] = json!(true);
                self.patch_setup(id, patch, &["pending", "error"]).await
            }
            Err(e) => {
                self.patch_setup(
                    id,
                    json!({"error":format!("{action} update needs review ({})",e.name)}),
                    &[],
                )
                .await
            }
        }
    }
    async fn apply_username(
        &self,
        state: &Value,
        model: &Value,
        index: usize,
        mut used: HashSet<String>,
    ) -> Result<()> {
        let id = profiles::text(state, "profileId");
        let account = self.account_for_profile(id).await?;
        if account.is_null() {
            return Ok(());
        }
        let mut candidates = if let Some(name) = state["targetUsername"].as_str() {
            vec![name.to_owned()]
        } else {
            self.username_candidates(model, index, &used).await?
        };
        let mut attempt = 0;
        while attempt < candidates.len().min(8) {
            let name = candidates[attempt].clone();
            attempt += 1;
            used.insert(name.to_lowercase());
            self.patch_setup(id,json!({"pending":{"kind":"username","date":date(api::now_ms())},"targetUsername":name}),&[]).await?;
            match self
                .mobile
                .invoke(
                    "username",
                    &Command {
                        profile_id: id.into(),
                        token: None,
                        args: json!({"username":name}),
                    },
                )
                .await
            {
                Ok(_) => {
                    self.set_username(profiles::text(&account, "id"), &name)
                        .await?;
                    self.patch_setup(
                        id,
                        json!({"nameDone":true,"targetUsername":name}),
                        &["pending", "error"],
                    )
                    .await?;
                    return self
                        .sync_name(id, profiles::text(&account, "id"), &name)
                        .await;
                }
                Err(e) if e.name == "UsernameUnavailable" => {
                    self.patch_setup(id, json!({}), &["pending", "targetUsername"])
                        .await?;
                    if candidates.len() == 1 {
                        candidates.extend(self.username_candidates(model, index, &used).await?);
                    }
                }
                Err(e) => {
                    self.patch_setup(
                        id,
                        json!({"error":format!("Username update needs review ({})",e.name)}),
                        &[],
                    )
                    .await?;
                    return Ok(());
                }
            }
        }
        self.patch_setup(
            id,
            json!({"error":"No available username was accepted"}),
            &["pending"],
        )
        .await
    }
    async fn generate_name(&self, prompt: String) -> Result<String> {
        let key = std::env::var("OPENROUTER_API_KEY").unwrap_or_default();
        if key.trim().is_empty() {
            return Err(Failure::invalid(
                "OPENROUTER_API_KEY is required for username generation",
            ));
        }
        let response=self.api.client.post("https://openrouter.ai/api/v1/chat/completions").bearer_auth(key.trim()).json(&json!({"model":"openai/gpt-6-luna","reasoning_effort":"none","max_tokens":250,"messages":[{"role":"user","content":prompt}]})).timeout(Duration::from_secs(30)).send().await.map_err(|_| Failure::unavailable("Name generation failed"))?;
        if !response.status().is_success() {
            return Err(Failure::unavailable("Name generation failed"));
        }
        Ok(profiles::text(
            &api::bounded_json(response, 64 * 1024).await?["choices"][0]["message"],
            "content",
        )
        .trim()
        .into())
    }
    async fn username_candidates(
        &self,
        model: &Value,
        index: usize,
        used: &HashSet<String>,
    ) -> Result<Vec<String>> {
        let supplied: Vec<_> = model["usernames"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|n| super::valid_username(n) && n.bytes().all(|c| !c.is_ascii_uppercase()))
            .collect();
        if let Some(name) = supplied.get(index).filter(|n| !used.contains(**n)) {
            return Ok(vec![(*name).into()]);
        }
        let seeds: Vec<_> = supplied.iter().take(10).copied().collect();
        let initial = supplied.get(index).copied();
        let raw=self.generate_name(format!("Generate 10 natural Instagram username ideas for the same person. Examples: {}. Base full name: {}. Avoid these: {}. Use lowercase letters, digits, periods or underscores only, max 30 characters. Return only a JSON array of 10 strings.",json!(seeds),json!(base_name(model)),json!(used))).await?;
        let generated: Vec<String> = raw
            .find('[')
            .zip(raw.rfind(']'))
            .and_then(|(start, end)| raw.get(start..=end))
            .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok())
            .unwrap_or_default();
        let base = initial
            .or_else(|| seeds.get(index % seeds.len().max(1)).copied())
            .unwrap_or(profiles::text(model, "name"))
            .to_lowercase()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_')
            .take(24)
            .collect::<String>();
        let local = vec![
            base.clone(),
            format!("{base}.a"),
            format!("{base}_m"),
            format!("{base}7"),
            format!("{base}.l"),
        ];
        let mut seen = HashSet::new();
        Ok(initial
            .into_iter()
            .map(str::to_owned)
            .chain(generated)
            .chain(local)
            .map(|n| n.to_lowercase())
            .filter(|n| super::valid_username(n) && !used.contains(n) && seen.insert(n.clone()))
            .collect())
    }
    async fn group_name(&self, model_id: &str, group: usize, model: &Value) -> Result<String> {
        if let Some(name) = model["fullNames"][group]
            .as_str()
            .filter(|s| !s.trim().is_empty())
        {
            return Ok(name.trim().into());
        }
        let saved = self
            .store(
                "modelSetupGroupName",
                json!({"modelId":model_id,"group":group}),
            )
            .await?;
        if let Some(name) = saved.as_str().filter(|s| !s.is_empty()) {
            return Ok(name.into());
        }
        let base = base_name(model);
        let name = if group == 0 {
            base.to_owned()
        } else {
            let raw=self.generate_name(format!("Write one natural full-name variation for the same person as {}. It will be used on several Instagram accounts. Keep the same first and last name identity, with a subtle variation such as a middle initial or familiar first-name form. Return only the full name, 2 to 4 words.",json!(base))).await?;
            let name = raw.trim_matches(|c: char| c.is_whitespace() || c == '"' || c == '\'');
            if (3..=80).contains(&name.chars().count())
                && name
                    .chars()
                    .all(|c| c.is_alphabetic() || " .'-".contains(c))
            {
                name.into()
            } else {
                base.into()
            }
        };
        Ok(self
            .store(
                "modelSetupSaveGroupName",
                json!({"modelId":model_id,"group":group,"name":name}),
            )
            .await?
            .as_str()
            .unwrap_or(&name)
            .into())
    }
    async fn prepare_post(&self, id: &str, model: &str) -> Result<Value> {
        let state = self.setup_state(id).await?;
        if state.is_null()
            || state["modelId"] != model
            || !state["pending"].is_null()
            || state["postSourceIds"].as_array().map_or(0, Vec::len)
                >= state["postTarget"].as_u64().unwrap_or(9) as usize
            || day(
                api::timestamp_ms(&state["startedAt"]).unwrap_or(api::now_ms()),
                api::now_ms(),
            ) < 4
            || state["avatarDone"] != true
        {
            return Ok(Value::Null);
        }
        let today = date(api::now_ms());
        if state["postDates"]
            .as_array()
            .is_some_and(|v| v.iter().any(|v| v == &today))
        {
            return Ok(Value::Null);
        }
        let excludes: Vec<String> = serde_json::from_value(state["postSourceIds"].clone())?;
        let content = self
            .content
            .allocate(model, "posts", id, &excludes, false)
            .await?;
        if content.is_null() {
            return Ok(Value::Null);
        }
        self.patch_setup(
            id,
            json!({"pending":{"kind":"post","sourceId":content["sourceId"],"date":today}}),
            &[],
        )
        .await?;
        Ok(content)
    }
    async fn finish_post(&self, id: &str, result: &str) -> Result<()> {
        let state = self.setup_state(id).await?;
        if state["pending"]["kind"] != "post" {
            return Err(profiles::conflict("Post request expired"));
        }
        match result {
            "shared" => {
                let mut sources = state["postSourceIds"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                let mut dates = state["postDates"].as_array().cloned().unwrap_or_default();
                sources.push(state["pending"]["sourceId"].clone());
                dates.push(state["pending"]["date"].clone());
                let mut patch = json!({"postSourceIds":sources,"postDates":dates});
                if sources.len() >= state["postTarget"].as_u64().unwrap_or(9) as usize {
                    patch["outreachReadyMarked"] = json!(true);
                }
                self.patch_setup(id, patch, &["pending", "error"]).await
            }
            "failed" => {
                self.patch_setup(
                    id,
                    json!({"error":"Browser post failed before sharing"}),
                    &["pending"],
                )
                .await
            }
            _ => {
                self.patch_setup(
                    id,
                    json!({"error":"Post result needs review before retrying"}),
                    &[],
                )
                .await
            }
        }
    }
}
fn base_name(model: &Value) -> &str {
    model["fullName"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| model["fullNames"][0].as_str())
        .unwrap_or(profiles::text(model, "name"))
        .trim()
}
// The socket holds the action lock through browser posting and its durable acknowledgement.
// A crashed browser leaves pending intact; an operator must review it before another post.
pub async fn post_lease(State(state): State<Arc<Accounts>>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(4096)
        .on_upgrade(move |mut socket| async move {
            let Ok(Some(Ok(Message::Text(input)))) =
                tokio::time::timeout(Duration::from_secs(10), socket.recv()).await
            else {
                return;
            };
            let Ok(input) = serde_json::from_str::<Value>(&input) else {
                return;
            };
            let id = profiles::text(&input, "profileId");
            let model = profiles::text(&input, "modelId");
            let result = async {
                let guard = state.action_lock(id).await?;
                let content = state.prepare_post(id, model).await?;
                Ok::<_, Failure>((guard, content))
            }
            .await;
            let (_guard, content) = match result {
                Ok(value) => value,
                Err(e) => {
                    let _ = socket
                        .send(Message::Text(json!({"error":e.message}).to_string().into()))
                        .await;
                    return;
                }
            };
            if socket
                .send(Message::Text(
                    json!({"ready":true,"content":content}).to_string().into(),
                ))
                .await
                .is_err()
                || content.is_null()
            {
                return;
            }
            let result = match tokio::time::timeout(Duration::from_secs(600), socket.recv()).await {
                Ok(Some(Ok(Message::Text(value)))) => serde_json::from_str::<Value>(&value)
                    .ok()
                    .and_then(|v| v["result"].as_str().map(str::to_owned))
                    .unwrap_or_default(),
                _ => String::new(),
            };
            match state.finish_post(id, &result).await {
                Ok(()) => {
                    let _ = socket
                        .send(Message::Text(json!({"saved":true}).to_string().into()))
                        .await;
                }
                Err(e) => {
                    let _ = socket
                        .send(Message::Text(json!({"error":e.message}).to_string().into()))
                        .await;
                }
            }
        })
}
