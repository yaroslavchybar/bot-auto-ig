use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use ig_service_common::now_ms;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{Mutex, Notify};

#[derive(Default)]
pub struct Schedules {
    entries: Mutex<HashMap<String, u64>>,
    changed: Notify,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    due_at: u64,
}

pub async fn set(
    State(state): State<Arc<Schedules>>,
    Path(id): Path<String>,
    Json(value): Json<Schedule>,
) -> Response {
    let mut entries = state.entries.lock().await;
    if entries.len() >= 1000 && !entries.contains_key(&id) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Schedule queue is full"})),
        )
            .into_response();
    }
    entries.insert(id, value.due_at);
    state.changed.notify_one();
    Json(json!({"ok": true})).into_response()
}

pub async fn remove(State(state): State<Arc<Schedules>>, Path(id): Path<String>) -> Json<Value> {
    state.entries.lock().await.remove(&id);
    state.changed.notify_one();
    Json(json!({"ok": true}))
}

/// A single long poll owns wakeups. Due IDs are removed before delivery.
pub async fn due(State(state): State<Arc<Schedules>>) -> Json<Value> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
    loop {
        let changed = state.changed.notified();
        let mut entries = state.entries.lock().await;
        let now = now_ms();
        let mut ready: Vec<_> = entries
            .iter()
            .filter(|(_, at)| **at <= now)
            .map(|(id, _)| id.clone())
            .collect();
        ready.sort();
        if !ready.is_empty() {
            for id in &ready {
                entries.remove(id);
            }
            return Json(json!(ready));
        }
        let wait = entries
            .values()
            .copied()
            .min()
            .map(|at| Duration::from_millis(at.saturating_sub(now)))
            .unwrap_or(Duration::from_secs(25));
        drop(entries);
        tokio::select! {
            _ = changed => {},
            _ = tokio::time::sleep(wait) => {},
            _ = tokio::time::sleep_until(deadline) => return Json(json!([])),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn changed_deadline_wakes_poll_and_removal_cancels_work() {
        let state = Arc::new(Schedules::default());
        let task_state = state.clone();
        let poll = tokio::spawn(async move { due(State(task_state)).await.0 });
        tokio::task::yield_now().await;
        let _ = set(
            State(state.clone()),
            Path("cancelled".into()),
            Json(Schedule {
                due_at: now_ms() + 5000,
            }),
        )
        .await;
        let _ = remove(State(state.clone()), Path("cancelled".into())).await;
        let _ = set(
            State(state),
            Path("ready".into()),
            Json(Schedule { due_at: 0 }),
        )
        .await;
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), poll)
                .await
                .unwrap()
                .unwrap(),
            json!(["ready"])
        );
    }
}
