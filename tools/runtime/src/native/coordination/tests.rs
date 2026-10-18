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
async fn readiness_calculation_bounds_stalls_and_preserves_completed_results() {
    for mode in ["stalled", "ready", "broken"] {
        let requested = Arc::new(tokio::sync::Notify::new());
        let observed = requested.clone();
        let fixture = Fixture::router(Router::new().fallback(move || {
            let observed = observed.clone();
            async move {
                observed.notify_one();
                if mode == "stalled" {
                    std::future::pending::<()>().await;
                }
                Json(json!({"profiles":[],"isDone":mode == "ready"}))
            }
        }))
        .await;
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.key = "fixture".into();
        let mut work = JoinSet::new();
        let mut watcher = Watcher {
            row: json!({"modelIds":["model"]}),
            snapshot: Some(json!({"automation":{"isActive":true},"profiles":[],"truncated":true})),
            at: Some(0),
            generation: 7,
            task: tokio::spawn(std::future::pending()),
            calculation: None,
            calculation_revision: 0,
            refresh: false,
            not_before: 0,
        };
        calculate_due(&mut work, Arc::new(api), "routine".into(), &mut watcher);
        tokio::time::timeout(Duration::from_secs(3), requested.notified())
            .await
            .unwrap();
        if mode == "stalled" {
            tokio::time::pause();
            tokio::time::advance(READINESS_TIMEOUT).await;
        }
        let result = tokio::time::timeout(Duration::from_secs(1), work.join_next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if mode == "stalled" {
            tokio::time::resume();
        }
        let Work::Ready {
            id,
            generation,
            revision,
            result,
        } = result
        else {
            panic!("Expected a readiness result");
        };
        assert_eq!((id.as_str(), generation, revision), ("routine", 7, 1));
        match mode {
            "ready" => assert!(result.is_ok()),
            _ => {
                let error = result.unwrap_err();
                assert_eq!(error.status, axum::http::StatusCode::BAD_GATEWAY);
                assert!(error.message.contains(if mode == "stalled" {
                    "timed out"
                } else {
                    "cursor"
                }));
            }
        }
    }
}

#[tokio::test]
async fn runtime_sweeps_reject_broken_cursors_and_use_latest_duplicate_rows() {
    use std::sync::atomic::AtomicUsize;
    for mode in ["missing", "cycle", "duplicate"] {
        let reads = Arc::new(AtomicUsize::new(0));
        let calls = reads.clone();
        let fixture = Fixture::router(Router::new().fallback(move || {
            let calls = calls.clone();
            async move {
                let n = calls.fetch_add(1, Ordering::Relaxed);
                Json(match mode {
                    "duplicate" => {
                        json!({"profiles":[{"id":"p","igLoggedIn":false}],"isDone":true})
                    }
                    "cycle" => {
                        json!({"profiles":[],"isDone":false,"nextCursor":format!("cursor{}",n % 2)})
                    }
                    _ => json!({"profiles":[],"isDone":false}),
                })
            }
        }))
        .await;
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.key = "fixture".into();
        let before = api::now_ms();
        let result = Coordination::due(&api, "a", &json!({"modelIds":["m"]}),
            &json!({"automation":{"isActive":true},"profiles":[{"id":"p","igLoggedIn":true}],"truncated":true})).await;
        if mode == "duplicate" {
            assert!(result.unwrap() >= before + 15 * 60_000);
        } else {
            assert!(result.is_err());
            assert!(reads.load(Ordering::Relaxed) <= 3);
        }
    }
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
                            json!([{"_id":"a","hasRoutine":true,"isActive":true,"configRevision":1,"modelIds":["model"]}])
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
                        Json(json!({"profiles":[{"id":"p201","igLoggedIn":true}],"warmups":[],"progress":[{"profileId":"p201","nextRunAt":api::now_ms() as f64 + 200.25}],"isDone":true,"nextCursor":""})).into_response()
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
    let processes = Processes::new(api.clone(), root.path().into());
    let coordination = Coordination::new(
        api.clone(),
        Subscriptions::new(api.clone()),
        processes.clone(),
        scraper::Scraper::start(api).unwrap(),
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
    let mut rows: Vec<_> = (0..4).map(|id| json!({"_id":format!("a{id}"),"hasRoutine":true,"isActive":true,"configRevision":1,"modelIds":[]})).collect();
    rows.push(json!({"_id":"slow","hasRoutine":true,"isActive":true,"configRevision":1,"modelIds":["slow-model"]}));
    let stalled = Arc::new(AtomicBool::new(false));
    let stalled_request = stalled.clone();
    let late_started = Arc::new(AtomicBool::new(false));
    let late_start_request = late_started.clone();
    let late_removed = Arc::new(AtomicBool::new(false));
    let late_subscription_removed = late_removed.clone();
    let (release_start, start_release) = watch::channel(false);
    let (routine_rows, initial_rows) = watch::channel(rows);
    let starts = Arc::new(Mutex::new(Vec::<String>::new()));
    let calls = starts.clone();
    let websocket = get(move |ws: WebSocketUpgrade| {
        let mut rows = initial_rows.clone();
        let late_removed = late_subscription_removed.clone();
        async move {
            ws.on_upgrade(move |mut socket| async move {
            let mut queries = HashMap::<u64, String>::new();
            let mut late_query = None;
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
                                if modification["args"][0]["id"] == "late" { late_query = Some(id); }
                                let path = modification["udfPath"].as_str().unwrap().to_owned();
                                let value = if path.ends_with(":listRoutinesForScheduler") {
                                    json!(*rows.borrow_and_update())
                                } else if modification["args"][0]["id"] == "slow" {
                                    json!({"automation":{"isActive":true},"profiles":[],"truncated":true})
                                } else {
                                    json!({"automation":{"isActive":true},"profiles":[{"id":"p","igLoggedIn":true}],"progress":[{"profileId":"p","nextRunAt":api::now_ms() as f64 + 200.25}]})
                                };
                                queries.insert(id,path);
                                changes.push(json!({"type":"QueryUpdated","queryId":id,"value":value,"logLines":[],"journal":null}));
                            } else {
                                if late_query == Some(id) { late_removed.store(true, Ordering::Relaxed); }
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
            let stalled = stalled_request.clone();
            let late_started = late_start_request.clone();
            let mut release = start_release.clone();
            async move {
                let path = request.uri().path().to_owned();
                if path == "/api/automations/runtime-page" {
                    stalled.store(true, Ordering::Relaxed);
                    std::future::pending::<()>().await;
                }
                if path == "/api/automations/start" {
                    let input = body(request).await;
                    calls
                        .lock()
                        .await
                        .push(input["id"].as_str().unwrap().into());
                    if input["id"] == "late" {
                        late_started.store(true, Ordering::Relaxed);
                        release.wait_for(|released| *released).await.unwrap();
                    }
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
    let processes = Processes::new(api.clone(), root.path().into());
    let coordination = Coordination::new(
        api.clone(),
        Subscriptions::new(api.clone()),
        processes.clone(),
        scraper::Scraper::start(api).unwrap(),
    );
    let run = coordination.clone();
    let task = tokio::spawn(async move { run.routines().await });
    tokio::time::sleep(Duration::from_millis(75)).await;
    assert!(starts.lock().await.is_empty());
    wait_for(async || stalled.load(Ordering::Relaxed)).await;
    // A stalled sweep must not block other deadlines or disabling a running worker.
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
    let retired = starts.lock().await[1].clone();
    routine_rows.send_modify(|rows| rows.retain(|row| row["_id"] != retired));
    wait_for(async || !processes.is_running(&retired).await).await;
    routine_rows.send_modify(|rows| rows.push(json!({"_id":"late","hasRoutine":true,"isActive":true,"configRevision":1,"modelIds":[]})));
    wait_for(async || late_started.load(Ordering::Relaxed)).await;
    // Disable while the start request is still in flight. Its late success must be stopped.
    routine_rows.send_modify(|rows| rows.retain(|row| row["_id"] != "late"));
    wait_for(async || late_removed.load(Ordering::Relaxed)).await;
    let mut finished = processes.closed.subscribe();
    release_start.send_replace(true);
    tokio::time::timeout(Duration::from_secs(8), async {
        while let Ok((id, _)) = finished.recv().await {
            if id == "late" {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert!(!processes.is_running("late").await);
    routine_rows.send_replace(vec![]);
    wait_for(async || processes.ownership().await["processCount"] == 0).await;
    tokio::time::sleep(Duration::from_millis(75)).await;
    assert_eq!(starts.lock().await.len(), 5);
    task.abort();
    let _ = task.await;
    coordination.shutdown().await;
    coordination.start().await;
    assert!(coordination.tasks.lock().await.is_empty());
    processes.shutdown().await.unwrap();
}
