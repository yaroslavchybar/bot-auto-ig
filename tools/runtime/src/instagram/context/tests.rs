use super::*;
use crate::test_support::{self, Fixture};
use axum::{
    extract::ws::{Message, WebSocketUpgrade},
    routing::get,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::watch;

async fn update(
    service: &Service,
    connection: &Arc<Subscriptions>,
    subscription: &mut convex::QuerySubscription,
) {
    let value = tokio::time::timeout(std::time::Duration::from_secs(5), subscription.next())
        .await
        .unwrap()
        .unwrap();
    let contexts =
        serde_json::from_value(crate::native::subscriptions::value(value).unwrap()).unwrap();
    service.update_contexts(contexts, connection.clone());
}

#[tokio::test]
async fn sessions_reuse_reads_and_observe_revisions_proxies_logout_and_disconnect() {
    let context = json!({"profileId":"p","token":"a","storageId":"file-a","reconnectRequired":false,"enabled":true,"proxy":"","proxyType":""});
    let (metadata, receiver) = watch::channel(json!([context]));
    let (disconnect, disconnected) = watch::channel(false);
    let saved = Arc::new(Mutex::new(
        json!({"connected":true,"token":"a","storageId":"file-a","reconnectRequired":false,"state":Service::fixture_session(),"profile":{"proxy":"","proxyType":""}}),
    ));
    let reads = Arc::new(AtomicUsize::new(0));
    let writes = Arc::new(AtomicUsize::new(0));
    let store = saved.clone();
    let count = reads.clone();
    let saves = writes.clone();
    let fixture = Fixture::router(Router::new().route("/api/sync", get(move |ws: WebSocketUpgrade| {
        let mut updates = receiver.clone(); let mut disconnected = disconnected.clone();
        async move { ws.on_upgrade(move |mut socket| async move {
            if *disconnected.borrow() { return; }
            let mut query = None; let mut query_version = 0;
            let mut version = json!({"querySet":0,"identity":0,"ts":STANDARD.encode(0u64.to_le_bytes())});
            let mut timestamp = 0u64;
            loop {
                let value = tokio::select! {
                    _ = disconnected.changed() => break,
                    input = socket.recv() => {
                        let Some(Ok(Message::Text(input))) = input else { break; };
                        let input:Value = serde_json::from_str(&input).unwrap();
                        if input["type"] != "ModifyQuerySet" { continue; }
                        query_version = input["newVersion"].as_u64().unwrap();
                        let modification = &input["modifications"][0];
                        if modification["type"] != "Add" { break; }
                        assert_eq!(modification["udfPath"],"profiles/queries:chatWorkerContexts");
                        query = modification["queryId"].as_u64();
                        updates.borrow_and_update().clone()
                    }
                    changed = updates.changed() => {
                        if changed.is_err() { break; }
                        updates.borrow_and_update().clone()
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
        let store = store.clone(); let count = count.clone(); let saves = saves.clone();
        async move {
            match *request.method() {
                Method::GET => { count.fetch_add(1,Ordering::Relaxed); Json(store.lock().await.clone()).into_response() },
                Method::DELETE => { *store.lock().await = json!({"connected":false}); Json(json!({"connected":false})).into_response() },
                Method::POST => {
                    let body = test_support::body(request).await;
                    let mut saved = store.lock().await;
                    saved["state"] = body["state"].clone(); saved["storageId"] = json!("file-c");
                    saves.fetch_add(1,Ordering::Relaxed);
                    Json(json!({"connected":true,"storageId":"file-c"})).into_response()
                },
                _ => panic!("unexpected method"),
            }
        }
    })).await;
    let upstream_calls = Arc::new(AtomicUsize::new(0));
    let upstream_count = upstream_calls.clone();
    let change_cookie = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let cookie_mode = change_cookie.clone();
    let upstream = Fixture::start(move |_| {
        let count = upstream_count.clone();
        let cookie_mode = cookie_mode.clone();
        async move {
            count.fetch_add(1, Ordering::Relaxed);
            let mut response =
                Json(json!({"status":"ok","inbox":{"threads":[],"has_older":false}}))
                    .into_response();
            if cookie_mode.load(Ordering::Relaxed) {
                response
                    .headers_mut()
                    .insert("ig-set-authorization", "Bearer changed".parse().unwrap());
            }
            response
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let service = Service::fixture(
        api.clone(),
        Arc::new(Uploads {
            entries: Default::default(),
            slots: Arc::new(tokio::sync::Semaphore::new(4)),
        }),
        upstream.url.clone(),
    );
    let connection = Subscriptions::new(api);
    let mut subscription = connection
        .subscribe(
            "profiles/queries:chatWorkerContexts",
            json!({"subscriptionId":"test"}),
        )
        .await
        .unwrap();
    update(&service, &connection, &mut subscription).await;
    let mut command = Command {
        profile_id: "p".into(),
        token: None,
        args: json!({}),
    };
    for _ in 0..5 {
        service.invoke("load", &command).await.unwrap();
        service.invoke("inbox", &command).await.unwrap();
    }
    assert_eq!(
        reads.load(Ordering::Relaxed),
        1,
        "all unchanged operations share the first context read"
    );
    assert_eq!(
        upstream_calls.load(Ordering::Relaxed),
        5,
        "Instagram still syncs"
    );
    assert_eq!(
        writes.load(Ordering::Relaxed),
        0,
        "unchanged cookies are not published"
    );

    let mut next = context.clone();
    next["proxy"] = json!("invalid proxy");
    metadata.send_replace(json!([next]));
    update(&service, &connection, &mut subscription).await;
    assert!(
        service.invoke("inbox", &command).await.is_err(),
        "the latest proxy must be used"
    );
    assert_eq!(
        reads.load(Ordering::Relaxed),
        1,
        "proxy changes need no session download"
    );
    let mut next = context.clone();
    next["storageId"] = json!("file-b");
    next["token"] = json!("b");
    {
        let mut saved = saved.lock().await;
        saved["storageId"] = json!("file-b");
        saved["token"] = json!("b");
    }
    metadata.send_replace(json!([next.clone()]));
    update(&service, &connection, &mut subscription).await;
    command.token = Some("a".into());
    assert_eq!(
        service.invoke("load", &command).await.unwrap_err().message,
        "Chat session was logged out"
    );
    assert_eq!(reads.load(Ordering::Relaxed), 2);
    command.token = None;
    assert_eq!(
        service.invoke("load", &command).await.unwrap()["token"],
        "b"
    );

    // The subscription may arrive before a successful checkpoint response.
    next["storageId"] = json!("file-c");
    metadata.send_replace(json!([next.clone()]));
    update(&service, &connection, &mut subscription).await;
    let entry = service.entry("p").await.unwrap();
    {
        let mut entry = entry.lock().await;
        let saved = entry.saved.as_ref().unwrap().clone();
        service.checkpoint(
            "p",
            &mut entry,
            &saved,
            saved["state"].as_str().unwrap(),
            "b",
            &json!({"storageId":"file-c"}),
        );
    }
    service.invoke("load", &command).await.unwrap();
    assert_eq!(
        reads.load(Ordering::Relaxed),
        2,
        "a checkpoint echo reuses the saved session"
    );
    change_cookie.store(true, Ordering::Relaxed);
    service.invoke("inbox", &command).await.unwrap();
    service.invoke("load", &command).await.unwrap();
    service.invoke("inbox", &command).await.unwrap();
    assert_eq!(
        writes.load(Ordering::Relaxed),
        1,
        "changed cookies are saved once"
    );
    assert_eq!(
        reads.load(Ordering::Relaxed),
        2,
        "saved cookies update the in-memory session"
    );
    next["reconnectRequired"] = json!(true);
    next["enabled"] = json!(false);
    metadata.send_replace(json!([next.clone()]));
    update(&service, &connection, &mut subscription).await;
    assert_eq!(
        service.invoke("has", &command).await.unwrap()["connected"],
        false
    );
    assert!(service.invoke("load", &command).await.is_err());
    assert_eq!(reads.load(Ordering::Relaxed), 2);
    next["reconnectRequired"] = json!(false);
    next["enabled"] = json!(true);
    metadata.send_replace(json!([next]));
    update(&service, &connection, &mut subscription).await;
    service.invoke("logout", &command).await.unwrap();
    assert!(
        service.invoke("load", &command).await.is_err(),
        "logout cannot reuse the old metadata before its echo"
    );
    assert_eq!(reads.load(Ordering::Relaxed), 3);
    metadata.send_replace(json!([]));
    update(&service, &connection, &mut subscription).await;
    assert!(service.invoke("load", &command).await.is_err());
    assert_eq!(
        reads.load(Ordering::Relaxed),
        3,
        "missing sessions are authoritative"
    );

    disconnect.send_replace(true);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while connection.current_epoch().is_some() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(service.invoke("load", &command).await.is_err());
    assert_eq!(
        reads.load(Ordering::Relaxed),
        4,
        "disconnects fall back to fresh HTTP reads"
    );
}
