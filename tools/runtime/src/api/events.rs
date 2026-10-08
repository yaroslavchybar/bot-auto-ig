use super::Api;
use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocketUpgrade},
        Query, State,
    },
    response::{IntoResponse, Response},
};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

pub async fn upgrade(
    State(state): State<Arc<Api>>,
    Query(query): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Response {
    let token = query.get("token").map(String::as_str).unwrap_or("");
    let rejection = if !state.auth.bypass && token.is_empty() {
        Some((4001, "Missing auth token"))
    } else if !state.auth.bypass && state.auth.verify(token).is_none() {
        Some((4003, "Invalid auth token"))
    } else {
        None
    };
    if let Some((code, reason)) = rejection {
        return ws.on_upgrade(move |mut socket| async move {
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code,
                    reason: reason.into(),
                })))
                .await;
        });
    }
    let Ok(permit) = state.sockets.clone().try_acquire_owned() else {
        return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let topic = query
        .get("topic")
        .filter(|s| ["chat", "displays"].contains(&s.as_str()))
        .cloned()
        .unwrap_or_else(|| "all".into());
    let mut events = state.events.subscribe();
    ws.read_buffer_size(16*1024).max_message_size(1024*1024).max_frame_size(1024*1024).on_upgrade(move |mut socket| async move {
        let _permit=permit;
        let mut heartbeat=tokio::time::interval(Duration::from_secs(20)); let mut alive=Instant::now();
        loop {
            tokio::select! {
                event=events.recv() => {
                    let Ok(event)=event else { break; };
                    if !matches_topic(&event,&topic) { continue; }
                    if !matches!(tokio::time::timeout(Duration::from_secs(5),socket.send(Message::Text(event.to_string().into()))).await,Ok(Ok(()))) { break; }
                },
                incoming=socket.recv() => match incoming {
                    Some(Ok(Message::Pong(_))) => { alive=Instant::now(); },
                    Some(Ok(Message::Ping(bytes))) => {
                        alive=Instant::now();
                        if !matches!(tokio::time::timeout(Duration::from_secs(5), socket.send(Message::Pong(bytes))).await, Ok(Ok(()))) { break; }
                    },
                    Some(Ok(Message::Text(_))) => {}, // The public event feed is read-only.
                    _=>break,
                },
                _=heartbeat.tick() => {
                    if alive.elapsed()>Duration::from_secs(60) || !matches!(tokio::time::timeout(Duration::from_secs(5),socket.send(Message::Ping(vec![].into()))).await,Ok(Ok(()))) { break; }
                }
            }
        }
    })
}
fn matches_topic(value: &serde_json::Value, topic: &str) -> bool {
    let kind = value["type"].as_str().unwrap_or("");
    topic == "all"
        || topic == "chat" && kind == "chat_changed"
        || topic == "displays"
            && matches!(
                kind,
                "display_allocated"
                    | "display_released"
                    | "profile_completed"
                    | "automation_status"
            )
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn topics_filter_private_events() {
        for kind in [
            "display_allocated",
            "display_released",
            "profile_completed",
            "automation_status",
        ] {
            assert!(matches_topic(&json!({"type":kind}), "displays"));
            assert!(!matches_topic(&json!({"type":kind}), "chat"));
        }
        assert!(matches_topic(&json!({"type":"chat_changed"}), "chat"));
        assert!(!matches_topic(&json!({"type":"task_started"}), "displays"));
        assert!(matches_topic(&json!({"type":"task_started"}), "all"));
    }
}
