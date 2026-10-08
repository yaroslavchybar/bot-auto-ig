use super::*;
use crate::test_support::Fixture;
use axum::{
    extract::ws::{Message, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::sync::atomic::AtomicUsize;

#[tokio::test]
async fn chat_background_is_idle_without_accounts_limits_concurrency_and_stops_cleanly() {
    let (accounts, initial_accounts) = watch::channel(json!([]));
    let (disconnect, disconnected) = watch::channel(false);
    let subscription_ids = Arc::new(std::sync::Mutex::new(std::collections::HashSet::new()));
    let observed_ids = subscription_ids.clone();
    let loads = Arc::new(AtomicUsize::new(0));
    let status_reads = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(tokio::sync::Notify::new());
    let count = loads.clone();
    let unblock = release.clone();
    let status_count = status_reads.clone();
    let fixture = Fixture::router(Router::new().route("/api/sync",get(move |ws:WebSocketUpgrade| {
        let mut accounts = initial_accounts.clone(); let mut disconnected = disconnected.clone(); let observed_ids = observed_ids.clone();
        async move { ws.on_upgrade(move |mut socket| async move {
            if *disconnected.borrow_and_update() { return; }
            let mut queries = std::collections::BTreeSet::new();
            let mut version = json!({"querySet":0,"identity":0,"ts":STANDARD.encode(0u64.to_le_bytes())});
            let mut query_version = 0; let mut timestamp = 0u64;
            loop {
                let mut changes = Vec::new();
                let value = tokio::select! {
                    _ = disconnected.changed() => break,
                    input = socket.recv() => {
                        let Some(Ok(Message::Text(input))) = input else { break; };
                        let input:Value = serde_json::from_str(&input).unwrap();
                        if input["type"] != "ModifyQuerySet" { continue; }
                        query_version = input["newVersion"].as_u64().unwrap();
                        for modification in input["modifications"].as_array().unwrap() {
                            let id = modification["queryId"].as_u64().unwrap();
                            if modification["type"] == "Add" {
                                observed_ids.lock().unwrap().insert(modification["args"][0]["subscriptionId"].as_str().unwrap().to_owned());
                                queries.insert(id);
                            } else {
                                queries.remove(&id);
                                changes.push(json!({"type":"QueryRemoved","queryId":id}));
                            }
                        }
                        accounts.borrow_and_update().clone()
                    }
                    changed = accounts.changed() => {
                        if changed.is_err() { break; }
                        accounts.borrow_and_update().clone()
                    }
                };
                changes.extend(queries.iter().map(|query| if value == "fixture-query-failed" {
                    json!({"type":"QueryFailed","queryId":query,"errorMessage":"fixture failure","logLines":[],"journal":null})
                } else {
                    json!({"type":"QueryUpdated","queryId":query,"value":value,"logLines":[],"journal":null})
                }));
                timestamp += 1;
                let next = json!({"querySet":query_version,"identity":0,"ts":STANDARD.encode(timestamp.to_le_bytes())});
                let transition = json!({"type":"Transition","startVersion":version,"endVersion":next,"modifications":changes});
                if socket.send(Message::Text(transition.to_string().into())).await.is_err() { break; }
                version = next;
            }
        }) }
    })).fallback(move |request:axum::extract::Request| {
        let count = count.clone(); let unblock = unblock.clone(); let status_count = status_count.clone();
        async move {
            if request.uri().path() == "/api/chat/session" {
                status_count.fetch_add(1, Ordering::Relaxed);
            } else {
                assert_eq!(request.uri().path(),"/api/chat/context");
                if count.fetch_add(1,Ordering::Relaxed) < 4 { unblock.notified().await; }
            }
            Json(json!({"connected":false})).into_response()
        }
    })).await;
    let root = tempfile::tempdir().unwrap();
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let uploads = Arc::new(crate::uploads::Uploads {
        entries: Default::default(),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    });
    let mobile = crate::instagram::Service::new(api.clone(), uploads);
    let chat = Chat::new(
        api.clone(),
        mobile.clone(),
        &root.path().join("cache.sqlite"),
    )
    .unwrap();
    let processes = Processes::new(api.clone(), root.path().into());
    let subscriptions = Subscriptions::new(api.clone());
    let mut coordination = Coordination::new(
        api.clone(),
        subscriptions.clone(),
        processes,
        chat,
        scraper::Scraper::start(api, mobile.clone()),
    );
    Arc::get_mut(&mut coordination).unwrap().chat_interval = Duration::from_millis(100);
    let runner = coordination.clone();
    let task = tokio::spawn(async move { runner.chat().await });
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(loads.load(Ordering::Relaxed), 0);
    accounts.send_replace(json!((0..6).map(|id| json!({"profileId":id.to_string(),"token":"token","storageId":"file","reconnectRequired":false,"enabled":true,"proxy":"","proxyType":""})).collect::<Vec<_>>()));
    super::tests::wait_for(async || loads.load(Ordering::Relaxed) == 4).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(
        loads.load(Ordering::Relaxed),
        4,
        "background rounds cannot overlap"
    );
    release.notify_waiters();
    super::tests::wait_for(async || loads.load(Ordering::Relaxed) >= 12).await;
    let valid_contexts = accounts.borrow().clone();
    let probe = crate::instagram::Command {
        profile_id: "not-connected".into(),
        token: None,
        args: json!({}),
    };
    for invalid in [json!({"invalid":"contexts"}), json!("fixture-query-failed")] {
        let before = status_reads.load(Ordering::Relaxed);
        mobile.invoke("has", &probe).await.unwrap();
        assert_eq!(
            status_reads.load(Ordering::Relaxed),
            before,
            "valid metadata authorizes the cache"
        );
        accounts.send_replace(invalid);
        super::tests::wait_for(async || {
            mobile.invoke("has", &probe).await.unwrap();
            status_reads.load(Ordering::Relaxed) > before
        })
        .await;
        assert!(
            !task.is_finished(),
            "invalid updates must not terminate the worker"
        );
        let before = loads.load(Ordering::Relaxed);
        super::tests::wait_for(async || loads.load(Ordering::Relaxed) >= before + 6).await;
        accounts.send_replace(valid_contexts.clone());
        super::tests::wait_for(async || {
            let before = status_reads.load(Ordering::Relaxed);
            mobile.invoke("has", &probe).await.unwrap();
            status_reads.load(Ordering::Relaxed) == before
        })
        .await;
    }
    disconnect.send_replace(true);
    super::tests::wait_for(async || subscriptions.current_epoch().is_none()).await;
    let offline_loads = loads.load(Ordering::Relaxed);
    super::tests::wait_for(async || loads.load(Ordering::Relaxed) >= offline_loads + 6).await;
    accounts.send_replace(json!([]));
    disconnect.send_replace(false);
    super::tests::wait_for(async || {
        subscriptions.current_epoch().is_some() && subscription_ids.lock().unwrap().len() > 1
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let after_reconnect = loads.load(Ordering::Relaxed);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        loads.load(Ordering::Relaxed),
        after_reconnect,
        "fresh subscriptions remove accounts changed while offline"
    );
    task.abort();
    let _ = task.await;
    let final_loads = loads.load(Ordering::Relaxed);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(loads.load(Ordering::Relaxed), final_loads);
}
