use super::{instagram::Web, Error, Result, Scraper};
use axum::{extract::State, Json};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashSet, sync::Arc, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Input {
    profile_id: String,
    automation_id: String,
    owner_ig_id: String,
    posts: Vec<Value>,
}

impl Scraper {
    pub(super) async fn scan_own_posts(&self, input: &Input) -> Result<Value> {
        let args = json!({"automationId":input.automation_id,"profileId":input.profile_id});
        let plan = self
            .api
            .convex(Method::POST, "/api/routines/own-likers-plan", Some(&args))
            .await
            .map_err(Error::failed)?;
        if plan.is_null() {
            return Ok(json!({"ok":true,"scanned":false,"queued":0}));
        }
        let owner = plan["ownerIgId"]
            .as_str()
            .ok_or_else(|| Error::failed("Missing post owner"))?;
        if input.owner_ig_id != owner {
            return Err(Error::failed("Live browser does not match the post owner"));
        }
        if input.posts.len() > 1000 {
            return Err(Error::failed("Too many own posts"));
        }
        let run = plan["runId"]
            .as_str()
            .ok_or_else(|| Error::failed("Missing owning browser run"))?;
        let date = plan["date"]
            .as_str()
            .ok_or_else(|| Error::failed("Missing snapshot date"))?;
        let query =
            reqwest::Url::parse_with_params("http://local/", [("profileId", &input.profile_id)])
                .unwrap();
        // Fetch this exact owner profile once. No scraper-pool or proxy fallback is allowed.
        let profile = self
            .api
            .convex(
                Method::GET,
                &format!("/api/profiles/by-id?{}", query.query().unwrap()),
                None,
            )
            .await
            .map_err(Error::failed)?;
        if profile["paused"] == true
            || profile["status"] == "deleting"
            || profile["pendingRenameFrom"].is_string()
        {
            return Err(Error::failed("Owning profile is unavailable"));
        }
        let web = Web::new(&profile)?.with_owner_budget(
            self.api.clone(),
            &input.profile_id,
            &input.automation_id,
            run,
        );
        #[cfg(test)]
        let web = web.with_base(self.provider_url.clone());
        if web.owner_id.as_deref() != Some(owner) {
            return Err(Error::failed("Saved session does not match the post owner"));
        }
        let mut checked: HashSet<String> = plan["checkedMediaIds"]
            .as_array()
            .map(|rows| {
                rows.iter()
                    .filter_map(|id| id.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let mut queued = 0;
        let mut checked_count = 0;
        for post in &input.posts {
            let id = post["id"]
                .as_str()
                .ok_or_else(|| Error::failed("Invalid own post ID"))?;
            if !checked.insert(id.to_owned()) {
                continue;
            }
            let snapshot = web.likers(post, &|| Ok(())).await?;
            let likers: Vec<_> = snapshot
                .rows
                .iter()
                .map(|row| json!({"igId":row["igId"],"username":row["username"]}))
                .collect();
            let result = self.api.convex_retry(Method::POST, "/api/routines/own-likers-snapshot", Some(&json!({
                "automationId":input.automation_id,"profileId":input.profile_id,"runId":run,"ownerIgId":owner,
                "date":date,"mediaId":post["id"],"likers":likers
            }))).await.map_err(Error::failed)?;
            if result["saved"] != true {
                return Err(Error::failed(
                    "Owning browser run changed before snapshot save",
                ));
            }
            queued += result["queued"].as_u64().unwrap_or(0);
            checked_count += 1;
        }
        let mut finish = args;
        finish["date"] = json!(date);
        finish["runId"] = json!(run);
        let saved = self
            .api
            .convex_retry(
                Method::POST,
                "/api/routines/own-likers-finish",
                Some(&finish),
            )
            .await
            .map_err(Error::failed)?;
        if saved != true {
            return Err(Error::failed(
                "Owning browser run changed before snapshot completion",
            ));
        }
        Ok(json!({"ok":true,"scanned":true,"posts":checked_count,"queued":queued}))
    }
}

pub(super) async fn scan(
    State(service): State<Arc<Scraper>>,
    Json(input): Json<Input>,
) -> Json<Value> {
    let result =
        tokio::time::timeout(Duration::from_secs(90), service.scan_own_posts(&input)).await;
    match result {
        Ok(Ok(value)) => Json(value),
        Ok(Err(error)) => {
            if let Some(ms) = error.retry_after_ms {
                let _ = service
                    .request(
                        "cooldown",
                        json!({"profileId":input.profile_id,"retryAfterMs":ms}),
                    )
                    .await;
            }
            Json(json!({"ok":false,"error":error.message}))
        }
        Err(_) => Json(json!({"ok":false,"error":"Own-post liker scan timed out"})),
    }
}
