use super::Api;
use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocketUpgrade},
        Query, State,
    },
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use std::{collections::HashMap, time::Duration};
use tokio_tungstenite::tungstenite::{self, client::IntoClientRequest};

pub async fn upgrade(
    State(state): State<Api>,
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
        .filter(|topic| ["displays", "chat"].contains(&topic.as_str()))
        .map(String::as_str)
        .unwrap_or("all");
    let mut request = format!(
        "{}/events?topic={topic}",
        state.worker_url.replace("http://", "ws://")
    )
    .into_client_request()
    .unwrap();
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {}", state.key).parse().unwrap(),
    );
    let worker = match tokio::time::timeout(
        Duration::from_secs(5),
        tokio_tungstenite::connect_async(request),
    )
    .await
    {
        Ok(Ok((worker, _))) => worker,
        _ => return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    ws.max_message_size(1024 * 1024)
        .max_frame_size(1024 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            let (mut client_write, mut client_read) = socket.split();
            let (mut worker_write, mut worker_read) = worker.split();
            let to_client = async {
                while let Some(Ok(message)) = worker_read.next().await {
                    let message = match message {
                        tungstenite::Message::Text(value) => Message::Text(value.as_str().into()),
                        tungstenite::Message::Binary(value) => Message::Binary(value),
                        tungstenite::Message::Ping(value) => Message::Ping(value),
                        tungstenite::Message::Pong(value) => Message::Pong(value),
                        _ => break,
                    };
                    if !matches!(
                        tokio::time::timeout(Duration::from_secs(10), client_write.send(message))
                            .await,
                        Ok(Ok(()))
                    ) {
                        break;
                    }
                }
            };
            let to_worker = async {
                while let Some(Ok(message)) = client_read.next().await {
                    let message = match message {
                        Message::Text(value) => tungstenite::Message::Text(value.as_str().into()),
                        Message::Binary(value) => tungstenite::Message::Binary(value),
                        Message::Ping(value) => tungstenite::Message::Ping(value),
                        Message::Pong(value) => tungstenite::Message::Pong(value),
                        _ => break,
                    };
                    if !matches!(
                        tokio::time::timeout(Duration::from_secs(10), worker_write.send(message))
                            .await,
                        Ok(Ok(()))
                    ) {
                        break;
                    }
                }
            };
            tokio::select! { _ = to_client => {}, _ = to_worker => {} }
        })
}
