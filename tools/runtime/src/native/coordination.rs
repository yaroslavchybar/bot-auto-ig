use super::{
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
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    sync::{mpsc, watch, Mutex},
    task::{AbortHandle, JoinSet},
};

const READINESS_TIMEOUT: Duration = Duration::from_secs(30);

pub struct Coordination {
    api: Arc<Api>,
    subscriptions: Arc<Subscriptions>,
    processes: Arc<Processes>,
    scraper: Arc<scraper::Scraper>,
    started: AtomicBool,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    stop: watch::Sender<bool>,
}
impl Coordination {
    pub fn new(
        api: Arc<Api>,
        subscriptions: Arc<Subscriptions>,
        processes: Arc<Processes>,
        scraper: Arc<scraper::Scraper>,
    ) -> Arc<Self> {
        let (stop, _) = watch::channel(false);
        Arc::new(Self {
            api,
            subscriptions,
            processes,
            scraper,
            started: AtomicBool::new(false),
            tasks: Default::default(),
            stop,
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
        for kind in ["scraper", "routines"] {
            let state = self.clone();
            let mut stop = self.stop.subscribe();
            tasks.push(tokio::spawn(async move {
                loop {
                    let task = async { match kind { "scraper" => state.scraper().await, _ => state.routines().await } };
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
            let value =
                subscriptions::value(update).unwrap_or(json!({"taskAt": null, "taskKey": null}));
            self.scraper.update(value).await?;
        }
        Err(Failure::unavailable("Scraper subscription ended"))
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
        let mut work = JoinSet::new();
        // Serialize lifecycle work per routine while keeping the coordinator responsive.
        let mut operations = HashSet::new();
        loop {
            let deadline = watchers
                .iter()
                .filter(|(id, _)| !operations.contains(*id))
                .filter_map(|(_, w)| w.at)
                .min()
                .unwrap_or(api::now_ms() + 15 * 60_000);
            let wait = Duration::from_millis(deadline.saturating_sub(api::now_ms()));
            tokio::select! {
                update = subscription.next() => {
                    let Some(update) = update else { return Err(Failure::unavailable("Routine subscription ended")); };
                    let value = match subscriptions::value(update) { Ok(value) => value, Err(error) => { ig_service_common::service_error("routine.subscription_failed", &error.message); continue; } };
                    let rows: HashMap<String, Value> = value.as_array().into_iter().flatten().filter(|v| v["hasRoutine"] == true && v["isActive"] == true).take(1000).map(|v| (crate::instagram::string(&v["_id"]), v.clone())).collect();
                    let removed: Vec<_> = watchers.keys().filter(|id| !rows.contains_key(*id)).cloned().collect();
                    for id in removed {
                        watchers.remove(&id);
                        if operations.insert(id.clone()) { stop_routine(&mut work, self.processes.clone(), id); }
                    }
                    for (id, row) in rows {
                        if watchers.get(&id).is_some_and(|w| w.row["configRevision"] == row["configRevision"]) { continue; }
                        generation += 1;
                        let subscriptions = self.subscriptions.clone(); let sender = sender.clone(); let worker_id = id.clone(); let lists = row["modelIds"].clone(); let revision = generation;
                        let task = tokio::spawn(async move {
                            loop {
                                if let Ok(mut subscription) = subscriptions.subscribe("automations/queries:runtimeSnapshot", json!({"id": worker_id, "modelIds": lists.as_array().cloned().unwrap_or_default()})).await {
                                    while let Some(update) = subscription.next().await { if sender.send((worker_id.clone(), revision, subscriptions::value(update).ok())).await.is_err() { return; } }
                                }
                                if sender.send((worker_id.clone(), revision, None)).await.is_err() { return; }
                                tokio::time::sleep(Duration::from_secs(3)).await;
                            }
                        });
                        watchers.insert(id, Watcher { row, snapshot: None, at: None, generation, task,
                            calculation: None, calculation_revision: 0, refresh: false, not_before: 0 });
                    }
                }
                update = updates.recv() => {
                    if let Some((id, revision, value)) = update {
                        if let Some(watcher) = watchers.get_mut(&id).filter(|w| w.generation == revision) {
                            watcher.snapshot = value;
                            // Fresh state may make work ready earlier than the last yielded deadline.
                            watcher.not_before = 0;
                            calculate_due(&mut work, self.api.clone(), id, watcher);
                        }
                    }
                }
                completion = closed.recv() => {
                    if let Ok((id, at)) = completion {
                        if let Some(watcher) = watchers.get_mut(&id) {
                            watcher.not_before = at.unwrap_or(0);
                            calculate_due(&mut work, self.api.clone(), id, watcher);
                        }
                    }
                }
                result = work.join_next(), if !work.is_empty() => {
                    match result {
                        Some(Ok(Work::Ready { id, generation, revision, result })) => {
                            if let Some(w) = watchers.get_mut(&id).filter(|w| w.generation == generation && w.calculation_revision == revision) {
                                w.calculation = None;
                                match result {
                                    Ok(at) => { w.at = Some(at.max(w.not_before)); w.refresh = false; }
                                    Err(error) => {
                                        ig_service_common::service_error("routine.readiness_failed", &format!("{id}: {}", error.message));
                                        w.at = Some(api::now_ms() + 5000); w.refresh = true;
                                    }
                                }
                            }
                        }
                        Some(Ok(Work::Started { id, generation, result })) => {
                            operations.remove(&id);
                            if let Some(w) = watchers.get_mut(&id).filter(|w| w.generation == generation) {
                                if let Err(error) = result {
                                    if error.status != axum::http::StatusCode::TOO_MANY_REQUESTS { ig_service_common::service_error("routine.start_failed", &error.message); }
                                    w.at = Some(api::now_ms() + if error.status == axum::http::StatusCode::TOO_MANY_REQUESTS { 1000 } else { 5000 });
                                    w.refresh = true;
                                }
                            } else {
                                // A disable/config update may arrive while start is in flight.
                                operations.insert(id.clone());
                                stop_routine(&mut work, self.processes.clone(), id);
                            }
                        }
                        Some(Ok(Work::Stopped { id, result })) => {
                            operations.remove(&id);
                            if let Err(error) = result { ig_service_common::service_error("routine.stop_failed", &error.message); }
                            if let Some(w) = watchers.get_mut(&id) { calculate_due(&mut work, self.api.clone(), id, w); }
                        }
                        Some(Err(error)) if !error.is_cancelled() => return Err(Failure::unavailable("Routine coordination task failed")),
                        _ => {}
                    }
                }
                _ = tokio::time::sleep(wait) => {
                    let now = api::now_ms();
                    let ids: Vec<_> = watchers.iter().filter(|(id,w)| !operations.contains(*id) && w.at.is_some_and(|at| at <= now)).map(|(id,_)| id.clone()).collect();
                    for id in ids {
                        let w = watchers.get_mut(&id).unwrap();
                        if w.refresh { calculate_due(&mut work, self.api.clone(), id, w); continue; }
                        w.at = None;
                        operations.insert(id.clone());
                        let processes = self.processes.clone();
                        let generation = w.generation;
                        work.spawn(async move {
                            let result = if processes.is_running(&id).await { Ok(()) } else { processes.start_automation(&id).await };
                            Work::Started { id, generation, result }
                        });
                    }
                }
            }
        }
    }
    async fn due(api: &Api, id: &str, row: &Value, snapshot: &Value) -> Result<u64> {
        if snapshot["truncated"] != true {
            return Ok(due_at(snapshot, api::now_ms()));
        }
        let mut snapshot = snapshot.clone();
        let mut profiles = keyed(&snapshot["profiles"], "id");
        let mut warmups = keyed(&snapshot["warmups"], "profileId");
        let mut progress = keyed(&snapshot["progress"], "profileId");
        for list in row["modelIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            let mut cursor = String::new();
            let mut cursors = HashSet::new();
            let mut complete = false;
            for _ in 0..500 {
                let url = reqwest::Url::parse_with_params(
                    "http://local/",
                    [("automationId", id), ("modelId", list), ("cursor", &cursor)],
                )
                .unwrap();
                let page = api
                    .convex(
                        axum::http::Method::GET,
                        &format!("/api/automations/runtime-page?{}", url.query().unwrap()),
                        None,
                    )
                    .await?;
                profiles.extend(keyed(&page["profiles"], "id"));
                warmups.extend(keyed(&page["warmups"], "profileId"));
                progress.extend(keyed(&page["progress"], "profileId"));
                if page["isDone"] == true {
                    complete = true;
                    break;
                }
                let next = crate::instagram::string(&page["nextCursor"]);
                if next.is_empty() || !cursors.insert(next.clone()) {
                    return Err(Failure::unavailable(
                        "Runtime pagination cursor is missing or repeated",
                    ));
                }
                cursor = next;
            }
            if !complete {
                return Err(Failure::unavailable(
                    "Runtime pagination exceeded the page limit",
                ));
            }
        }
        snapshot["profiles"] = json!(profiles.into_values().collect::<Vec<_>>());
        snapshot["warmups"] = json!(warmups.into_values().collect::<Vec<_>>());
        snapshot["progress"] = json!(progress.into_values().collect::<Vec<_>>());
        Ok(due_at(&snapshot, api::now_ms()))
    }
}
struct Watcher {
    row: Value,
    snapshot: Option<Value>,
    at: Option<u64>,
    generation: u64,
    task: tokio::task::JoinHandle<()>,
    calculation: Option<AbortHandle>,
    calculation_revision: u64,
    refresh: bool,
    not_before: u64,
}
impl Drop for Watcher {
    fn drop(&mut self) {
        self.task.abort();
        if let Some(task) = &self.calculation {
            task.abort();
        }
    }
}
enum Work {
    Ready {
        id: String,
        generation: u64,
        revision: u64,
        result: Result<u64>,
    },
    Started {
        id: String,
        generation: u64,
        result: Result<()>,
    },
    Stopped {
        id: String,
        result: Result<bool>,
    },
}

fn calculate_due(work: &mut JoinSet<Work>, api: Arc<Api>, id: String, watcher: &mut Watcher) {
    if let Some(task) = watcher.calculation.take() {
        task.abort();
    }
    watcher.at = None;
    watcher.calculation_revision += 1;
    let Some(snapshot) = watcher.snapshot.clone() else {
        return;
    };
    let row = watcher.row.clone();
    let generation = watcher.generation;
    let revision = watcher.calculation_revision;
    watcher.calculation = Some(work.spawn(async move {
        let result = tokio::time::timeout(
            READINESS_TIMEOUT,
            Coordination::due(&api, &id, &row, &snapshot),
        )
        .await
        .unwrap_or_else(|_| {
            Err(Failure::unavailable(
                "Routine readiness calculation timed out",
            ))
        });
        Work::Ready {
            id,
            generation,
            revision,
            result,
        }
    }));
}

fn stop_routine(work: &mut JoinSet<Work>, processes: Arc<Processes>, id: String) {
    work.spawn(async move {
        let result = processes.stop(true, &id, false).await;
        Work::Stopped { id, result }
    });
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
        if profile["paused"] == true
            || profile["igLoggedIn"] != true
            || profile["inUse"] == true
            || matches!(profile["status"].as_str(), Some("running" | "deleting"))
            || profile["pendingRenameFrom"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
        {
            continue;
        }
        if let Some(status) = profile["igAccountStatus"].as_str() {
            if status != "connected" || api::timestamp_ms(&profile["browserLoggedInAt"]).is_some() {
                let login = api::timestamp_ms(&profile["browserLoggedInAt"]).unwrap_or(0);
                if !["assigned", "connected"].contains(&status)
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
            json!({"igLoggedIn": true, "paused": true}),
            json!({"igLoggedIn": true, "inUse": true}),
            json!({"igLoggedIn": true, "igAccountStatus": "assigned", "browserLoggedInAt": now - 1000}),
        ] {
            assert_eq!(
                due_at(&json!({"automation": {}, "profiles": [profile]}), now),
                now + 15 * 60_000
            );
        }
    }

    #[test]
    fn worker_and_scheduler_share_the_readiness_contract() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../tests/server/runtime-readiness.json"
        ))
        .unwrap();
        let now = fixture["now"].as_u64().unwrap();
        for row in fixture["cases"].as_array().unwrap() {
            let mut profile = row["profile"].clone();
            profile["id"] = json!("p");
            let mut snapshot = json!({"automation":{"isActive":true},"profiles":[profile]});
            for (key, source) in [("progress", "progress"), ("warmups", "warmup")] {
                if !row[source].is_null() {
                    let mut value = row[source].clone();
                    value["profileId"] = json!("p");
                    snapshot[key] = json!([value]);
                }
            }
            assert_eq!(
                due_at(&snapshot, now),
                now + row["delay"].as_u64().unwrap(),
                "{}",
                row["name"]
            );
        }
    }
}
