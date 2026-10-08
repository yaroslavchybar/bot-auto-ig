use super::processes::Processes;
use super::{Failure, Result};
use crate::api::Api;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};
mod clipboard;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: String,
    pub automation_id: String,
    pub profile_name: String,
    pub vnc_port: u16,
    pub display_num: u16,
    pub status: String,
}
type Preview = Option<(Instant, Arc<[u8]>)>;
#[cfg(test)]
type Capture = Arc<dyn Fn(u16) -> Result<Vec<u8>> + Send + Sync>;
struct Session {
    info: Display,
    preview: Mutex<Preview>,
    clipboard: Mutex<Option<clipboard::Clipboard>>,
}
pub struct Displays {
    #[cfg(target_os = "linux")]
    api: Arc<Api>,
    processes: Arc<Processes>,
    sessions: Arc<Mutex<HashMap<u16, Arc<Session>>>>,
    browsers: Arc<Semaphore>,
    captures: Arc<Semaphore>,
    #[cfg(test)]
    capture: Option<Capture>,
}
impl Displays {
    pub async fn desktop(
        &self,
        operation: &str,
        port: u16,
        request: axum::extract::Request,
    ) -> Result<Response> {
        use axum::{response::IntoResponse, Json};
        let session = self
            .sessions
            .lock()
            .await
            .get(&port)
            .cloned()
            .ok_or_else(|| Failure::missing("Display session not found"))?;
        if request.method() != reqwest::Method::GET
            && self.processes.is_running(&session.info.automation_id).await
        {
            return Err(super::profiles::conflict(
                "Agent still controls this session — stop the agent before pasting or uploading",
            ));
        }
        if operation.ends_with("_file-picker") {
            return self.forward_picker(session, request).await;
        }
        let input = if request.method() == reqwest::Method::POST {
            let body = super::body(request).await?;
            let text = body["text"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| Failure::invalid("text is required"))?;
            if text.encode_utf16().count() > 100_000 {
                return Err(Failure::invalid("Text too large (max 100k chars)"));
            }
            Some(text.to_owned())
        } else {
            None
        };
        let mut clipboard = session.clipboard.lock().await;
        if clipboard.is_none() {
            *clipboard = Some(clipboard::Clipboard::open(session.info.display_num)?);
        }
        let writing = input.is_some();
        let text = match clipboard.as_ref().unwrap().request(input).await {
            Ok(text) => text,
            Err(error) => {
                *clipboard = None;
                return Err(error);
            }
        };
        self.check_session(&session, writing).await?;
        Ok(Json(if writing {
            json!({"success":true})
        } else {
            json!({"text":text})
        })
        .into_response())
    }
    async fn check_session(&self, session: &Arc<Session>, writing: bool) -> Result<()> {
        if !self
            .sessions
            .lock()
            .await
            .get(&session.info.vnc_port)
            .is_some_and(|s| Arc::ptr_eq(s, session))
        {
            return Err(Failure::missing("Display session ended"));
        }
        if writing && self.processes.is_running(&session.info.automation_id).await {
            return Err(super::profiles::conflict("Agent controls this session"));
        }
        Ok(())
    }
    async fn forward_picker(
        &self,
        session: Arc<Session>,
        request: axum::extract::Request,
    ) -> Result<Response> {
        if !matches!(
            *request.method(),
            reqwest::Method::GET | reqwest::Method::POST | reqwest::Method::DELETE
        ) {
            return Err(Failure {
                status: axum::http::StatusCode::METHOD_NOT_ALLOWED,
                message: "Method not allowed".into(),
            });
        }
        let writing = request.method() != reqwest::Method::GET;
        let uri = format!(
            "/{}",
            request
                .uri()
                .query()
                .map(|q| format!("?{q}"))
                .unwrap_or_default()
        );
        let (parts, body) = request.into_parts();
        // Check ownership once more after the final upload chunk, before the chooser sees EOF.
        let stream = picker_stream(
            body,
            self.sessions.clone(),
            self.processes.clone(),
            session.clone(),
            writing,
        );
        let body = axum::body::Body::from_stream(stream);
        let upstream = axum::http::Request::builder()
            .method(parts.method)
            .uri(uri)
            .header("Host", "localhost")
            .header("Content-Type", "application/octet-stream")
            .body(body)
            .unwrap();
        let operation = async {
            let io = picker_io(session.info.vnc_port).await?;
            let (mut sender, connection) =
                hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(io))
                    .await
                    .map_err(|_| Failure::unavailable("Browser file picker unavailable"))?;
            let task = tokio::spawn(async move {
                let _ = connection.await;
            });
            let guard = ConnectionTask(task);
            let response = sender
                .send_request(upstream)
                .await
                .map_err(|_| Failure::unavailable("Browser file picker unavailable"))?;
            self.check_session(&session, writing).await?;
            let status = response.status();
            // Picker replies are bounded JSON, including the long-poll response.
            use http_body_util::BodyExt;
            let bytes = http_body_util::Limited::new(response.into_body(), 64 * 1024)
                .collect()
                .await
                .map_err(|_| Failure::unavailable("Invalid file picker response"))?
                .to_bytes();
            drop(guard);
            Ok(Response::builder()
                .status(status)
                .header("Content-Type", "application/json")
                .header("Cache-Control", "no-store")
                .body(axum::body::Body::from(bytes))
                .unwrap())
        };
        tokio::time::timeout(Duration::from_secs(120), operation)
            .await
            .map_err(|_| Failure::unavailable("Upload timed out"))?
    }
    pub fn new(api: Arc<Api>, processes: Arc<Processes>) -> Arc<Self> {
        let limit = crate::api::env("BROWSER_MAX_CONCURRENCY", "1")
            .parse::<usize>()
            .unwrap_or(1)
            .clamp(1, 64);
        #[cfg(not(target_os = "linux"))]
        let _ = api;
        Arc::new(Self {
            #[cfg(target_os = "linux")]
            api,
            processes,
            sessions: Default::default(),
            browsers: Arc::new(Semaphore::new(limit)),
            captures: Arc::new(Semaphore::new(2)),
            #[cfg(test)]
            capture: None,
        })
    }
    pub async fn list(&self) -> Vec<Display> {
        let mut rows: Vec<_> = self
            .sessions
            .lock()
            .await
            .values()
            .map(|s| s.info.clone())
            .collect();
        rows.sort_by(|a, b| {
            (&a.automation_id, &a.profile_name).cmp(&(&b.automation_id, &b.profile_name))
        });
        rows
    }
    pub async fn resolve(&self, port: u16) -> Result<Value> {
        let session = self
            .sessions
            .lock()
            .await
            .get(&port)
            .cloned()
            .ok_or_else(|| Failure::missing("Display session not found"))?;
        let mut value = serde_json::to_value(&session.info)?;
        value["agentActive"] = json!(self.processes.is_running(&session.info.automation_id).await);
        Ok(value)
    }
    pub async fn preview(&self, port: u16) -> Result<Response> {
        let session = self
            .sessions
            .lock()
            .await
            .get(&port)
            .cloned()
            .ok_or_else(|| Failure::missing("Display session not found"))?;
        let mut cache = session.preview.lock().await;
        let bytes = if let Some((expires, bytes)) = cache
            .as_ref()
            .filter(|(expires, _)| *expires > Instant::now())
        {
            let _ = expires;
            bytes.clone()
        } else {
            let permit = self
                .captures
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| Failure::unavailable("Display controller stopped"))?;
            if !self
                .sessions
                .lock()
                .await
                .get(&port)
                .is_some_and(|active| Arc::ptr_eq(active, &session))
            {
                return Err(Failure::missing("Display session ended"));
            }
            let number = session.info.display_num;
            #[cfg(test)]
            let capture_override = self.capture.clone();
            let bytes: Arc<[u8]> = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                #[cfg(test)]
                if let Some(capture) = capture_override {
                    return capture(number);
                }
                capture(number)
            })
            .await
            .map_err(|_| Failure::unavailable("Preview capture failed"))??
            .into();
            *cache = Some((Instant::now() + Duration::from_secs(8), bytes.clone()));
            bytes
        };
        if !self
            .sessions
            .lock()
            .await
            .get(&port)
            .is_some_and(|active| Arc::ptr_eq(active, &session))
        {
            return Err(Failure::missing("Display session ended"));
        }
        Ok(Response::builder()
            .header("Content-Type", "image/jpeg")
            .header("Cache-Control", "no-store")
            .body(axum::body::Body::from(bytes.to_vec()))
            .unwrap())
    }
}
struct ConnectionTask(tokio::task::JoinHandle<()>);
impl Drop for ConnectionTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}
fn picker_stream(
    body: axum::body::Body,
    sessions: Arc<Mutex<HashMap<u16, Arc<Session>>>>,
    processes: Arc<Processes>,
    session: Arc<Session>,
    writing: bool,
) -> impl futures_util::Stream<Item = Result<axum::body::Bytes>> {
    use futures_util::StreamExt;
    futures_util::stream::try_unfold(
        (body.into_data_stream(), sessions, processes, session),
        move |(mut body, sessions, processes, session)| async move {
            match body.next().await {
                Some(Ok(bytes)) => Ok(Some((bytes, (body, sessions, processes, session)))),
                Some(Err(_)) => Err(Failure::invalid("Incomplete upload")),
                None => {
                    if !sessions
                        .lock()
                        .await
                        .get(&session.info.vnc_port)
                        .is_some_and(|s| Arc::ptr_eq(s, &session))
                    {
                        return Err(Failure::missing("Display session ended"));
                    }
                    if writing && processes.is_running(&session.info.automation_id).await {
                        return Err(super::profiles::conflict("Agent controls this session"));
                    }
                    Ok(None)
                }
            }
        },
    )
}
#[cfg(unix)]
async fn picker_io(port: u16) -> Result<tokio::net::UnixStream> {
    Ok(tokio::net::UnixStream::connect(
        std::env::temp_dir().join(format!("ig-bot-picker-{port}.sock")),
    )
    .await?)
}
#[cfg(windows)]
async fn picker_io(port: u16) -> Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    Ok(tokio::net::windows::named_pipe::ClientOptions::new()
        .open(format!(r"\\.\pipe\ig-bot-picker-{port}"))?)
}
pub async fn browser_lease(State(state): State<Arc<Displays>>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |mut socket| async move {
        let acquire = state.browsers.clone().acquire_owned();
        let permit = tokio::select! { permit = acquire => match permit { Ok(permit) => permit, Err(_) => return }, _ = socket.recv() => return };
        if matches!(tokio::time::timeout(Duration::from_secs(5), socket.send(Message::Text(json!({"ready": true}).to_string().into()))).await, Ok(Ok(()))) {
            lifetime(&mut socket).await;
        }
        drop(permit);
    })
}
pub async fn display_lease(State(state): State<Arc<Displays>>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(4096)
        .on_upgrade(move |mut socket| async move {
            let Ok(Some(Ok(Message::Text(input)))) =
                tokio::time::timeout(Duration::from_secs(10), socket.recv()).await
            else {
                return;
            };
            let Ok(input) = serde_json::from_str::<Value>(&input) else {
                return;
            };
            let name = input["profileName"].as_str().unwrap_or("");
            let automation = input["automationId"].as_str().unwrap_or("manual");
            if name.is_empty() || name.len() > 256 || automation.len() > 128 {
                return;
            }
            #[cfg(target_os = "linux")]
            if let Err(error) = linux_lease(state, socket, name, automation).await {
                ig_service_common::service_error("display.lease_failed", &error.message);
            }
            #[cfg(not(target_os = "linux"))]
            {
                let _ = state;
                let _ = socket
                    .send(Message::Text(
                        json!({"ready": true, "display": null}).to_string().into(),
                    ))
                    .await;
                lifetime(&mut socket).await;
            }
        })
}
pub(super) async fn lifetime(socket: &mut WebSocket) {
    let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
    let mut last_message = Instant::now();
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Pong(_))) => { last_message = Instant::now(); },
                Some(Ok(Message::Ping(bytes))) => {
                    last_message = Instant::now();
                    if !matches!(tokio::time::timeout(Duration::from_secs(5), socket.send(Message::Pong(bytes))).await, Ok(Ok(()))) { break; }
                },
                _ => break,
            },
            _ = heartbeat.tick() => {
                if last_message.elapsed() > Duration::from_secs(60) || !matches!(tokio::time::timeout(Duration::from_secs(5), socket.send(Message::Ping(vec![].into()))).await, Ok(Ok(()))) { break; }
            }
        }
    }
}
#[cfg(target_os = "linux")]
async fn linux_lease(
    state: Arc<Displays>,
    mut socket: WebSocket,
    name: &str,
    automation: &str,
) -> Result<()> {
    use std::process::Stdio;
    let session = {
        let mut sessions = state.sessions.lock().await;
        let number = (100..=149)
            .find(|n| !sessions.contains_key(&(n - 99 + 6080)))
            .ok_or_else(|| Failure::unavailable("No browser displays available"))?;
        let info = Display {
            id: uuid::Uuid::new_v4().to_string(),
            automation_id: automation.into(),
            profile_name: name.into(),
            display_num: number,
            vnc_port: number - 99 + 6080,
            status: "active".into(),
        };
        let session = Arc::new(Session {
            info,
            preview: Mutex::new(None),
            clipboard: Mutex::new(None),
        });
        sessions.insert(session.info.vnc_port, session.clone());
        session
    };
    let number = session.info.display_num;
    let rfb = number - 99 + 5900;
    let mut children = Vec::new();
    let result = async {
        let mut command = tokio::process::Command::new("Xtigervnc");
        command.args([format!(":{number}"), "-geometry".into(), "1366x960".into(), "-depth".into(), "24".into(), "-rfbport".into(), rfb.to_string(), "-SecurityTypes".into(), "None".into(), "-AlwaysShared".into(), "-localhost=1".into(), "-SendPrimary=0".into(), "-SetPrimary=0".into()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).process_group(0).kill_on_drop(true);
        let child = command.spawn().map_err(|_| Failure::unavailable("Could not start display"))?; let pid = child.id().unwrap(); children.push((pid, child)); state.processes.track_resource(pid).await?;
        let mut ready = false;
        for _ in 0..50 {
            if children[0].1.try_wait()?.is_some() { return Err(Failure::unavailable("Display stopped during startup")); }
            if matches!(tokio::time::timeout(Duration::from_millis(250), tokio::net::TcpStream::connect(("127.0.0.1", rfb))).await, Ok(Ok(_))) { ready = true; break; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !ready { return Err(Failure::unavailable("Display startup timed out")); }
        let child = tokio::process::Command::new("fluxbox").args(["-display", &format!(":{number}")]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).process_group(0).kill_on_drop(true).spawn().map_err(|_| Failure::unavailable("Could not start window manager"))?;
        let pid = child.id().unwrap(); children.push((pid, child)); state.processes.track_resource(pid).await?;
        socket.send(Message::Text(json!({"ready": true, "display": session.info}).to_string().into())).await.map_err(|_| Failure::unavailable("Display owner disconnected"))?;
        let _ = state.api.events.send(json!({"type": "display_allocated", "automationId": automation, "profileName": name, "vncPort": session.info.vnc_port, "displayNum": number}));
        let mut health = tokio::time::interval(Duration::from_secs(2));
        let owner = lifetime(&mut socket); tokio::pin!(owner);
        loop { tokio::select! { _ = &mut owner => break, _ = health.tick() => { if children.iter_mut().any(|(_, child)| !matches!(child.try_wait(), Ok(None))) { break; } } } }
        Ok(())
    }.await;
    for (pid, mut child) in children {
        super::processes::kill_tree(pid, false).await;
        if tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .is_err()
        {
            super::processes::kill_tree(pid, true).await;
            let _ = child.kill().await;
        }
        state.processes.forget_resource(pid).await;
    }
    state.sessions.lock().await.remove(&session.info.vnc_port);
    let _ = state.api.events.send(json!({"type": "display_released", "automationId": automation, "profileName": name, "vncPort": session.info.vnc_port}));
    result
}
#[cfg(not(target_os = "linux"))]
fn capture(_: u16) -> Result<Vec<u8>> {
    Err(Failure::unavailable("Desktop previews require Linux"))
}

#[cfg(target_os = "linux")]
fn capture(number: u16) -> Result<Vec<u8>> {
    use x11rb::{
        connection::Connection,
        protocol::xproto::{ConnectionExt, ImageFormat, ImageOrder},
        rust_connection::{DefaultStream, RustConnection},
    };
    let socket = std::os::unix::net::UnixStream::connect(format!("/tmp/.X11-unix/X{number}"))?;
    let (stream, _) = DefaultStream::from_unix_stream(socket)?;
    let connection = RustConnection::connect_to_stream(
        TimedStream {
            stream,
            deadline: Some(Instant::now() + Duration::from_secs(5)),
        },
        0,
    )
    .map_err(|_| Failure::unavailable("Preview display connection failed"))?;
    let setup = connection.setup();
    let screen = &setup.roots[0];
    let width = screen.width_in_pixels;
    let height = screen.height_in_pixels;
    if u64::from(width) * u64::from(height) > 12_000_000 {
        return Err(Failure::unavailable("Display dimensions are too large"));
    }
    let format = setup
        .pixmap_formats
        .iter()
        .find(|f| f.depth == screen.root_depth)
        .ok_or_else(|| Failure::unavailable("Unsupported display format"))?;
    let visual = screen
        .allowed_depths
        .iter()
        .flat_map(|d| &d.visuals)
        .find(|v| v.visual_id == screen.root_visual)
        .ok_or_else(|| Failure::unavailable("Display visual unavailable"))?;
    let reply = connection
        .get_image(
            ImageFormat::Z_PIXMAP,
            screen.root,
            0,
            0,
            width,
            height,
            u32::MAX,
        )
        .map_err(|_| Failure::unavailable("Preview capture failed"))?
        .reply()
        .map_err(|_| Failure::unavailable("Preview capture failed"))?;
    let stride = (usize::from(width) * usize::from(format.bits_per_pixel))
        .div_ceil(usize::from(format.scanline_pad))
        * usize::from(format.scanline_pad)
        / 8;
    let rgb = rgb(
        &reply.data,
        width.into(),
        height.into(),
        stride,
        format.bits_per_pixel,
        setup.image_byte_order == ImageOrder::LSB_FIRST,
        [visual.red_mask, visual.green_mask, visual.blue_mask],
    )?;
    let image = image::RgbImage::from_raw(width.into(), height.into(), rgb)
        .ok_or_else(|| Failure::unavailable("Invalid display frame"))?;
    let image = image::DynamicImage::ImageRgb8(image)
        .resize(480, 960, image::imageops::FilterType::Triangle)
        .to_rgb8();
    let mut bytes = Vec::new();
    jpeg_encoder::Encoder::new(&mut bytes, 65)
        .encode(
            image.as_raw(),
            image.width() as u16,
            image.height() as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|_| Failure::unavailable("Preview encoding failed"))?;
    Ok(bytes)
}
#[cfg(target_os = "linux")]
pub(super) struct TimedStream {
    stream: x11rb::rust_connection::DefaultStream,
    deadline: Option<Instant>,
}
#[cfg(target_os = "linux")]
impl x11rb::rust_connection::Stream for TimedStream {
    fn poll(&self, mode: x11rb::rust_connection::PollMode) -> std::io::Result<()> {
        use std::os::fd::AsRawFd;
        loop {
            let remaining = self
                .deadline
                .map(|deadline| deadline.saturating_duration_since(Instant::now()))
                .unwrap_or(Duration::from_secs(5))
                .as_millis()
                .min(i32::MAX as u128) as i32;
            if remaining == 0 {
                return Err(std::io::ErrorKind::TimedOut.into());
            }
            let mut fd = libc::pollfd {
                fd: self.stream.as_raw_fd(),
                events: (if mode.readable() { libc::POLLIN } else { 0 })
                    | (if mode.writable() { libc::POLLOUT } else { 0 }),
                revents: 0,
            };
            let result = unsafe { libc::poll(&mut fd, 1, remaining) };
            if result > 0 {
                return Ok(());
            }
            if result == 0 {
                return Err(std::io::ErrorKind::TimedOut.into());
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
    fn read(
        &self,
        bytes: &mut [u8],
        fds: &mut Vec<x11rb::utils::RawFdContainer>,
    ) -> std::io::Result<usize> {
        self.stream.read(bytes, fds)
    }
    fn write(
        &self,
        bytes: &[u8],
        fds: &mut Vec<x11rb::utils::RawFdContainer>,
    ) -> std::io::Result<usize> {
        self.stream.write(bytes, fds)
    }
}
#[cfg(any(target_os = "linux", test))]
fn rgb(
    bytes: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    bits: u8,
    little: bool,
    masks: [u32; 3],
) -> Result<Vec<u8>> {
    let size = usize::from(bits / 8);
    if !matches!(size, 2..=4)
        || stride < width * size
        || bytes.len() < stride * height
        || masks.contains(&0)
    {
        return Err(Failure::unavailable("Invalid display pixel format"));
    }
    let mut rgb = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        for x in 0..width {
            let pixel = &bytes[y * stride + x * size..y * stride + (x + 1) * size];
            let mut value = 0u32;
            for (i, byte) in pixel.iter().enumerate() {
                value |= u32::from(*byte) << (8 * if little { i } else { size - i - 1 });
            }
            for mask in masks {
                let shift = mask.trailing_zeros();
                let max = mask >> shift;
                rgb.push((u64::from((value & mask) >> shift) * 255 / u64::from(max)) as u8);
            }
        }
    }
    Ok(rgb)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    fn session(port: u16) -> Arc<Session> {
        Arc::new(Session {
            info: Display {
                id: uuid::Uuid::new_v4().to_string(),
                automation_id: "manual".into(),
                profile_name: "p".into(),
                vnc_port: port,
                display_num: 100,
                status: "active".into(),
            },
            preview: Mutex::new(None),
            clipboard: Mutex::new(None),
        })
    }
    fn state(
        capture: Arc<dyn Fn(u16) -> Result<Vec<u8>> + Send + Sync>,
    ) -> (tempfile::TempDir, Arc<Displays>) {
        let root = tempfile::tempdir().unwrap();
        let api = Arc::new(Api::from_env().unwrap());
        let processes = Processes::new(api.clone(), root.path().into());
        let mut state = Displays::new(api, processes);
        Arc::get_mut(&mut state).unwrap().capture = Some(capture);
        (root, state)
    }
    #[tokio::test]
    async fn file_picker_streams_to_the_browser_and_rejects_an_ended_session_before_eof() {
        use axum::{body::Body, extract::Request};
        use std::convert::Infallible;
        for stale in [false, true] {
            let port = if stale { 45002 } else { 45001 };
            let (_root, state) = state(Arc::new(|_| Ok(vec![])));
            let active = session(port);
            state.sessions.lock().await.insert(port, active.clone());
            #[cfg(windows)]
            let listener = tokio::net::windows::named_pipe::ServerOptions::new()
                .create(format!(r"\\.\pipe\ig-bot-picker-{port}"))
                .unwrap();
            #[cfg(unix)]
            let path = std::env::temp_dir().join(format!("ig-bot-picker-{port}.sock"));
            #[cfg(unix)]
            let listener = tokio::net::UnixListener::bind(&path).unwrap();
            let server = tokio::spawn(async move {
                #[cfg(windows)]
                let io = {
                    listener.connect().await.unwrap();
                    listener
                };
                #[cfg(unix)]
                let io = listener.accept().await.unwrap().0;
                let service = hyper::service::service_fn(
                    move |request: hyper::Request<hyper::body::Incoming>| async move {
                        assert_eq!(request.uri().to_string(), "/?id=chooser");
                        let bytes =
                            axum::body::to_bytes(Body::new(request.into_body()), 1024).await;
                        let response = if stale {
                            assert!(
                                bytes.is_err(),
                                "stale uploads must not reach a successful EOF"
                            );
                            json!({"error":"ended"})
                        } else {
                            assert_eq!(bytes.unwrap().as_ref(), b"streamed bytes");
                            json!({"success":true})
                        };
                        Ok::<_, Infallible>(Response::new(Body::from(response.to_string())))
                    },
                );
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(hyper_util::rt::TokioIo::new(io), service)
                    .await;
            });
            let sessions = state.sessions.clone();
            let body = Body::from_stream(futures_util::stream::unfold(0, move |step| {
                let sessions = sessions.clone();
                async move {
                    if step == 0 {
                        Some((
                            Ok::<_, std::io::Error>(axum::body::Bytes::from_static(
                                b"streamed bytes",
                            )),
                            1,
                        ))
                    } else {
                        if stale {
                            sessions.lock().await.remove(&port);
                        }
                        None
                    }
                }
            }));
            let request = Request::builder()
                .method("POST")
                .uri("/api/displays/45001/file-picker?id=chooser")
                .body(body)
                .unwrap();
            let result = state.forward_picker(active, request).await;
            if stale {
                assert!(result.is_err());
            } else {
                assert_eq!(result.unwrap().status(), axum::http::StatusCode::OK);
            }
            if tokio::time::timeout(Duration::from_secs(2), &mut Box::pin(server))
                .await
                .is_err()
            {
                panic!("Picker server did not stop");
            }
            #[cfg(unix)]
            std::fs::remove_file(path).unwrap();
        }
    }
    #[tokio::test]
    async fn previews_share_pending_capture_cache_expire_and_never_reuse_an_old_session() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let (_root, state) = state(Arc::new(move |_| {
            seen.fetch_add(1, Ordering::Relaxed);
            std::thread::sleep(Duration::from_millis(10));
            Ok(vec![1, 2, 3])
        }));
        let first = session(6081);
        state.sessions.lock().await.insert(6081, first.clone());
        let (a, b) = tokio::join!(state.preview(6081), state.preview(6081));
        assert!(a.is_ok() && b.is_ok());
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        *first.preview.lock().await =
            Some((Instant::now() - Duration::from_secs(1), vec![1].into()));
        state.preview(6081).await.unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        state.sessions.lock().await.insert(6081, session(6081));
        state.preview(6081).await.unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 3);
        state.sessions.lock().await.remove(&6081);
        assert!(state.preview(6081).await.is_err());
    }
    #[tokio::test]
    async fn capture_limit_is_two_and_ended_queued_sessions_skip_capture() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let (_root, state) = state(Arc::new(move |_| {
            seen.fetch_add(1, Ordering::Relaxed);
            Ok(vec![1])
        }));
        for port in [6081, 6082, 6083] {
            state.sessions.lock().await.insert(port, session(port));
        }
        let a = state.captures.acquire().await.unwrap();
        let b = state.captures.acquire().await.unwrap();
        let cloned = state.clone();
        let queued = tokio::spawn(async move { cloned.preview(6083).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!queued.is_finished());
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        state.sessions.lock().await.remove(&6083);
        drop(a);
        assert!(queued.await.unwrap().is_err());
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        drop(b);
        state.preview(6081).await.unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }
    #[test]
    fn pixels_handle_padding_byte_order_and_rgb565() {
        assert_eq!(
            rgb(
                &[0, 0, 255, 0, 0, 255, 0, 0],
                2,
                1,
                8,
                32,
                true,
                [0xff0000, 0xff00, 0xff]
            )
            .unwrap(),
            vec![255, 0, 0, 0, 255, 0]
        );
        assert_eq!(
            rgb(
                &[0xf8, 0x00, 0, 0],
                1,
                1,
                4,
                16,
                false,
                [0xf800, 0x7e0, 0x1f]
            )
            .unwrap(),
            vec![255, 0, 0]
        );
        assert!(rgb(&[], 1, 1, 4, 32, true, [1, 2, 4]).is_err());
    }
}
