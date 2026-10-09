use super::*;
use crate::test_support::{body, Fixture};
use axum::{
    extract::ws::{Message, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashSet;

pub(super) async fn wait_for(mut condition: impl AsyncFnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(8), async {
        while !condition().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn yielded_routines_reload_all_runtime_pages_without_subscription_changes() {
    use std::sync::atomic::AtomicUsize;
    let root = tempfile::tempdir().unwrap();
    let workers = root.path().join("server/automation");
    tokio::fs::create_dir_all(&workers).await.unwrap();
    tokio::fs::write(workers.join("worker.ts"), "process.stdin.once('data', () => { console.log(JSON.stringify({type:'worker_waiting',dueAt:Date.now()+200})); setTimeout(() => process.exit(0), 30); });").await.unwrap();
    let starts = Arc::new(AtomicUsize::new(0));
    let pages = Arc::new(AtomicUsize::new(0));
    let observed_starts = starts.clone();
    let observed_pages = pages.clone();
    let blocked: Vec<_> = (0..200)
        .map(|n| json!({"id":format!("p{n}"),"igLoggedIn":false}))
        .collect();
    let websocket = get(move |ws: WebSocketUpgrade| {
        let blocked = blocked.clone();
        async move {
            ws.on_upgrade(move |mut socket| async move {
            let mut version = json!({"querySet":0,"identity":0,"ts":STANDARD.encode(0u64.to_le_bytes())});
            let mut timestamp = 0u64;
            while let Some(Ok(Message::Text(input))) = socket.recv().await {
                let input: Value = serde_json::from_str(&input).unwrap();
                if input["type"] != "ModifyQuerySet" { continue; }
                let mut changes = Vec::new();
                for modification in input["modifications"].as_array().unwrap() {
                    let id = &modification["queryId"];
                    if modification["type"] == "Add" {
                        let value = if modification["udfPath"].as_str().unwrap().ends_with(":listRoutinesForScheduler") {
                            json!([{"_id":"a","hasRoutine":true,"isActive":true,"configRevision":1,"listIds":["model"]}])
                        } else {
                            json!({"automation":{"isActive":true},"profiles":blocked,"warmups":[],"progress":[],"truncated":true})
                        };
                        changes.push(json!({"type":"QueryUpdated","queryId":id,"value":value,"logLines":[],"journal":null}));
                    } else {
                        changes.push(json!({"type":"QueryRemoved","queryId":id}));
                    }
                }
                timestamp += 1;
                let next = json!({"querySet":input["newVersion"],"identity":0,"ts":STANDARD.encode(timestamp.to_le_bytes())});
                let transition = json!({"type":"Transition","startVersion":version,"endVersion":next,"modifications":changes});
                if socket.send(Message::Text(transition.to_string().into())).await.is_err() { break; }
                version = next;
            }
        })
        }
    });
    let fixture = Fixture::router(Router::new().route("/api/sync", websocket).fallback(move |request: axum::extract::Request| {
        let starts = observed_starts.clone();
        let pages = observed_pages.clone();
        async move {
            match request.uri().path() {
                "/api/automations/start" => {
                    starts.fetch_add(1, Ordering::Relaxed);
                    Json(json!({"isActive":true,"routine":{},"nodeStates":{}})).into_response()
                }
                "/api/automations/runtime-page" => {
                    pages.fetch_add(1, Ordering::Relaxed);
                    let query = super::super::query(request.uri().query().unwrap());
                    if query.get("cursor").is_none_or(String::is_empty) {
                        Json(json!({"profiles":[],"warmups":[],"progress":[],"isDone":false,"nextCursor":"tail"})).into_response()
                    } else {
                        assert_eq!(query["cursor"], "tail");
                        Json(json!({"profiles":[{"id":"p201","igLoggedIn":true}],"warmups":[],"progress":[{"profileId":"p201","nextRunAt":api::now_ms()+200}],"isDone":true,"nextCursor":""})).into_response()
                    }
                }
                _ => Json(json!({"isActive":true,"routine":{}})).into_response(),
            }
        }
    })).await;
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
    let coordination = Coordination::new(
        api.clone(),
        Subscriptions::new(api.clone()),
        processes.clone(),
        chat,
        scraper::Scraper::start(api, mobile).unwrap(),
    );
    let run = coordination.clone();
    let task = tokio::spawn(async move { run.routines().await });
    // No Convex transition follows the initial snapshots: worker completion must reload.
    wait_for(async || starts.load(Ordering::Relaxed) >= 2).await;
    assert!(pages.load(Ordering::Relaxed) >= 4);
    task.abort();
    let _ = task.await;
    coordination.shutdown().await;
    processes.shutdown().await.unwrap();
}

#[tokio::test]
async fn subscriptions_and_deadlines_start_routines_retry_capacity_and_stop_disabled_workers() {
    let root = tempfile::tempdir().unwrap();
    let workers = root.path().join("server/automation");
    tokio::fs::create_dir_all(&workers).await.unwrap();
    tokio::fs::write(workers.join("worker.ts"), "process.stdin.on('data', data => { if(data.toString().includes('stop')) process.exit(0) });").await.unwrap();
    let rows: Vec<_> = (0..4).map(|id| json!({"_id":format!("a{id}"),"hasRoutine":true,"isActive":true,"configRevision":1,"listIds":[]})).collect();
    let (routine_rows, initial_rows) = watch::channel(rows);
    let starts = Arc::new(Mutex::new(Vec::<String>::new()));
    let calls = starts.clone();
    let websocket = get(move |ws: WebSocketUpgrade| {
        let mut rows = initial_rows.clone();
        async move {
            ws.on_upgrade(move |mut socket| async move {
            let mut queries = HashMap::<u64, String>::new();
            let mut version = json!({"querySet":0,"identity":0,"ts":STANDARD.encode(0u64.to_le_bytes())});
            let mut timestamp = 0u64;
            let mut query_version = 0;
            loop {
                let mut changes = Vec::new();
                tokio::select! {
                    input = socket.recv() => {
                        let Some(Ok(Message::Text(input))) = input else { break; };
                        let input: Value = serde_json::from_str(&input).unwrap();
                        if input["type"] != "ModifyQuerySet" { continue; }
                        query_version = input["newVersion"].as_u64().unwrap();
                        for modification in input["modifications"].as_array().unwrap() {
                            let id = modification["queryId"].as_u64().unwrap();
                            if modification["type"] == "Add" {
                                let path = modification["udfPath"].as_str().unwrap().to_owned();
                                let value = if path.ends_with(":listRoutinesForScheduler") {
                                    json!(*rows.borrow_and_update())
                                } else {
                                    json!({"automation":{"isActive":true},"profiles":[{"id":"p","igLoggedIn":true}],"progress":[{"profileId":"p","nextRunAt":api::now_ms()+200}]})
                                };
                                queries.insert(id,path);
                                changes.push(json!({"type":"QueryUpdated","queryId":id,"value":value,"logLines":[],"journal":null}));
                            } else {
                                queries.remove(&id);
                                changes.push(json!({"type":"QueryRemoved","queryId":id}));
                            }
                        }
                    }
                    changed = rows.changed() => {
                        if changed.is_err() { break; }
                        let value = json!(*rows.borrow_and_update());
                        for (id,path) in &queries {
                            if path.ends_with(":listRoutinesForScheduler") {
                                changes.push(json!({"type":"QueryUpdated","queryId":id,"value":value,"logLines":[],"journal":null}));
                            }
                        }
                    }
                }
                timestamp += 1;
                let next = json!({"querySet":query_version,"identity":0,"ts":STANDARD.encode(timestamp.to_le_bytes())});
                let transition = json!({"type":"Transition","startVersion":version,"endVersion":next,"modifications":changes});
                if socket.send(Message::Text(transition.to_string().into())).await.is_err() { break; }
                version = next;
            }
        })
        }
    });
    let fixture = Fixture::router(Router::new().route("/api/sync", websocket).fallback(
        move |request: axum::extract::Request| {
            let calls = calls.clone();
            async move {
                let path = request.uri().path().to_owned();
                if path == "/api/automations/start" {
                    let input = body(request).await;
                    calls
                        .lock()
                        .await
                        .push(input["id"].as_str().unwrap().into());
                }
                Json(json!({"isActive":true,"routine":{},"nodeStates":{}})).into_response()
            }
        },
    ))
    .await;
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
    let coordination = Coordination::new(
        api.clone(),
        Subscriptions::new(api.clone()),
        processes.clone(),
        chat,
        scraper::Scraper::start(api, mobile).unwrap(),
    );
    let run = coordination.clone();
    let task = tokio::spawn(async move { run.routines().await });
    tokio::time::sleep(Duration::from_millis(75)).await;
    assert!(starts.lock().await.is_empty());
    wait_for(async || processes.ownership().await["processCount"] == 3).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(starts.lock().await.len(), 3);
    let removed = starts.lock().await[0].clone();
    routine_rows.send_modify(|rows| rows.retain(|row| row["_id"] != removed));
    wait_for(async || {
        starts.lock().await.len() == 4 && processes.ownership().await["processCount"] == 3
    })
    .await;
    assert!(!processes.is_running(&removed).await);
    assert_eq!(starts.lock().await.iter().collect::<HashSet<_>>().len(), 4);
    routine_rows.send_replace(vec![]);
    wait_for(async || processes.ownership().await["processCount"] == 0).await;
    tokio::time::sleep(Duration::from_millis(75)).await;
    assert_eq!(starts.lock().await.len(), 4);
    task.abort();
    let _ = task.await;
    coordination.shutdown().await;
    coordination.start().await;
    assert!(coordination.tasks.lock().await.is_empty());
    processes.shutdown().await.unwrap();
}
