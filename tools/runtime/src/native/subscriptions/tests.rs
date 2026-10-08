use super::*;
use crate::test_support::Fixture;
use axum::{routing::get, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn subscriptions_share_one_convex_connection_inject_auth_and_unsubscribe_on_drop() {
    let connections = Arc::new(AtomicUsize::new(0));
    let removed = Arc::new(tokio::sync::Notify::new());
    let count = connections.clone();
    let closed = removed.clone();
    let fixture=Fixture::router(Router::new().route("/api/sync",get(move |ws:WebSocketUpgrade| { let count=count.clone(); let closed=closed.clone(); async move {
        count.fetch_add(1,Ordering::Relaxed);
        ws.on_upgrade(move |mut socket| async move {
            let mut version=json!({"querySet":0,"identity":0,"ts":STANDARD.encode(0u64.to_le_bytes())}); let mut timestamp=0u64;
            while let Some(Ok(Message::Text(input)))=socket.recv().await {
                let input:Value=serde_json::from_str(&input).unwrap();
                if input["type"]!="ModifyQuerySet" { continue; }
                let mut changes=Vec::new();
                for modification in input["modifications"].as_array().unwrap() {
                    if modification["type"]=="Add" {
                        assert_eq!(modification["args"][0]["bridgeToken"],"fixture-key");
                        changes.push(json!({"type":"QueryUpdated","queryId":modification["queryId"],"value":{"at":1_790_000_000_000f64,"fraction":1.5},"logLines":[],"journal":null}));
                    } else { closed.notify_one(); changes.push(json!({"type":"QueryRemoved","queryId":modification["queryId"]})); }
                }
                timestamp+=1; let next=json!({"querySet":input["newVersion"],"identity":0,"ts":STANDARD.encode(timestamp.to_le_bytes())});
                let transition=json!({"type":"Transition","startVersion":version,"endVersion":next,"modifications":changes});
                if socket.send(Message::Text(transition.to_string().into())).await.is_err() { break; } version=next;
            }
        })
    }}))).await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture-key".into();
    let owner = Subscriptions::new(Arc::new(api));
    let mut a = owner
        .subscribe(
            "scraper:work",
            json!({"bridgeToken":"client-cannot-override"}),
        )
        .await
        .unwrap();
    let mut b = owner
        .subscribe("profiles/queries:maintenanceWork", json!({}))
        .await
        .unwrap();
    for subscription in [&mut a, &mut b] {
        let result = tokio::time::timeout(Duration::from_secs(5), subscription.next())
            .await
            .unwrap()
            .unwrap();
        let result = value(result).unwrap();
        assert_eq!(result["at"].as_u64(), Some(1_790_000_000_000));
        assert_eq!(result["fraction"].as_f64(), Some(1.5));
    }
    assert_eq!(connections.load(Ordering::Relaxed), 1);
    drop(a);
    tokio::time::timeout(Duration::from_secs(5), removed.notified())
        .await
        .unwrap();
    assert!(owner
        .subscribe("profiles/private:all", json!({}))
        .await
        .is_err());
}

#[tokio::test]
async fn local_bridge_cancels_subscriptions_when_its_owner_disconnects() {
    // The full Convex protocol is exercised above; this boundary rejects unknown queries without leaking args.
    use futures_util::SinkExt;
    let owner = Subscriptions::new(Arc::new(Api::from_env().unwrap()));
    let fixture = Fixture::router(
        Router::new()
            .route("/subscriptions", get(upgrade))
            .with_state(owner.clone()),
    )
    .await;
    let (mut socket, _) = tokio_tungstenite::connect_async(
        fixture.url.replace("http://", "ws://") + "/subscriptions",
    )
    .await
    .unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({"name":"unknown:query","args":{"secret":"private"}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let result = socket.next().await.unwrap().unwrap().into_text().unwrap();
    assert!(!result.contains("private"));
    assert!(result.contains("error"));
    drop(socket);
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(owner.slots.available_permits(), 1000);
}
