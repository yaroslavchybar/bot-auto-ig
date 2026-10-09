use super::{
    chat::Chat,
    processes::Processes,
    subscriptions::{self, Subscriptions},
    Failure, Result,
};
use crate::{
    api::{self, Api},
    scraper,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{mpsc, watch, Mutex};

pub struct Coordination {
    api: Arc<Api>,
    subscriptions: Arc<Subscriptions>,
    processes: Arc<Processes>,
    chat: Arc<Chat>,
    scraper: Arc<scraper::Scraper>,
    started: AtomicBool,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    stop: watch::Sender<bool>,
    #[cfg(test)]
    chat_interval: Duration,
}
impl Coordination {
    pub fn new(
        api: Arc<Api>,
        subscriptions: Arc<Subscriptions>,
        processes: Arc<Processes>,
        chat: Arc<Chat>,
        scraper: Arc<scraper::Scraper>,
    ) -> Arc<Self> {
        let (stop, _) = watch::channel(false);
        Arc::new(Self {
            api,
            subscriptions,
            processes,
            chat,
            scraper,
            started: AtomicBool::new(false),
            tasks: Default::default(),
            stop,
            #[cfg(test)]
            chat_interval: Duration::from_secs(15 * 60),
        })
    }
    pub async fn start(self: &Arc<Self>) {
        if *self.stop.borrow() {
            return;
        }
        if self.started.swap(true, Ordering::Relaxed) {
            return;
        }
        let mut tasks = self.tasks.lock().await;
        if *self.stop.borrow() {
            return;
        }
        for kind in ["scraper", "chat", "routines"] {
            let state = self.clone();
            let mut stop = self.stop.subscribe();
            tasks.push(tokio::spawn(async move {
                loop {
                    let task = async { match kind { "scraper" => state.scraper().await, "chat" => state.chat().await, _ => state.routines().await } };
                    tokio::select! { _ = stop.changed() => break, result = task => { if let Err(error) = result { ig_service_common::service_error("coordination.subscription_failed", &error.message); } } }
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
    }
    async fn scraper(&self) -> Result<()> {
        let mut subscription = self
            .subscriptions
            .subscribe("scraper:work", json!({}))
            .await?;
        while let Some(update) = subscription.next().await {
            let value = subscriptions::value(update)
                .unwrap_or(json!({"taskAt": null, "taskKey": null, "enrichmentKey": null}));
            self.scraper.update(value).await?;
        }
        Err(Failure::unavailable("Scraper subscription ended"))
    }
    async fn chat(&self) -> Result<()> {
        let _cache_guard = ChatContexts(self.chat.clone());
        let mut epoch = self.subscriptions.connection_epoch();
        let mut subscription = self
            .subscriptions
            .subscribe(
                "profiles/queries:chatWorkerContexts",
                json!({"subscriptionId": uuid::Uuid::new_v4().to_string()}),
            )
            .await?;
        let mut ids: HashMap<String, String> = HashMap::new();
        let mut pending = std::collections::BTreeSet::new();
        let mut rounds = tokio::task::JoinSet::new();
        let mut reconnects = tokio::task::JoinSet::new();
        #[cfg(test)]
        let interval = self.chat_interval;
        #[cfg(not(test))]
        let interval = Duration::from_secs(15 * 60);
        let mut timer = tokio::time::interval(interval);
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                biased;
                _ = epoch.changed() => {
                    self.chat.clear_contexts();
                    reconnects.abort_all();
                    let subscriptions = self.subscriptions.clone();
                    // A unique query avoids reusing the SDK's old result after reconnect.
                    reconnects.spawn(async move {
                        subscriptions.subscribe("profiles/queries:chatWorkerContexts", json!({"subscriptionId":uuid::Uuid::new_v4().to_string()})).await
                    });
                }
                result = reconnects.join_next(), if !reconnects.is_empty() => {
                    match result {
                        Some(Ok(Ok(next))) => subscription = next,
                        Some(Err(error)) if error.is_cancelled() => {},
                        _ => return Err(Failure::unavailable("Chat subscription reconnect failed")),
                    }
                }
                update = subscription.next(), if reconnects.is_empty() => {
                    let Some(update) = update else { return Err(Failure::unavailable("Chat profile subscription ended")); };
                    let value = match subscriptions::value(update) {
                        Ok(value) => value,
                        Err(error) => {
                            self.chat.clear_contexts();
                            ig_service_common::service_error("chat.subscription_failed", &error.message);
                            continue;
                        }
                    };
                    let contexts: Vec<crate::instagram::SessionContext> = match serde_json::from_value(value) {
                        Ok(contexts) => contexts,
                        Err(error) => {
                            self.chat.clear_contexts();
                            ig_service_common::service_error("chat.subscription_failed", &error.to_string());
                            continue;
                        }
                    };
                    let next: HashMap<_,_> = contexts.iter().filter(|v| v.enabled).map(|v| (v.profile_id.clone(), v.token.clone())).collect();
                    pending.extend(next.iter().filter(|(id, token)| ids.get(*id) != Some(*token)).map(|(id,_)| id.clone()));
                    pending.retain(|id| next.contains_key(id));
                    self.chat.update_contexts(contexts, self.subscriptions.clone());
                    ids = next;
                    self.chat.retain(ids.keys().cloned().collect()).await?;
                }
                _ = timer.tick() => pending.extend(ids.keys().cloned()),
                _ = rounds.join_next(), if !rounds.is_empty() => {},
            }
            if rounds.is_empty() && !pending.is_empty() {
                let work = std::mem::take(&mut pending);
                let chat = self.chat.clone();
                rounds.spawn(async move {
                    let mut work = futures_util::stream::iter(work.into_iter().map(|id| {
                        let chat = chat.clone();
                        async move {
                            if let Err(error) = chat.inbox(&id, true).await {
                                ig_service_common::service_error(
                                    "chat.background_sync_failed",
                                    &error.message,
                                );
                            }
                        }
                    }))
                    .buffer_unordered(4);
                    while work.next().await.is_some() {}
                });
            }
        }
    }
    async fn routines(&self) -> Result<()> {
        let mut subscription = self
            .subscriptions
            .subscribe("automations/queries:listRoutinesForScheduler", json!({}))
            .await?;
        let (sender, mut updates) = mpsc::channel::<(String, u64, Option<Value>)>(1000);
        let mut watchers: HashMap<String, Watcher> = HashMap::new();
        let mut generation = 0;
        let mut closed = self.processes.closed.subscribe();
        loop {
            let deadline = watchers
                .values()
                .filter_map(|w| w.at)
                .min()
                .unwrap_or(api::now_ms() + 15 * 60_000);
            let wait = Duration::from_millis(deadline.saturating_sub(api::now_ms()));
            tokio::select! {
                update = subscription.next() => {
                    let Some(update) = update else { return Err(Failure::unavailable("Routine subscription ended")); };
                    let value = match subscriptions::value(update) { Ok(value) => value, Err(error) => { ig_service_common::service_error("routine.subscription_failed", &error.message); continue; } };
                    let rows: HashMap<String, Value> = value.as_array().into_iter().flatten().filter(|v| v["hasRoutine"] == true && v["isActive"] == true).take(1000).map(|v| (crate::instagram::string(&v["_id"]), v.clone())).collect();
                    let removed: Vec<_> = watchers.keys().filter(|id| !rows.contains_key(*id)).cloned().collect();
                    for id in removed { watchers.remove(&id); self.processes.stop(true, &id, false).await?; }
                    for (id, row) in rows {
                        if watchers.get(&id).is_some_and(|w| w.row["configRevision"] == row["configRevision"]) { continue; }
                        generation += 1;
                        let subscriptions = self.subscriptions.clone(); let sender = sender.clone(); let worker_id = id.clone(); let lists = row["listIds"].clone(); let revision = generation;
                        let task = tokio::spawn(async move {
                            loop {
                                if let Ok(mut subscription) = subscriptions.subscribe("automations/queries:runtimeSnapshot", json!({"id": worker_id, "listIds": lists.as_array().cloned().unwrap_or_default()})).await {
                                    while let Some(update) = subscription.next().await { if sender.send((worker_id.clone(), revision, subscriptions::value(update).ok())).await.is_err() { return; } }
                                }
                                if sender.send((worker_id.clone(), revision, None)).await.is_err() { return; }
                                tokio::time::sleep(Duration::from_secs(3)).await;
                            }
                        });
                        watchers.insert(id, Watcher { row, snapshot: None, at: None, generation, task });
                    }
                }
                update = updates.recv() => {
                    if let Some((id, revision, value)) = update {
                        if let Some(watcher) = watchers.get_mut(&id).filter(|w| w.generation == revision) {
                            watcher.snapshot = value;
                            watcher.at = match watcher.snapshot.as_ref() { Some(snapshot) => Some(self.due(&id, &watcher.row, snapshot).await?), None => None };
                        }
                    }
                }
                completion = closed.recv() => {
                    if let Ok((id, at)) = completion {
                        if let Some(watcher) = watchers.get_mut(&id) {
                            watcher.at = match watcher.snapshot.as_ref() {
                                Some(snapshot) => Some(self.due(&id, &watcher.row, snapshot).await?.max(at.unwrap_or(0))),
                                None => None,
                            };
                        }
                    }
                }
                _ = tokio::time::sleep(wait) => {
                    let now = api::now_ms(); let ids: Vec<_> = watchers.iter().filter(|(_,w)| w.at.is_some_and(|at| at <= now)).map(|(id,_)| id.clone()).collect();
                    for id in ids {
                        if self.processes.is_running(&id).await { if let Some(w) = watchers.get_mut(&id) { w.at = None; } continue; }
                        match self.processes.start_automation(&id).await {
                            Ok(()) => { if let Some(w) = watchers.get_mut(&id) { w.at = None; } },
                            Err(error) => { if error.status != axum::http::StatusCode::TOO_MANY_REQUESTS { ig_service_common::service_error("routine.start_failed", &error.message); }
                                if let Some(w) = watchers.get_mut(&id) { w.at = Some(now + if error.status == axum::http::StatusCode::TOO_MANY_REQUESTS { 1000 } else { 5000 }); } },
                        }
                    }
                }
            }
        }
    }
    async fn due(&self, id: &str, row: &Value, snapshot: &Value) -> Result<u64> {
        if snapshot["truncated"] != true {
            return Ok(due_at(snapshot, api::now_ms()));
        }
        let mut snapshot = snapshot.clone();
        let mut profiles = keyed(&snapshot["profiles"], "id");
        let mut warmups = keyed(&snapshot["warmups"], "profileId");
        let mut progress = keyed(&snapshot["progress"], "profileId");
        for list in row["listIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            let mut cursor = String::new();
            for _ in 0..500 {
                let url = reqwest::Url::parse_with_params(
                    "http://local/",
                    [("automationId", id), ("listId", list), ("cursor", &cursor)],
                )
                .unwrap();
                let page = self
                    .api
                    .convex(
                        axum::http::Method::GET,
                        &format!("/api/automations/runtime-page?{}", url.query().unwrap()),
                        None,
                    )
                    .await?;
                profiles.extend(keyed(&page["profiles"], "id"));
                warmups.extend(keyed(&page["warmups"], "profileId"));
                progress.extend(keyed(&page["progress"], "profileId"));
                if page["isDone"] == true
                    || page["nextCursor"].as_str().is_none_or(|s| s.is_empty())
                {
                    break;
                }
                let next = crate::instagram::string(&page["nextCursor"]);
                if next == cursor {
                    return Err(Failure::unavailable("Runtime pagination cursor repeated"));
                }
                cursor = next;
            }
        }
        snapshot["profiles"] = json!(profiles.into_values().collect::<Vec<_>>());
        snapshot["warmups"] = json!(warmups.into_values().collect::<Vec<_>>());
        snapshot["progress"] = json!(progress.into_values().collect::<Vec<_>>());
        Ok(due_at(&snapshot, api::now_ms()))
    }
}
struct ChatContexts(Arc<Chat>);
impl Drop for ChatContexts {
    fn drop(&mut self) {
        self.0.clear_contexts();
    }
}
struct Watcher {
    row: Value,
    snapshot: Option<Value>,
    at: Option<u64>,
    generation: u64,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Watcher {
    fn drop(&mut self) {
        self.task.abort();
    }
}
fn keyed(rows: &Value, field: &str) -> HashMap<String, Value> {
    rows.as_array()
        .into_iter()
        .flatten()
        .map(|r| (crate::instagram::string(&r[field]), r.clone()))
        .collect()
}
pub fn due_at(snapshot: &Value, now: u64) -> u64 {
    let fallback = now + 15 * 60_000;
    if snapshot.is_null() || snapshot["automation"]["isActive"] == false {
        return fallback;
    }
    use chrono::{TimeZone, Utc};
    let time = Utc.timestamp_millis_opt(now as i64).single().unwrap();
    let today = time.date_naive();
    let midnight = today
        .succ_opt()
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis() as u64;
    let progress = keyed(&snapshot["progress"], "profileId");
    let warmups = keyed(&snapshot["warmups"], "profileId");
    let mut earliest = fallback;
    for profile in snapshot["profiles"].as_array().into_iter().flatten() {
        if profile["igLoggedIn"] != true
            || profile["using"] == true
            || matches!(profile["status"].as_str(), Some("running" | "deleting"))
            || profile["renameFrom"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
        {
            continue;
        }
        if let Some(status) = profile["igAccountStatus"].as_str() {
            if status != "connected" {
                let login = api::timestamp_ms(&profile["browserLoggedInAt"]).unwrap_or(0);
                if status != "assigned"
                    || login == 0
                    || now <= login
                    || Utc
                        .timestamp_millis_opt(login as i64)
                        .single()
                        .is_none_or(|login| {
                            login.with_timezone(&chrono_tz::Europe::Kyiv).date_naive()
                                == time.with_timezone(&chrono_tz::Europe::Kyiv).date_naive()
                        })
                {
                    continue;
                }
            }
        }
        let id = crate::instagram::string(&profile["id"]);
        let empty = Value::Null;
        let state = progress.get(&id).unwrap_or(&empty);
        let warmup = warmups.get(&id).unwrap_or(&empty);
        if state["paused"] == true || state["issue"].as_str().is_some_and(|s| !s.is_empty()) {
            continue;
        }
        let mut at = now
            .max(api::timestamp_ms(&state["nextRunAt"]).unwrap_or(0))
            .max(api::timestamp_ms(&warmup["nextRunAt"]).unwrap_or(0));
        if warmup["date"].as_str() == Some(today.to_string().as_str())
            && (warmup["activeRun"] == true
                || warmup["minutesUsedToday"].as_f64().unwrap_or(0.0)
                    >= warmup["todayMinutes"].as_f64().unwrap_or(f64::INFINITY))
        {
            at = at.max(midnight);
        }
        earliest = earliest.min(at);
    }
    earliest
}
#[cfg(test)]
mod chat_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod readiness_tests {
    use super::*;
    #[test]
    fn fractional_rest_deadlines_do_not_start_a_worker_early() {
        let now = 1_790_812_500_000u64;
        for (progress, warmup) in [(30_000.25, 0.0), (0.0, 30_000.75), (20_000.5, 30_000.75)] {
            let snapshot = json!({
                "automation": {"isActive": true},
                "profiles": [{"id": "p", "igLoggedIn": true}],
                "progress": [{"profileId": "p", "nextRunAt": now as f64 + progress}],
                "warmups": [{"profileId": "p", "nextRunAt": now as f64 + warmup}]
            });
            assert_eq!(due_at(&snapshot, now), now + 30_001);
        }
    }
    #[test]
    fn readiness_respects_rest_account_dates_and_midnight() {
        let now = 1_790_812_500_000u64;
        assert_eq!(
            due_at(
                &json!({"automation": {"isActive": true}, "profiles": [{"id": "p", "igLoggedIn": true}], "progress": [{"profileId": "p", "nextRunAt": now + 30_000}]}),
                now
            ),
            now + 30_000
        );
        for profile in [
            json!({"igLoggedIn": false}),
            json!({"igLoggedIn": true, "using": true}),
            json!({"igLoggedIn": true, "igAccountStatus": "assigned", "browserLoggedInAt": now - 1000}),
        ] {
            assert_eq!(
                due_at(&json!({"automation": {}, "profiles": [profile]}), now),
                now + 15 * 60_000
            );
        }
    }
}
