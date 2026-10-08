use super::{Failure, Result};
pub struct Clipboard {
    #[cfg(target_os = "linux")]
    sender: std::sync::mpsc::SyncSender<Command>,
}
#[cfg(target_os = "linux")]
struct Command {
    input: Option<String>,
    reply: tokio::sync::oneshot::Sender<Result<String>>,
}
impl Clipboard {
    pub fn open(number: u16) -> Result<Self> {
        #[cfg(target_os = "linux")]
        {
            let (sender, receiver) = std::sync::mpsc::sync_channel(16);
            std::thread::Builder::new()
                .name(format!("clipboard-{number}"))
                .spawn(move || {
                    if let Err(e) = run(number, receiver) {
                        ig_service_common::service_error("display.clipboard_failed", &e.message);
                    }
                })
                .map_err(|_| Failure::unavailable("Clipboard thread unavailable"))?;
            Ok(Self { sender })
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = number;
            Err(Failure::unavailable("Clipboard requires Linux"))
        }
    }
    pub async fn request(&self, input: Option<String>) -> Result<String> {
        #[cfg(target_os = "linux")]
        {
            let (reply, receiver) = tokio::sync::oneshot::channel();
            self.sender
                .try_send(Command { input, reply })
                .map_err(|_| Failure::unavailable("Clipboard unavailable"))?;
            tokio::time::timeout(std::time::Duration::from_secs(6), receiver)
                .await
                .map_err(|_| Failure::unavailable("Clipboard timed out"))?
                .map_err(|_| Failure::unavailable("Clipboard disconnected"))?
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = input;
            Err(Failure::unavailable("Clipboard requires Linux"))
        }
    }
}
#[cfg(target_os = "linux")]
fn run(number: u16, receiver: std::sync::mpsc::Receiver<Command>) -> Result<()> {
    use std::{
        collections::HashMap,
        time::{Duration, Instant},
    };
    use x11rb::{
        connection::Connection,
        protocol::{
            xproto::{
                self, AtomEnum, ConnectionExt, CreateWindowAux, EventMask, PropMode, WindowClass,
            },
            Event,
        },
        wrapper::ConnectionExt as _,
    };
    let socket = std::os::unix::net::UnixStream::connect(format!("/tmp/.X11-unix/X{number}"))?;
    let (stream, _) = x11rb::rust_connection::DefaultStream::from_unix_stream(socket)?;
    let connection = x11rb::rust_connection::RustConnection::connect_to_stream(
        super::TimedStream {
            stream,
            deadline: None,
        },
        0,
    )
    .map_err(unavailable)?;
    let root = connection.setup().roots[0].root;
    let window = connection.generate_id().map_err(unavailable)?;
    connection
        .create_window(
            0,
            window,
            root,
            0,
            0,
            1,
            1,
            0,
            WindowClass::INPUT_ONLY,
            0,
            &CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE),
        )
        .map_err(unavailable)?
        .check()
        .map_err(unavailable)?;
    let atom = |name: &[u8]| -> Result<u32> {
        Ok(connection
            .intern_atom(false, name)
            .map_err(unavailable)?
            .reply()
            .map_err(unavailable)?
            .atom)
    };
    let selection = atom(b"CLIPBOARD")?;
    let utf8 = atom(b"UTF8_STRING")?;
    let targets = atom(b"TARGETS")?;
    let text_atom = atom(b"TEXT")?;
    let property = atom(b"IG_BOT_CLIPBOARD")?;
    let incr = atom(b"INCR")?;
    let mut text = String::new();
    type Reading = (
        tokio::sync::oneshot::Sender<Result<String>>,
        Instant,
        Vec<u8>,
        bool,
        bool,
    );
    type Outgoing = (Vec<u8>, usize, u32, Instant);
    let mut reading: Option<Reading> = None;
    let mut outgoing: HashMap<(u32, u32), Outgoing> = HashMap::new();
    loop {
        if reading.is_none() {
            match receiver.try_recv() {
                Ok(command) => {
                    if command.reply.is_closed() {
                        continue;
                    }
                    if let Some(input) = command.input {
                        text = input;
                        connection
                            .set_selection_owner(window, selection, x11rb::CURRENT_TIME)
                            .map_err(unavailable)?
                            .check()
                            .map_err(unavailable)?;
                        let owner = connection
                            .get_selection_owner(selection)
                            .map_err(unavailable)?
                            .reply()
                            .map_err(unavailable)?
                            .owner;
                        let _ = command.reply.send(if owner == window {
                            Ok(String::new())
                        } else {
                            Err(Failure::unavailable("Clipboard ownership failed"))
                        });
                    } else {
                        let owner = connection
                            .get_selection_owner(selection)
                            .map_err(unavailable)?
                            .reply()
                            .map_err(unavailable)?
                            .owner;
                        if owner == window || owner == x11rb::NONE {
                            let _ = command.reply.send(Ok(if owner == window {
                                text.clone()
                            } else {
                                String::new()
                            }));
                        } else {
                            connection
                                .convert_selection(
                                    window,
                                    selection,
                                    utf8,
                                    property,
                                    x11rb::CURRENT_TIME,
                                )
                                .map_err(unavailable)?;
                            connection.flush().map_err(unavailable)?;
                            reading = Some((
                                command.reply,
                                Instant::now() + Duration::from_secs(5),
                                Vec::new(),
                                false,
                                false,
                            ));
                        }
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => return Ok(()),
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
            }
        }
        if reading
            .as_ref()
            .is_some_and(|(_, at, _, _, _)| *at < Instant::now())
        {
            let (reply, _, _, _, _) = reading.take().unwrap();
            let _ = reply.send(Err(Failure::unavailable("Clipboard timed out")));
        }
        outgoing.retain(|_, (_, _, _, at)| *at > Instant::now());
        while let Some(event) = connection.poll_for_event().map_err(unavailable)? {
            match event {
                Event::SelectionRequest(event) => {
                    let destination = if event.property == x11rb::NONE {
                        event.target
                    } else {
                        event.property
                    };
                    let success;
                    if event.target == targets {
                        success = connection
                            .change_property32(
                                PropMode::REPLACE,
                                event.requestor,
                                destination,
                                AtomEnum::ATOM,
                                &[targets, utf8, text_atom, AtomEnum::STRING.into()],
                            )
                            .map_err(unavailable)?
                            .check()
                            .is_ok();
                    } else if [utf8, text_atom, AtomEnum::STRING.into()].contains(&event.target) {
                        let bytes = if event.target == u32::from(AtomEnum::STRING) {
                            text.chars()
                                .map(|c| u8::try_from(c as u32).unwrap_or(b'?'))
                                .collect()
                        } else {
                            text.as_bytes().to_vec()
                        };
                        if bytes.len() > 48 * 1024 {
                            if outgoing.len() >= 32 {
                                success = false;
                            } else {
                                connection
                                    .change_window_attributes(
                                        event.requestor,
                                        &xproto::ChangeWindowAttributesAux::new()
                                            .event_mask(EventMask::PROPERTY_CHANGE),
                                    )
                                    .map_err(unavailable)?;
                                success = connection
                                    .change_property32(
                                        PropMode::REPLACE,
                                        event.requestor,
                                        destination,
                                        incr,
                                        &[bytes.len() as u32],
                                    )
                                    .map_err(unavailable)?
                                    .check()
                                    .is_ok();
                                if success {
                                    outgoing.insert(
                                        (event.requestor, destination),
                                        (
                                            bytes,
                                            0,
                                            event.target,
                                            Instant::now() + Duration::from_secs(10),
                                        ),
                                    );
                                }
                            }
                        } else {
                            success = connection
                                .change_property8(
                                    PropMode::REPLACE,
                                    event.requestor,
                                    destination,
                                    event.target,
                                    &bytes,
                                )
                                .map_err(unavailable)?
                                .check()
                                .is_ok();
                        }
                    } else {
                        success = false;
                    }
                    let notify = xproto::SelectionNotifyEvent {
                        response_type: xproto::SELECTION_NOTIFY_EVENT,
                        sequence: 0,
                        time: event.time,
                        requestor: event.requestor,
                        selection: event.selection,
                        target: event.target,
                        property: if success { destination } else { x11rb::NONE },
                    };
                    let _ = connection
                        .send_event(false, event.requestor, EventMask::NO_EVENT, notify)
                        .map_err(unavailable)?
                        .check();
                }
                Event::SelectionClear(_) => text.clear(),
                Event::SelectionNotify(event) if event.requestor == window && reading.is_some() => {
                    if event.property == x11rb::NONE {
                        if reading
                            .as_ref()
                            .is_some_and(|(_, _, _, _, fallback)| !fallback)
                        {
                            reading.as_mut().unwrap().4 = true;
                            connection
                                .convert_selection(
                                    window,
                                    selection,
                                    AtomEnum::STRING.into(),
                                    property,
                                    x11rb::CURRENT_TIME,
                                )
                                .map_err(unavailable)?;
                        } else {
                            let (reply, _, _, _, _) = reading.take().unwrap();
                            let _ = reply.send(Ok(String::new()));
                        }
                    } else {
                        let value = connection
                            .get_property(true, window, property, AtomEnum::ANY, 0, 512 * 1024)
                            .map_err(unavailable)?
                            .reply()
                            .map_err(unavailable)?;
                        if value.type_ == incr {
                            if let Some((_, _, _, incremental, _)) = reading.as_mut() {
                                *incremental = true;
                            }
                        } else {
                            let (reply, _, _, _, _) = reading.take().unwrap();
                            let result =
                                if value.bytes_after > 0 || value.value.len() > 2 * 1024 * 1024 {
                                    Err(Failure::unavailable("Clipboard text too large"))
                                } else {
                                    Ok(decode(
                                        &value.value,
                                        value.type_ == u32::from(AtomEnum::STRING),
                                    ))
                                };
                            let _ = reply.send(result);
                        }
                    }
                }
                Event::PropertyNotify(event) => {
                    if event.state == xproto::Property::DELETE {
                        if let Some((bytes, offset, target, _)) =
                            outgoing.get_mut(&(event.window, event.atom))
                        {
                            let end = (*offset + 48 * 1024).min(bytes.len());
                            let _ = connection
                                .change_property8(
                                    PropMode::REPLACE,
                                    event.window,
                                    event.atom,
                                    *target,
                                    &bytes[*offset..end],
                                )
                                .map_err(unavailable)?
                                .check();
                            let done = *offset == bytes.len();
                            *offset = end;
                            if done {
                                outgoing.remove(&(event.window, event.atom));
                            }
                        }
                    } else if event.window == window
                        && event.atom == property
                        && reading
                            .as_ref()
                            .is_some_and(|(_, _, _, incremental, _)| *incremental)
                    {
                        let value = connection
                            .get_property(true, window, property, AtomEnum::ANY, 0, 512 * 1024)
                            .map_err(unavailable)?
                            .reply()
                            .map_err(unavailable)?;
                        let (_, _, bytes, _, _) = reading.as_mut().unwrap();
                        bytes.extend(&value.value);
                        if value.value.is_empty()
                            || bytes.len() > 2 * 1024 * 1024
                            || value.bytes_after > 0
                        {
                            let (reply, _, bytes, _, fallback) = reading.take().unwrap();
                            let _ = reply.send(
                                if bytes.len() > 2 * 1024 * 1024 || value.bytes_after > 0 {
                                    Err(Failure::unavailable("Clipboard text too large"))
                                } else {
                                    Ok(decode(&bytes, fallback))
                                },
                            );
                        }
                    }
                }
                _ => {}
            }
        }
        connection.flush().map_err(unavailable)?;
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(target_os = "linux")]
fn unavailable<E>(_: E) -> Failure {
    Failure::unavailable("X11 clipboard unavailable")
}

#[cfg(target_os = "linux")]
fn decode(bytes: &[u8], latin1: bool) -> String {
    if latin1 {
        bytes.iter().map(|b| char::from(*b)).collect()
    } else {
        String::from_utf8_lossy(bytes).into()
    }
}
#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires a disposable X11 display in NATIVE_CLIPBOARD_TEST_DISPLAY"]
    async fn native_selections_round_trip_unicode_large_transfers_and_owner_changes() {
        let display = std::env::var("NATIVE_CLIPBOARD_TEST_DISPLAY")
            .expect("Use a disposable X11 display")
            .trim_start_matches(':')
            .parse()
            .unwrap();
        let a = Clipboard::open(display).unwrap();
        let b = Clipboard::open(display).unwrap();
        let text = "Native clipboard 🤖\n";
        a.request(Some(text.into())).await.unwrap();
        assert_eq!(b.request(None).await.unwrap(), text);
        let large = "🤖".repeat(50_000);
        a.request(Some(large.clone())).await.unwrap();
        assert_eq!(b.request(None).await.unwrap(), large);
        b.request(Some("New owner".into())).await.unwrap();
        assert_eq!(a.request(None).await.unwrap(), "New owner");
    }
    #[test]
    fn legacy_string_selections_decode_latin1() {
        assert_eq!(decode(&[b'c', b'a', b'f', 0xe9], true), "café");
        assert_eq!(decode("🤖".as_bytes(), false), "🤖");
    }
}
