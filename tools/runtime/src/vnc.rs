use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::Semaphore,
};

#[derive(Clone)]
pub struct Gateway {
    pub connections: Arc<Semaphore>,
}

pub fn rfb_port(port: u16) -> Option<u16> {
    (6081..=6130).contains(&port).then(|| port - 180)
}

pub async fn upgrade(
    State(state): State<Gateway>,
    Path(port): Path<u16>,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(port) = rfb_port(port) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(permit) = state.connections.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(Ok(tcp)) = tokio::time::timeout(
        Duration::from_secs(5),
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    let _ = tcp.set_nodelay(true);
    ws.protocols(["binary"])
        .read_buffer_size(16 * 1024)
        .max_message_size(1024 * 1024)
        .max_frame_size(1024 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            relay(socket, tcp).await;
        })
}

/// Await every write so slow viewers cannot build an unbounded frame queue.
async fn relay(socket: WebSocket, tcp: TcpStream) {
    let (mut sender, mut receiver) = socket.split();
    let (mut read, mut write) = tcp.into_split();
    let to_tcp = async {
        while let Some(Ok(message)) = receiver.next().await {
            match message {
                Message::Binary(bytes) => {
                    if !matches!(
                        tokio::time::timeout(Duration::from_secs(30), write.write_all(&bytes))
                            .await,
                        Ok(Ok(()))
                    ) {
                        break;
                    }
                }
                Message::Close(_) | Message::Text(_) => break,
                _ => {}
            }
        }
    };
    let to_websocket = async {
        let mut buffer = vec![0u8; 64 * 1024];
        let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
        loop {
            let message = tokio::select! {
                result = read.read(&mut buffer) => match result {
                    Ok(0) | Err(_) => break,
                    Ok(size) => Message::Binary(buffer[..size].to_vec().into()),
                },
                _ = heartbeat.tick() => Message::Ping(Vec::new().into()),
            };
            if !matches!(
                tokio::time::timeout(Duration::from_secs(30), sender.send(message)).await,
                Ok(Ok(()))
            ) {
                break;
            }
        }
    };
    tokio::select! { _ = to_tcp => {}, _ = to_websocket => {} }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_allocated_display_range_can_be_forwarded() {
        assert_eq!(rfb_port(6081), Some(5901));
        assert_eq!(rfb_port(6130), Some(5950));
        assert_eq!(rfb_port(6080), None);
        assert_eq!(rfb_port(22), None);
    }
}
