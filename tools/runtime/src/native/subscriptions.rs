use super::{Failure, Result};
use crate::api::Api;
use axum::{
    extract::{
        ws::{Message, WebSocketUpgrade},
        State,
    },
    response::{IntoResponse, Response},
};
use convex::{ConvexClient, FunctionResult, QuerySubscription};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::sync::{Mutex, Semaphore};

pub struct Subscriptions {
    api: Arc<Api>,
    client: Mutex<Option<ConvexClient>>,
    slots: Arc<Semaphore>,
}
impl Subscriptions {
    pub fn new(api: Arc<Api>) -> Arc<Self> {
        Arc::new(Self {
            api,
            client: Mutex::new(None),
            slots: Arc::new(Semaphore::new(1000)),
        })
    }
    pub async fn subscribe(&self, name: &str, args: Value) -> Result<QuerySubscription> {
        if !allowed(name) {
            return Err(Failure::invalid("Unknown subscription"));
        }
        let mut fields = args
            .as_object()
            .cloned()
            .ok_or_else(|| Failure::invalid("Subscription arguments must be an object"))?;
        fields.insert("bridgeToken".into(), json!(self.api.key));
        let args: BTreeMap<_, _> = fields
            .into_iter()
            .map(|(k, v)| convex::Value::try_from(v).map(|v| (k, v)))
            .collect::<std::result::Result<_, _>>()
            .map_err(|_| Failure::invalid("Invalid subscription arguments"))?;
        let mut client = self.client.lock().await;
        if client.is_none() {
            let url = self.api.convex_url.replace(".convex.site", ".convex.cloud");
            if url.is_empty() || self.api.key.is_empty() {
                return Err(Failure::unavailable("Convex is not configured"));
            }
            *client = Some(
                ConvexClient::new(&url)
                    .await
                    .map_err(|_| Failure::unavailable("Convex subscription connection failed"))?,
            );
        }
        client
            .as_mut()
            .unwrap()
            .subscribe(name, args)
            .await
            .map_err(|_| Failure::unavailable("Convex subscription failed"))
    }
}
pub fn value(result: FunctionResult) -> Result<Value> {
    match result {
        FunctionResult::Value(value) => {
            let mut value: Value = value.into();
            normalize_numbers(&mut value);
            Ok(value)
        }
        _ => Err(Failure::unavailable("Convex query failed")),
    }
}
// Convex represents all numbers as f64. Native timestamps and counters use integers.
fn normalize_numbers(value: &mut Value) {
    match value {
        Value::Number(number) => {
            if let Some(n) = number
                .as_f64()
                .filter(|n| n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0)
            {
                *value = json!(n as i64);
            }
        }
        Value::Array(values) => {
            for value in values {
                normalize_numbers(value);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                normalize_numbers(value);
            }
        }
        _ => {}
    }
}
fn allowed(name: &str) -> bool {
    matches!(
        name,
        "scraper:work"
            | "profiles/queries:maintenanceWork"
            | "profiles/queries:chatWorkerProfiles"
            | "igAccounts:loginWork"
            | "automations/queries:runtimeSnapshot"
            | "routines:access"
            | "automations/queries:listRoutinesForScheduler"
    )
}
#[cfg(test)]
mod tests;

/// A local socket owns its upstream subscription; dropping it unsubscribes at Convex.
pub async fn upgrade(State(state): State<Arc<Subscriptions>>, ws: WebSocketUpgrade) -> Response {
    let Ok(permit) = state.slots.clone().try_acquire_owned() else {
        return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    ws.max_message_size(1024 * 1024).max_frame_size(1024 * 1024).on_upgrade(move |mut socket| async move {
        let _permit = permit;
        let input = tokio::time::timeout(Duration::from_secs(10), socket.recv()).await;
        let Ok(Some(Ok(Message::Text(input)))) = input else { return; };
        let Ok(input) = serde_json::from_str::<Value>(&input) else { return; };
        let name = input["name"].as_str().unwrap_or("");
        let mut subscription = match state.subscribe(name, input["args"].clone()).await {
            Ok(subscription) => subscription,
            Err(_) => { let _ = socket.send(Message::Text(json!({"error": "Convex subscription failed"}).to_string().into())).await; return; }
        };
        let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
        let mut alive = std::time::Instant::now();
        loop {
            tokio::select! {
                incoming = socket.recv() => match incoming { Some(Ok(Message::Ping(bytes))) => { alive = std::time::Instant::now(); if socket.send(Message::Pong(bytes)).await.is_err() { break; } }, Some(Ok(Message::Pong(_))) => { alive = std::time::Instant::now(); }, _ => break },
                _ = heartbeat.tick() => {
                    if alive.elapsed() > Duration::from_secs(60) || !matches!(tokio::time::timeout(Duration::from_secs(5), socket.send(Message::Ping(vec![].into()))).await, Ok(Ok(()))) { break; }
                },
                update = subscription.next() => {
                    let Some(update) = update else { break; };
                    let update = match value(update) { Ok(value) => json!({"value": value}), Err(_) => json!({"error": "Convex query failed"}) };
                    if !matches!(tokio::time::timeout(Duration::from_secs(10), socket.send(Message::Text(update.to_string().into()))).await, Ok(Ok(()))) { break; }
                }
            }
        }
    })
}
