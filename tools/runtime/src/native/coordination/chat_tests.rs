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
    let loads = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(tokio::sync::Notify::new());
    let count = loads.clone();
    let unblock = release.clone();
    let fixture = Fixture::router(Router::new().route("/api/sync",get(move |ws:WebSocketUpgrade| {
        let mut accounts = initial_accounts.clone();
        async move { ws.on_upgrade(move |mut socket| async move {
            let mut query = None;
            let mut version = json!({"querySet":0,"identity":0,"ts":STANDARD.encode(0u64.to_le_bytes())});
            let mut query_version = 0; let mut timestamp = 0u64;
            loop {
                let value = tokio::select! {
                    input = socket.recv() => {
                        let Some(Ok(Message::Text(input))) = input else { break; };
                        let input:Value = serde_json::from_str(&input).unwrap();
                        if input["type"] != "ModifyQuerySet" { continue; }
                        query_version = input["newVersion"].as_u64().unwrap();
                        let modification = &input["modifications"][0];
                        if modification["type"] != "Add" { break; }
                        query = modification["queryId"].as_u64();
                        accounts.borrow_and_update().clone()
                    }
                    changed = accounts.changed() => {
                        if changed.is_err() { break; }
                        accounts.borrow_and_update().clone()
                    }
                };
                let Some(query) = query else { continue; };
                timestamp += 1;
                let next = json!({"querySet":query_version,"identity":0,"ts":STANDARD.encode(timestamp.to_le_bytes())});
                let transition = json!({"type":"Transition","startVersion":version,"endVersion":next,"modifications":[{"type":"QueryUpdated","queryId":query,"value":value,"logLines":[],"journal":null}]});
                if socket.send(Message::Text(transition.to_string().into())).await.is_err() { break; }
                version = next;
            }
        }) }
    })).fallback(move |request:axum::extract::Request| {
        let count = count.clone(); let unblock = unblock.clone();
        async move {
            assert_eq!(request.uri().path(),"/api/chat/session");
            if count.fetch_add(1,Ordering::Relaxed) < 4 { unblock.notified().await; }
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
    let mut coordination = Coordination::new(
        api.clone(),
        Subscriptions::new(api.clone()),
        processes,
        chat,
        scraper::Scraper::start(api, mobile),
    );
    Arc::get_mut(&mut coordination).unwrap().chat_interval = Duration::from_millis(100);
    let runner = coordination.clone();
    let task = tokio::spawn(async move { runner.chat().await });
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(loads.load(Ordering::Relaxed), 0);
    accounts.send_replace(json!(["0", "1", "2", "3", "4", "5"]));
    super::tests::wait_for(async || loads.load(Ordering::Relaxed) == 4).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(
        loads.load(Ordering::Relaxed),
        4,
        "background rounds cannot overlap"
    );
    release.notify_waiters();
    super::tests::wait_for(async || loads.load(Ordering::Relaxed) >= 12).await;
    task.abort();
    let _ = task.await;
    let final_loads = loads.load(Ordering::Relaxed);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(loads.load(Ordering::Relaxed), final_loads);
}
