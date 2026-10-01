mod instagram;
mod providers;
#[cfg(test)]
mod tests;

use crate::{
    api::{self, Api},
    instagram::{Command, Service},
};
use axum::{extract::State, http::Method, routing::post, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    collections::HashSet,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::watch;
type Result<T> = std::result::Result<T, Error>;
#[derive(Debug)]
struct Error {
    message: String,
    paused: bool,
    retry_after_ms: Option<u64>,
}
impl Error {
    fn failed(message: &str) -> Self {
        Self {
            message: message.into(),
            paused: false,
            retry_after_ms: None,
        }
    }
    fn daily_limit() -> Self {
        Self {
            message: "Daily account limit reached; resumes when capacity is available".into(),
            paused: true,
            retry_after_ms: None,
        }
    }
    fn rate_limited(ms: u64) -> Self {
        Self {
            message: "Instagram HTTP 429; account or proxy rate limited. Retry later.".into(),
            paused: true,
            retry_after_ms: Some(ms),
        }
    }
    fn mobile(error: crate::instagram::Error) -> Self {
        if error.status == 429 {
            Self::rate_limited(error.retry_after_ms)
        } else {
            Self::failed(&error.message)
        }
    }
}
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    job_at: Option<u64>,
    job_key: Option<String>,
    enrichment_key: Option<String>,
}
pub struct Scraper {
    api: Arc<Api>,
    mobile: Arc<Service>,
    openrouter_key: String,
    apify_key: String,
    work: watch::Sender<(u64, Work)>,
    #[cfg(test)]
    provider_url: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    #[serde(rename = "_id")]
    id: String,
    username: String,
    profile_id: String,
    run_id: String,
    since_date: u64,
    post_limit: u64,
    posts: Option<Vec<Value>>,
    post_index: Option<usize>,
}
impl Scraper {
    pub fn start(api: Arc<Api>, mobile: Arc<Service>) -> Arc<Self> {
        let (work, _) = watch::channel((0, Work::default()));
        let service = Arc::new(Self {
            api,
            mobile,
            work,
            openrouter_key: api::env("OPENROUTER_API_KEY", ""),
            apify_key: api::env("APIFY_API_KEY", ""),
            #[cfg(test)]
            provider_url: None,
        });
        for enrichment in [false, true] {
            let service = service.clone();
            tokio::spawn(async move {
                service.run_loop(enrichment).await;
            });
        }
        service
    }
    async fn request(&self, operation: &str, body: Value) -> Result<Value> {
        self.api
            .convex(
                Method::POST,
                &format!("/api/scraper/{operation}"),
                Some(&body),
            )
            .await
            .map_err(Error::failed)
    }
    async fn run_loop(self: Arc<Self>, enrichment: bool) {
        let mut work = self.work.subscribe();
        let mut previous = 0;
        let mut retry_at = Instant::now();
        loop {
            let (revision, state) = work.borrow_and_update().clone();
            let due = if enrichment {
                if state.enrichment_key.is_some() && !self.openrouter_key.is_empty() {
                    Some(0)
                } else {
                    None
                }
            } else {
                state.job_key.as_ref().and(state.job_at)
            };
            let Some(due) = due else {
                if work.changed().await.is_err() {
                    break;
                }
                continue;
            };
            let due_at = Instant::now()
                + Duration::from_millis(due.saturating_sub(api::now_ms()).min(24 * 60 * 60 * 1000));
            let ready = if revision == previous {
                due_at.max(retry_at)
            } else {
                due_at
            };
            tokio::select! { _=tokio::time::sleep_until(ready.into())=>{}, result=work.changed()=>{if result.is_err(){break;}continue;} }
            previous = revision;
            let result = if enrichment {
                self.enrich_pending().await
            } else {
                self.job_tick().await
            };
            if let Err(error) = result {
                ig_service_common::service_error(
                    if enrichment {
                        "scraper.enrichment_failed"
                    } else {
                        "scraper.tick_failed"
                    },
                    &error.message,
                );
            }
            retry_at = Instant::now() + Duration::from_secs(30);
        }
    }
    async fn job_tick(&self) -> Result<()> {
        let claimed = self.request("claim", json!({})).await?;
        if claimed.is_null() {
            return Ok(());
        }
        let job: Job = serde_json::from_value(claimed)
            .map_err(|_| Error::failed("Invalid claimed scraper job"))?;
        let start = Instant::now();
        let result = self.run_job(&job).await;
        let (status, message) = match result {
            Ok(()) => ("completed", None),
            Err(error) => {
                if let Some(ms) = error.retry_after_ms {
                    if let Err(error) = self
                        .request(
                            "cooldown",
                            json!({"profileId":job.profile_id,"retryAfterMs":ms}),
                        )
                        .await
                    {
                        ig_service_common::service_error("scraper.cooldown_failed", &error.message);
                    }
                }
                (
                    if error.paused { "paused" } else { "failed" },
                    Some(error.message),
                )
            }
        };
        let mut body = json!({"jobId":job.id,"runId":job.run_id,"status":status});
        if let Some(message) = &message {
            body["error"] = json!(message);
        }
        self.request("finish", body).await?;
        println!(
            "{}",
            json!({"id":uuid::Uuid::new_v4().to_string(),"ts":api::now_ms(),"event":"scraper.job","message":"scraper job finished","source":"runtime","requestId":job.run_id,"level":if status=="failed"{"error"}else{"info"},"outcome":if status=="completed"{"success"}else if status=="paused"{"paused"}else{"error"},"durationMs":start.elapsed().as_millis() as u64,"context":{"jobId":job.id,"profileId":job.profile_id,"status":status,"reason":message},"environment":{"service":"runtime","runtime":"rust","commitHash":api::env("COMMIT_SHA","unknown")}})
        );
        Ok(())
    }
    async fn checkpoint(&self, job: &Job, extra: Value) -> Result<Value> {
        let mut body = json!({"jobId":job.id,"runId":job.run_id});
        if let Value::Object(extra) = extra {
            body.as_object_mut().unwrap().extend(extra);
        }
        self.request("checkpoint", body).await
    }
    async fn run_job(&self, job: &Job) -> Result<()> {
        if self.openrouter_key.is_empty() {
            return Err(Error::failed(
                "OPENROUTER_API_KEY is missing from the server environment",
            ));
        }
        if job.post_limit == 0 || job.post_limit > 5000 {
            return Err(Error::failed("Invalid scraper post limit"));
        }
        let query =
            reqwest::Url::parse_with_params("http://local/", [("profileId", &job.profile_id)])
                .unwrap();
        let profile = self
            .api
            .convex(
                Method::GET,
                &format!("/api/profiles/by-id?{}", query.query().unwrap()),
                None,
            )
            .await
            .map_err(Error::failed)?;
        if profile.is_null() {
            return Err(Error::failed("Scraper profile was deleted"));
        }
        let web = instagram::Web::new(&profile)?;
        #[cfg(test)]
        let web = web.with_base(self.provider_url.clone());
        let posts: Cow<'_, [Value]> = if let Some(posts) = &job.posts {
            Cow::Borrowed(posts)
        } else {
            let args = json!({"username":job.username,"sinceDate":job.since_date,"postLimit":job.post_limit,"jobId":job.id,"runId":job.run_id});
            let command = Command {
                profile_id: job.profile_id.clone(),
                token: None,
                args,
            };
            let (posts, apify) = match self.mobile.invoke("posts", &command).await {
                Ok(Value::Array(posts)) => (posts, false),
                Ok(_) => return Err(Error::failed("Instagram returned invalid posts")),
                Err(error) if error.status == 429 => return Err(Error::mobile(error)),
                Err(_) => (
                    self.apify_posts(&job.username, job.since_date, job.post_limit)
                        .await?,
                    true,
                ),
            };
            self.checkpoint(job, json!({"posts":posts,"postsFromApify":apify}))
                .await?;
            Cow::Owned(posts)
        };
        let mut seen = HashSet::new();
        for (index, post) in posts.iter().enumerate().skip(job.post_index.unwrap_or(0)) {
            let fresh: Vec<_> = web
                .likers(post)
                .await?
                .into_iter()
                .filter(|row| seen.insert(crate::instagram::string(&row["igId"])))
                .collect();
            for (chunk_index, chunk) in fresh.chunks(25).enumerate() {
                let result = self
                    .request(
                        "batch",
                        json!({"jobId":job.id,"runId":job.run_id,"likers":chunk}),
                    )
                    .await?;
                let processed = result["processed"]
                    .as_u64()
                    .ok_or_else(|| Error::failed("Invalid scraper batch result"))?
                    as usize;
                if result["limitExhausted"] == true {
                    if processed < chunk.len() || (chunk_index + 1) * 25 < fresh.len() {
                        return Err(Error::daily_limit());
                    }
                    self.checkpoint(job, json!({"postIndex":index+1})).await?;
                    if index + 1 < posts.len() {
                        return Err(Error::daily_limit());
                    }
                    return Ok(());
                }
            }
            let state = self.checkpoint(job, json!({"postIndex":index+1})).await?;
            if state["limitExhausted"] == true && index + 1 < posts.len() {
                return Err(Error::daily_limit());
            }
            if index + 1 < posts.len() {
                let ms = 10_000 + rand::random::<u16>() as u64 % 10_000;
                tokio::time::sleep(Duration::from_millis(ms)).await;
            }
        }
        Ok(())
    }
    async fn enrich_pending(&self) -> Result<()> {
        let key = &self.openrouter_key;
        if key.is_empty() {
            return Ok(());
        }
        let pending = self.request("pending", json!({})).await?;
        let rows = pending
            .as_array()
            .ok_or_else(|| Error::failed("Invalid enrichment queue"))?;
        for row in rows.iter().take(10) {
            if let Err(error) = self.enrich(row, key).await {
                ig_service_common::service_error("scraper.lead_enrichment_failed", &error.message);
                self.request("enrichment-error", json!({"leadId":row["_id"]}))
                    .await?;
            }
        }
        Ok(())
    }
    async fn enrich(&self, row: &Value, key: &str) -> Result<()> {
        let mut description = row["profilePicDescription"]
            .as_str()
            .filter(|v| !v.is_empty())
            .map(String::from);
        if description.is_none() {
            if let Some(url) = providers::picture_url(row["profilePicUrl"].as_str().unwrap_or("")) {
                let value = self.describe_picture(&url, key).await?;
                self.request(
                    "picture-description",
                    json!({"leadId":row["_id"],"description":value}),
                )
                .await?;
                description = Some(value);
            }
        }
        let class = self
            .classify(
                key,
                row["username"].as_str().unwrap_or(""),
                row["fullName"].as_str().unwrap_or(""),
                description.as_deref(),
            )
            .await?;
        let mut body = json!({"leadId":row["_id"],"classification":class});
        if let Some(value) = description {
            body["profilePicDescription"] = json!(value);
        }
        self.request("enrich", body).await?;
        Ok(())
    }
}
pub fn router(service: Arc<Scraper>) -> Router {
    Router::new()
        .route("/scraper/work", post(update))
        .with_state(service)
}
async fn update(State(service): State<Arc<Scraper>>, Json(work): Json<Work>) -> Json<Value> {
    service.work.send_modify(|(revision, state)| {
        *revision = revision.wrapping_add(1);
        *state = work;
    });
    Json(json!({"ok":true}))
}
