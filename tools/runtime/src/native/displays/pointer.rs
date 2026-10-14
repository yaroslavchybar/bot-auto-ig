use super::{Displays, Failure, Result};
use axum::extract::{
    ws::{Message, WebSocketUpgrade},
    Path, State,
};
use axum::http::HeaderMap;
use axum::response::Response;
#[cfg(any(target_os = "linux", test))]
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

#[cfg(any(target_os = "linux", test))]
#[derive(Deserialize)]
struct Position {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(any(target_os = "linux", test))]
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum WheelDirection {
    Up,
    Down,
}

#[cfg(any(target_os = "linux", test))]
impl WheelDirection {
    fn button(&self) -> u8 {
        match self {
            Self::Up => 4,
            Self::Down => 5,
        }
    }
}

#[cfg(any(target_os = "linux", test))]
#[derive(Deserialize)]
struct PointerInput {
    #[serde(flatten)]
    position: Position,
    wheel: Option<WheelDirection>,
}

// Chrome's client area contains the toolbar above the viewport. Use real X11
// geometry, not fingerprint-spoofed screen coordinates or a fixed toolbar inset.
#[cfg(any(target_os = "linux", test))]
fn coordinates(position: &Position, width: u16, height: u16) -> Result<(i16, i16)> {
    let Position {
        x,
        y,
        width: viewport_width,
        height: viewport_height,
    } = *position;
    if ![x, y, viewport_width, viewport_height]
        .iter()
        .all(|v| v.is_finite())
        || viewport_width < 1.0
        || viewport_height < 1.0
        || width == 0
        || height == 0
        || width > i16::MAX as u16
        || height > i16::MAX as u16
    {
        return Err(Failure::invalid("Invalid pointer coordinates"));
    }
    let scale = f64::from(width) / viewport_width;
    if viewport_height * scale < 1.0 {
        return Err(Failure::invalid("Invalid pointer viewport size"));
    }
    let top = f64::from(height) - viewport_height * scale;
    if top < -1.0 {
        return Err(Failure::unavailable(
            "Browser viewport does not fit its window",
        ));
    }
    // Human curves can briefly overshoot. Keep the native pointer over content.
    let px = (x * scale).round().clamp(0.0, f64::from(width) - 1.0);
    let py = (top.max(0.0) + y * scale)
        .round()
        .clamp(top.max(0.0), f64::from(height) - 1.0);
    Ok((px as i16, py as i16))
}

pub async fn upgrade(
    State(state): State<Arc<Displays>>,
    Path(port): Path<u16>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    let session = state
        .sessions
        .lock()
        .await
        .get(&port)
        .cloned()
        .ok_or_else(|| Failure::missing("Display session not found"))?;
    if headers.get("x-display-id").and_then(|v| v.to_str().ok()) != Some(session.info.id.as_str()) {
        return Err(Failure::missing("Display session ended"));
    }
    Ok(ws
        .max_message_size(4096)
        .on_upgrade(move |mut socket| async move {
            #[cfg(target_os = "linux")]
            let result: Result<()> = async {
                let number = session.info.display_num;
                let mut pointer = tokio::task::spawn_blocking(move || Pointer::open(number))
                    .await
                    .map_err(|_| Failure::unavailable("Desktop pointer failed"))??;
                socket
                    .send(Message::Text(json!({"ready":true}).to_string().into()))
                    .await
                    .map_err(|_| Failure::unavailable("Desktop pointer disconnected"))?;
                while let Some(Ok(message)) = socket.recv().await {
                    let Message::Text(input) = message else {
                        if matches!(message, Message::Close(_)) {
                            break;
                        }
                        continue;
                    };
                    // Never redirect an old connection to a newly reused display port.
                    state.check_session(&session, false).await?;
                    let input: PointerInput = serde_json::from_str(&input)?;
                    pointer = tokio::task::spawn_blocking(move || {
                        pointer.move_to(input.position)?;
                        if let Some(direction) = input.wheel {
                            pointer.wheel_notch(direction)?;
                        }
                        Ok::<_, Failure>(pointer)
                    })
                    .await
                    .map_err(|_| Failure::unavailable("Desktop pointer failed"))??;
                    socket
                        .send(Message::Text(json!({"ready":true}).to_string().into()))
                        .await
                        .map_err(|_| Failure::unavailable("Desktop pointer disconnected"))?;
                }
                Ok(())
            }
            .await;
            #[cfg(not(target_os = "linux"))]
            let result: Result<()> = {
                let _ = (state, session);
                Err(Failure::unavailable("Desktop pointer requires Linux"))
            };
            if let Err(error) = result {
                let _ = socket
                    .send(Message::Text(
                        json!({"error":error.message}).to_string().into(),
                    ))
                    .await;
            }
        }))
}

#[cfg(target_os = "linux")]
struct Pointer {
    connection: x11rb::rust_connection::RustConnection<super::TimedStream>,
    root: u32,
    active: u32,
}

#[cfg(target_os = "linux")]
impl Pointer {
    fn open(number: u16) -> Result<Self> {
        use x11rb::{
            connection::Connection,
            protocol::xproto::ConnectionExt,
            rust_connection::{DefaultStream, RustConnection},
        };
        let socket = std::os::unix::net::UnixStream::connect(format!("/tmp/.X11-unix/X{number}"))?;
        let (stream, _) = DefaultStream::from_unix_stream(socket)?;
        let connection = RustConnection::connect_to_stream(
            super::TimedStream {
                stream,
                deadline: None,
            },
            0,
        )
        .map_err(unavailable)?;
        let root = connection.setup().roots[0].root;
        let active = connection
            .intern_atom(false, b"_NET_ACTIVE_WINDOW")
            .map_err(unavailable)?
            .reply()
            .map_err(unavailable)?
            .atom;
        Ok(Self {
            connection,
            root,
            active,
        })
    }
    fn move_to(&mut self, position: Position) -> Result<()> {
        use x11rb::{
            connection::Connection,
            protocol::xproto::{AtomEnum, ConnectionExt},
        };
        let connection = &self.connection;
        let window = connection
            .get_property(false, self.root, self.active, AtomEnum::WINDOW, 0, 1)
            .map_err(unavailable)?
            .reply()
            .map_err(unavailable)?
            .value32()
            .and_then(|mut v| v.next())
            .filter(|v| *v != 0)
            .ok_or_else(|| Failure::unavailable("Browser window is not active"))?;
        let class = connection
            .get_property(false, window, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 256)
            .map_err(unavailable)?
            .reply()
            .map_err(unavailable)?
            .value;
        let class = String::from_utf8_lossy(&class).to_ascii_lowercase();
        if !class.contains("chrom") && !class.contains("cloak") {
            return Err(Failure::unavailable("Active window is not the browser"));
        }
        let geometry = connection
            .get_geometry(window)
            .map_err(unavailable)?
            .reply()
            .map_err(unavailable)?;
        let (x, y) = coordinates(&position, geometry.width, geometry.height)?;
        connection
            .warp_pointer(x11rb::NONE, window, 0, 0, 0, 0, x, y)
            .map_err(unavailable)?
            .check()
            .map_err(unavailable)?;
        connection.flush().map_err(unavailable)?;
        Ok(())
    }

    // A discrete wheel step uses one X11 button press/release, never a pixel delta.
    fn wheel_notch(&mut self, direction: WheelDirection) -> Result<()> {
        use x11rb::{
            connection::Connection,
            protocol::{xproto, xtest::ConnectionExt},
        };
        let connection = &self.connection;
        let button = direction.button();
        let press = connection
            .xtest_fake_input(xproto::BUTTON_PRESS_EVENT, button, 0, self.root, 0, 0, 0)
            .map_err(unavailable)?;
        let release = connection
            .xtest_fake_input(xproto::BUTTON_RELEASE_EVENT, button, 0, self.root, 0, 0, 0)
            .map_err(unavailable)?;
        // Queue release before waiting for acknowledgements, including a rejected press.
        press.check().map_err(unavailable)?;
        release.check().map_err(unavailable)?;
        connection.flush().map_err(unavailable)?;
        Ok(())
    }
}
#[cfg(target_os = "linux")]
fn unavailable(_: impl std::fmt::Display) -> Failure {
    Failure::unavailable("Desktop pointer unavailable")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wheel_input_accepts_only_discrete_directions() {
        for (direction, button) in [("up", 4), ("down", 5)] {
            let input: PointerInput = serde_json::from_value(json!({
                "x": 120, "y": 250, "width": 1366, "height": 768, "wheel": direction
            }))
            .unwrap();
            assert_eq!(input.wheel.unwrap().button(), button);
            assert_eq!(coordinates(&input.position, 1366, 855).unwrap(), (120, 337));
        }
        for wheel in [json!("left"), json!(120), json!("down,down")] {
            assert!(serde_json::from_value::<PointerInput>(json!({
                "x": 120, "y": 250, "width": 1366, "height": 768, "wheel": wheel
            }))
            .is_err());
        }
        let input: PointerInput = serde_json::from_value(json!({
            "x": 120, "y": 250, "width": 1366, "height": 768
        }))
        .unwrap();
        assert!(input.wheel.is_none());
    }

    #[test]
    fn maps_viewport_to_client_area_with_real_toolbar_height() {
        let mut position = Position {
            x: 120.0,
            y: 250.0,
            width: 1366.0,
            height: 768.0,
        };
        assert_eq!(coordinates(&position, 1366, 855).unwrap(), (120, 337));
        position.width = 683.0;
        position.height = 384.0;
        assert_eq!(coordinates(&position, 1366, 855).unwrap(), (240, 587));
    }
    #[test]
    fn rejects_invalid_geometry() {
        for position in [
            Position {
                x: f64::NAN,
                y: 2.0,
                width: 1366.0,
                height: 768.0,
            },
            Position {
                x: 2.0,
                y: 2.0,
                width: 0.0,
                height: 768.0,
            },
            Position {
                x: 2.0,
                y: 2.0,
                width: 1366.0,
                height: 960.0,
            },
            Position {
                x: 2.0,
                y: 2.0,
                width: 1000000.0,
                height: 1.0,
            },
        ] {
            assert!(coordinates(&position, 1366, 855).is_err());
        }
    }
    #[test]
    fn keeps_curve_overshoots_inside_content() {
        let position = Position {
            x: -30.0,
            y: 800.0,
            width: 1366.0,
            height: 768.0,
        };
        assert_eq!(coordinates(&position, 1366, 855).unwrap(), (0, 854));
    }
}
