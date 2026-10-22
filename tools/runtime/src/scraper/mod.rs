mod cache;
mod instagram;
mod own_posts;
mod providers;
#[cfg(test)]
mod tests;

use crate::api::{self, Api};
use axum::{extract::State, http::Method, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
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
    fn rate_limited(ms: u64) -> Self {
        Self {
            message: "Instagram HTTP 429; account or proxy rate limited. Retry later.".into(),
            paused: true,
            retry_after_ms: Some(ms),
        }
    }
}
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    #[serde(default)]
    blocked_profile_ids: Vec<String>,
    task_at: Option<u64>,
    task_key: Option<String>,
}
pub struct Scraper {
    api: Arc<Api>,
    apify_key: String,
    work: watch::Sender<(u64, Work)>,
    cache: Mutex<cache::Cache>,
    #[cfg(test)]
    provider_url: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    #[serde(rename = "_id")]
    id: String,
    username: String,
    profile_id: String,
    run_id: String,
    since_date: u64,
    post_limit: u64,
    list_id: String,
    run_kind: TaskKind,
    post: Option<Value>,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
enum TaskKind {
    Posts,
    Likers,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Activity {
    new_ids: u64,
    like_count: Option<u64>,
}
impl Scraper {
    pub async fn update(&self, mut value: Value) -> crate::native::Result<()> {
        if !value["taskAt"].is_null() {
            value["taskAt"] = json!(api::timestamp_ms(&value["taskAt"])
                .ok_or_else(|| crate::native::Failure::invalid("Invalid scraper deadline"))?);
        }
        let value: Work = serde_json::from_value(value)?;
        self.work.send_modify(|(revision, state)| {
            *revision += 1;
            *state = value;
        });
        Ok(())
    }
    pub fn start(api: Arc<Api>) -> crate::native::Result<Arc<Self>> {
        #[cfg(not(test))]
        let file = crate::native::project_root().join("data/scraper-cache/cache.sqlite");
        #[cfg(test)]
        let file = std::path::PathBuf::from(":memory:");
        let cache = cache::Cache::open(&file)?;
        let (work, _) = watch::channel((0, Work::default()));
        let service = Arc::new(Self {
            api,
            work,
            cache: Mutex::new(cache),
            apify_key: api::env("APIFY_API_KEY", ""),
            #[cfg(test)]
            provider_url: None,
        });
        let runner = service.clone();
        tokio::spawn(async move {
            runner.run_loop().await;
        });
        Ok(service)
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
    async fn run_loop(self: Arc<Self>) {
        let mut work = self.work.subscribe();
        let mut retry_at = Instant::now();
        loop {
            let (_, state) = work.borrow_and_update().clone();
            let Some(due) = state.task_key.as_ref().and(state.task_at) else {
                if work.changed().await.is_err() {
                    break;
                }
                continue;
            };
            let ready = (Instant::now()
                + Duration::from_millis(
                    due.saturating_sub(api::now_ms()).min(24 * 60 * 60 * 1000),
                ))
            .max(retry_at);
            tokio::select! { _=tokio::time::sleep_until(ready.into())=>{}, result=work.changed()=>{if result.is_err(){break;}continue;} }
            let result = self.task_tick().await;
            if let Err(error) = &result {
                ig_service_common::service_error("scraper.tick_failed", &error.message);
            }
            let delay = if result.is_err() {
                30_000
            } else {
                10_000 + rand::random::<u16>() as u64 % 10_000
            };
            retry_at = Instant::now() + Duration::from_millis(delay);
        }
    }
    async fn task_tick(&self) -> Result<()> {
        let claimed = self.request("claim", json!({})).await?;
        if claimed.is_null() {
            return Ok(());
        }
        let job: Task = serde_json::from_value(claimed)
            .map_err(|_| Error::failed("Invalid claimed scraper task"))?;
        let start = Instant::now();
        let result = self.run_task(&job).await;
        let (status, message, activity) = match result {
            Ok(activity) => ("completed", None, activity),
            Err(mut error) => {
                // A browser may take ownership after claim, while a Convex checkpoint is in flight.
                if error.message == "Convex rejected the request" {
                    if let Err(busy) = self.check_available(&job.profile_id) {
                        error = busy;
                    }
                }
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
                    None,
                )
            }
        };
        let mut body = json!({"sourceId":job.id,"runId":job.run_id,"status":status});
        if let Some(message) = &message {
            body["error"] = json!(message);
        }
        if let Some(activity) = &activity {
            body["newIds"] = json!(activity.new_ids);
            body["likeCount"] = json!(activity.like_count);
        }
        let finish = self.request("finish", body).await;
        ig_service_common::write_log_entry(source_completion(
            &job,
            status,
            message.as_deref(),
            activity.as_ref(),
            start,
            finish.as_ref().err().map(|error| error.message.as_str()),
        ));
        finish?;
        Ok(())
    }
    async fn run_task(&self, job: &Task) -> Result<Option<Activity>> {
        if job.run_kind == TaskKind::Posts {
            let posts = self
                .apify_posts(&job.username, job.since_date, job.post_limit)
                .await?;
            // Hidden/missing like counts cannot safely qualify a profile for monitoring.
            let counts: Option<Vec<u64>> = posts.iter().map(|p| p["likeCount"].as_u64()).collect();
            let average = counts
                .filter(|v| !v.is_empty())
                .map(|v| v.iter().map(|n| *n as f64).sum::<f64>() / v.len() as f64);
            let mut chunks: Vec<_> = posts.chunks(25).collect();
            if chunks.is_empty() {
                chunks.push(&[]);
            }
            for chunk in chunks {
                self.request(
                    "posts",
                    json!({"sourceId":job.id,"runId":job.run_id,"posts":chunk,
                    "averageLikes":average,"postCount":posts.len()}),
                )
                .await?;
            }
            return Ok(None);
        }
        self.check_available(&job.profile_id)?;
        let post = job
            .post
            .as_ref()
            .ok_or_else(|| Error::failed("Missing post to scrape"))?;
        self.request("heartbeat", json!({"sourceId":job.id,"runId":job.run_id}))
            .await?;
        let snapshot = self.likers(job, post, &mut None).await?;
        let mut seen = HashSet::new();
        let mut fresh = Vec::new();
        {
            let cache = self
                .cache
                .lock()
                .map_err(|_| Error::failed("Scraper cache unavailable"))?;
            for row in snapshot.rows {
                let id = crate::instagram::string(&row["igId"]);
                if seen.insert(id.clone())
                    && !cache
                        .contains(&job.list_id, &id)
                        .map_err(|_| Error::failed("Scraper cache unavailable"))?
                {
                    fresh.push(row);
                }
            }
        }
        for chunk in fresh.chunks(25) {
            let result = self
                .request(
                    "batch",
                    json!({"sourceId":job.id,"runId":job.run_id,"likers":chunk}),
                )
                .await?;
            let processed = result["processed"]
                .as_u64()
                .filter(|v| *v <= chunk.len() as u64)
                .ok_or_else(|| Error::failed("Invalid scraper batch result"))?
                as usize;
            let ids: Vec<_> = chunk
                .iter()
                .take(processed)
                .map(|r| crate::instagram::string(&r["igId"]))
                .collect();
            self.cache
                .lock()
                .map_err(|_| Error::failed("Scraper cache unavailable"))?
                .acknowledge(&job.list_id, &ids)
                .map_err(|_| Error::failed("Scraper cache unavailable"))?;
            if processed < chunk.len() {
                return Err(Error::failed("Scraper batch was not fully saved"));
            }
        }
        let new_ids = self
            .cache
            .lock()
            .map_err(|_| Error::failed("Scraper cache unavailable"))?
            .observe(
                &format!("{}:{}", job.id, crate::instagram::string(&post["id"])),
                &job.run_id,
                &snapshot.ids,
            )
            .map_err(|_| Error::failed("Scraper cache unavailable"))?;
        Ok(Some(Activity {
            new_ids,
            like_count: snapshot.like_count,
        }))
    }
    fn check_available(&self, profile_id: &str) -> Result<()> {
        if self
            .work
            .borrow()
            .1
            .blocked_profile_ids
            .iter()
            .any(|id| id == profile_id)
        {
            return Err(Error {
                message: "Scraper profile is busy in the browser or paused".into(),
                paused: true,
                retry_after_ms: None,
            });
        }
        Ok(())
    }
    async fn likers(
        &self,
        job: &Task,
        post: &Value,
        web: &mut Option<instagram::Web>,
    ) -> Result<instagram::Likers> {
        if web.is_none() {
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
            if profile["paused"] == true
                || profile["pendingRenameFrom"].is_string()
                || profile["status"] == "deleting"
                || profile["inUse"] == true
                || profile["status"] == "running"
            {
                return Err(Error {
                    message: "Scraper profile is busy in the browser".into(),
                    paused: true,
                    retry_after_ms: None,
                });
            }
            let fallback = instagram::Web::new(&profile)?.with_budget(
                self.api.clone(),
                &job.profile_id,
                &job.id,
                &job.run_id,
            );
            #[cfg(test)]
            let fallback = fallback.with_base(self.provider_url.clone());
            *web = Some(fallback);
        }
        web.as_ref()
            .unwrap()
            .likers(post, &|| self.check_available(&job.profile_id))
            .await
    }
}

fn source_completion(
    job: &Task,
    status: &str,
    reason: Option<&str>,
    activity: Option<&Activity>,
    start: Instant,
    finish_error: Option<&str>,
) -> Value {
    let failed = status == "failed" || finish_error.is_some();
    let error_message = if status == "failed" {
        reason.or(finish_error)
    } else {
        finish_error
    };
    json!({"id":uuid::Uuid::new_v4().to_string(),"ts":api::now_ms(),"event":"scraper.source",
        "message":"scraper source check finished","source":"runtime","requestId":job.run_id,"profileId":job.profile_id,
        "level":if failed {"error"} else {"info"},
        "outcome":if failed {"error"} else if status=="paused" {"paused"} else {"success"},
        "durationMs":start.elapsed().as_millis() as u64,
        "error":if failed {Some(json!({"type":"ScraperError","message":error_message.unwrap_or("Scraper task failed")}))} else {None},
        "context":{"sourceId":job.id,"profileId":job.profile_id,"listId":job.list_id,"runKind":job.run_kind,
            "postId":job.post.as_ref().map(|p| &p["id"]),"status":status,"reason":reason,"finishError":finish_error,
            "newIds":activity.map(|activity| activity.new_ids),"likeCount":activity.and_then(|activity| activity.like_count)},
        "environment":ig_service_common::log_environment("runtime")})
}
pub fn router(service: Arc<Scraper>) -> Router {
    Router::new()
        .route("/scraper/work", post(update))
        .route("/scraper/own-post-likers", post(own_posts::scan))
        .with_state(service)
}
async fn update(State(service): State<Arc<Scraper>>, Json(work): Json<Work>) -> Json<Value> {
    service.work.send_modify(|(revision, state)| {
        *revision = revision.wrapping_add(1);
        *state = work;
    });
    Json(json!({"ok":true}))
}
