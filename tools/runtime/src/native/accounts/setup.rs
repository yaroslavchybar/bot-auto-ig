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
    pub async fn patch_setup(
        &self,
        id: &str,
        model: &str,
        patch: Value,
        clear: &[&str],
    ) -> Result<()> {
        self.store(
            "modelSetupPatch",
            json!({"profileId":id,"modelId":model,"patch":patch,"clear":clear}),
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
            if profile["paused"] == true
                || profile["igLoggedIn"] != true
                || profile["status"] == "deleting"
            {
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
    /// Browser edits run under their socket lease. This hook runs only after browser close.
    pub async fn advance_setup(&self, id: &str, automation_id: &str) -> Result<()> {
        let Ok(_guard) = self.action_lock(id).await else {
            return Ok(());
        };
        let query =
            reqwest::Url::parse_with_params("http://local/", [("automationId", automation_id)])
                .unwrap();
        let automation = self
            .api
            .convex(
                Method::GET,
                &format!("/api/automations/by-id?{}", query.query().unwrap()),
                None,
            )
            .await?;
        if automation["isActive"] != true || !automation["routine"].is_object() {
            return Ok(());
        }
        let profile = self.profiles.by_id(id).await?;
        if profile.is_null()
            || profile["paused"] == true
            || profile["using"] == true
            || profile["status"] == "running"
            || profile["status"] == "deleting"
            || profile["renameFrom"].is_string()
            || profile["igLoggedIn"] != true
        {
            return Ok(());
        }
        let account = self.account_for_profile(id).await?;
        if account.is_null() {
            return Ok(());
        }
        let state = self.setup_state(id).await?;
        if state.is_null()
            || !automation["listIds"]
                .as_array()
                .is_some_and(|models| models.len() == 1 && models[0] == state["modelId"])
            || !profile["listIds"]
                .as_array()
                .is_some_and(|models| models.contains(&state["modelId"]))
        {
            return Ok(());
        }
        if state["nameDone"] == true && profile["name"] != account["username"] {
            self.profiles
                .update(
                    profiles::text(&profile, "name"),
                    json!({"name":account["username"]}),
                )
                .await?;
        }
        if day(
            api::timestamp_ms(&state["startedAt"]).unwrap_or(api::now_ms()),
            api::now_ms(),
        ) < 3
            || api::timestamp_ms(&account["retryAfter"]).unwrap_or(0) > api::now_ms()
        {
            return Ok(());
        }
        let _slot = self
            .slots
            .acquire()
            .await
            .map_err(|_| Failure::unavailable("Account service stopped"))?;
        let status = self
            .mobile
            .invoke(
                "has",
                &Command {
                    profile_id: id.into(),
                    token: None,
                    args: json!({}),
                },
            )
            .await
            .map_err(|error| Failure::unavailable(error.message))?;
        if status["connected"] != true || status["reconnectRequired"] == true {
            self.login(id, true).await?;
        }
        Ok(())
    }
    pub(super) async fn prepare_browser_setup(
        &self,
        id: &str,
        automation_id: &str,
        selected_model: &mut Option<String>,
    ) -> Result<Value> {
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
            return Ok(Value::Null);
        };
        if automation["isActive"] != true || !automation["routine"].is_object() {
            return Ok(Value::Null);
        }
        *selected_model = Some(model_id.to_owned());
        let profiles = self.profiles.list().await?;
        let Some(profile) = profiles
            .as_array()
            .into_iter()
            .flatten()
            .find(|p| p["id"] == id)
        else {
            return Ok(Value::Null);
        };
        if !profile["listIds"]
            .as_array()
            .is_some_and(|v| v.iter().any(|v| v == model_id))
            || profile["igLoggedIn"] != true
            || profile["paused"] == true
            || profiles::text(profile, "proxy").is_empty()
            || profile["status"] == "deleting"
            || profile["renameFrom"].is_string()
        {
            return Ok(Value::Null);
        }
        let models = self.api.convex(Method::GET, "/api/lists", None).await?;
        let Some(model) = models
            .as_array()
            .into_iter()
            .flatten()
            .find(|m| m["id"] == model_id)
        else {
            return Ok(Value::Null);
        };
        let account = self.account_for_profile(id).await?;
        if account.is_null()
            || (account["browserLoggedInAt"].is_null() && account["status"] != "connected")
        {
            return Ok(Value::Null);
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
            return Ok(Value::Null);
        };
        if !state["pending"].is_null() {
            return Ok(Value::Null);
        }
        let today = day(
            api::timestamp_ms(&state["startedAt"]).unwrap_or(api::now_ms()),
            api::now_ms(),
        );
        if today < 3 {
            return Ok(Value::Null);
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
            return Ok(Value::Null);
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
            return Ok(Value::Null);
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
            return self.prepare_username(state, model, index, used).await;
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
                model_id,
                json!({"pending":{"kind":"fullName","date":date(api::now_ms())},"fullName":name}),
                &[],
            )
            .await?;
            return Ok(
                json!({"kind":"fullName","value":name,"currentUsername":account["username"],"accountId":account["id"]}),
            );
        }
        if state["postSourceIds"].as_array().map_or(0, Vec::len) >= 3
            && state["postSourceIds"].as_array().map_or(0, Vec::len)
                == state["postDates"].as_array().map_or(0, Vec::len)
            && (state["outreachReadyMarked"] != true || profile["outreachReady"] != true)
        {
            self.patch_setup(
                id,
                model_id,
                json!({"outreachReadyMarked":true}),
                &["error"],
            )
            .await?;
        }
        if today < 4 || state["avatarDone"] == true {
            return Ok(Value::Null);
        }
        let content = self
            .content
            .allocate(model_id, "avatars", id, &[], false)
            .await?;
        if content.is_null() {
            return Ok(Value::Null);
        }
        // Verify the content exists before acquiring a durable mutation lease.
        tokio::fs::metadata(profiles::text(&content, "path")).await?;
        self.patch_setup(id,model_id,json!({"pending":{"kind":"avatar","sourceId":content["sourceId"],"date":date(api::now_ms())},"avatarSourceId":content["sourceId"]}),&[]).await?;
        Ok(
            json!({"kind":"avatar","path":content["path"],"sourceId":content["sourceId"],"currentUsername":account["username"],"accountId":account["id"]}),
        )
    }
    async fn prepare_username(
        &self,
        state: &Value,
        model: &Value,
        index: usize,
        used: HashSet<String>,
    ) -> Result<Value> {
        let id = profiles::text(state, "profileId");
        let account = self.account_for_profile(id).await?;
        if account.is_null() {
            return Ok(Value::Null);
        }
        let candidates = if let Some(name) = state["targetUsername"].as_str() {
            vec![name.to_owned()]
        } else {
            self.username_candidates(model, index, &used).await?
        };
        let Some(name) = candidates.first() else {
            return Ok(Value::Null);
        };
        self.patch_setup(
            id,
            profiles::text(state, "modelId"),
            json!({"pending":{"kind":"username","date":date(api::now_ms())},"targetUsername":name}),
            &[],
        )
        .await?;
        Ok(
            json!({"kind":"username","value":name,"nameIndex":index,"candidates":candidates.into_iter().take(8).collect::<Vec<_>>(),"currentUsername":account["username"],"accountId":account["id"]}),
        )
    }
    async fn retry_browser_username(
        &self,
        model_id: &str,
        task: &Value,
        tried: &[Value],
    ) -> Result<Vec<Value>> {
        let models = self.api.convex(Method::GET, "/api/lists", None).await?;
        let model = models
            .as_array()
            .into_iter()
            .flatten()
            .find(|model| model["id"] == model_id)
            .ok_or_else(|| Failure::missing("Model not found"))?;
        let profiles = self.profiles.list().await?;
        let snapshot = self.store("modelSetupList", json!({})).await?;
        let used: HashSet<String> = profiles
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|profile| profile["name"].as_str())
            .chain(
                snapshot
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|state| state["targetUsername"].as_str()),
            )
            .chain(tried.iter().filter_map(Value::as_str))
            .map(str::to_lowercase)
            .collect();
        Ok(self
            .username_candidates(
                model,
                task["nameIndex"].as_u64().unwrap_or(0) as usize,
                &used,
            )
            .await?
            .into_iter()
            .map(Value::String)
            .collect())
    }
    pub(super) async fn finish_browser_setup(
        &self,
        id: &str,
        model: &str,
        task: &Value,
        result: &str,
    ) -> Result<()> {
        let state = self.setup_state(id).await?;
        let kind = profiles::text(task, "kind");
        if state["modelId"] != model || state["pending"]["kind"] != kind {
            return Err(profiles::conflict("Browser setup request expired"));
        }
        if (kind == "fullName" && state["fullName"] != task["value"])
            || (kind == "avatar" && state["pending"]["sourceId"] != task["sourceId"])
        {
            return Err(profiles::conflict("Browser setup target changed"));
        }
        let account = self.account_for_profile(id).await?;
        if account.is_null() || account["id"] != task["accountId"] {
            return Err(profiles::conflict("Browser account assignment changed"));
        }
        match result {
            "applied" => {
                let done = match kind {
                    "username" => "nameDone",
                    "fullName" => "fullNameDone",
                    "avatar" => "avatarDone",
                    _ => return Err(Failure::invalid("Unknown browser setup action")),
                };
                if kind == "username" {
                    let target = profiles::text(task, "value");
                    if state["targetUsername"] != target {
                        return Err(profiles::conflict("Username request changed"));
                    }
                    self.set_username(profiles::text(&account, "id"), target)
                        .await?;
                }
                let mut patch = json!({});
                patch[done] = json!(true);
                self.patch_setup(id, model, patch, &["pending", "error"])
                    .await
            }
            "unavailable" if kind == "username" => {
                self.patch_setup(
                    id,
                    model,
                    json!({"error":"Username is unavailable"}),
                    &["pending", "targetUsername"],
                )
                .await
            }
            "failed" => {
                self.patch_setup(
                    id,
                    model,
                    json!({"error":format!("Browser {kind} failed before saving")}),
                    &["pending"],
                )
                .await
            }
            _ => {
                self.patch_setup(
                    id,
                    model,
                    json!({"error":format!("Browser {kind} result needs review before retrying")}),
                    &[],
                )
                .await
            }
        }
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
                >= state["postTarget"].as_u64().unwrap_or(9).max(3) as usize
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
            model,
            json!({"pending":{"kind":"post","sourceId":content["sourceId"],"date":today}}),
            &[],
        )
        .await?;
        Ok(content)
    }
    async fn finish_post(&self, id: &str, model: &str, result: &str) -> Result<()> {
        let state = self.setup_state(id).await?;
        if state["modelId"] != model || state["pending"]["kind"] != "post" {
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
                if sources.len() >= 3 && sources.len() == dates.len() {
                    patch["outreachReadyMarked"] = json!(true);
                }
                self.patch_setup(id, model, patch, &["pending", "error"])
                    .await
            }
            "failed" => {
                self.patch_setup(
                    id,
                    model,
                    json!({"error":"Browser post failed before sharing"}),
                    &["pending"],
                )
                .await
            }
            _ => {
                self.patch_setup(
                    id,
                    model,
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
            match state.finish_post(id, model, &result).await {
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

/// Hold the account lock and pending marker throughout each browser profile edit.
pub async fn setup_lease(State(state): State<Arc<Accounts>>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(4096).on_upgrade(move |mut socket| async move {
        let Ok(Some(Ok(Message::Text(input)))) = tokio::time::timeout(Duration::from_secs(10),socket.recv()).await else { return; };
        let Ok(input) = serde_json::from_str::<Value>(&input) else { return; };
        let id = profiles::text(&input,"profileId");
        let automation = profiles::text(&input,"automationId");
        let Ok(_guard) = state.action_lock(id).await else { let _=socket.send(Message::Text(json!({"error":"Account action is busy"}).to_string().into())).await; return; };
        let mut model = None;
        let mut task = match state.prepare_browser_setup(id,automation,&mut model).await {
            Ok(task)=>task,
            Err(error)=>{ let _=socket.send(Message::Text(json!({"error":error.message}).to_string().into())).await; return; },
        };
        let model = model.unwrap_or_default();
        let mut candidates = task["candidates"].as_array().cloned().unwrap_or_default();
        let mut expanded = candidates.len() != 1;
        let mut next = 1;
        loop {
            if socket.send(Message::Text(json!({"ready":true,"task":task}).to_string().into())).await.is_err() || task.is_null() { break; }
            let result = match tokio::time::timeout(Duration::from_secs(600),socket.recv()).await {
                Ok(Some(Ok(Message::Text(raw))))=>serde_json::from_str::<Value>(&raw).ok().and_then(|v|v["result"].as_str().map(str::to_owned)).unwrap_or_default(),
                _=>String::new(),
            };
            if let Err(error) = state.finish_browser_setup(id,&model,&task,&result).await {
                let _=socket.send(Message::Text(json!({"error":error.message}).to_string().into())).await; break;
            }
            if result == "unavailable" && task["kind"] == "username" && !expanded {
                expanded = true;
                match state.retry_browser_username(&model,&task,&candidates).await {
                    Ok(more)=>candidates.extend(more),
                    Err(error)=>{ let _=socket.send(Message::Text(json!({"error":error.message}).to_string().into())).await; break; },
                }
            }
            if result == "unavailable" && task["kind"] == "username" && next < candidates.len().min(8) {
                task["value"] = candidates[next].clone(); next += 1;
                if state.patch_setup(id,&model,json!({"pending":{"kind":"username","date":date(api::now_ms())},"targetUsername":task["value"]}),&[]).await.is_err() { break; }
                continue;
            }
            let _=socket.send(Message::Text(json!({"saved":true}).to_string().into())).await;
            break;
        }
    })
}
