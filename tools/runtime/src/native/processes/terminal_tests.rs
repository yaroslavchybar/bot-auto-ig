use super::*;
use crate::test_support::{body, Fixture};
use axum::{response::IntoResponse, Json};

#[tokio::test]
async fn checkpoint_bursts_coalesce_and_terminal_errors_never_schedule_another_run() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("server/automation");
    tokio::fs::create_dir_all(&dir).await.unwrap();
    tokio::fs::write(
        dir.join("worker.ts"),
        r#"
process.stdin.once('data', data => {
const emit = value => console.log('__EVENT__'+JSON.stringify(value)+'__EVENT__');
for(let i=0;i<100;i++) emit({type:'checkpoint',nodeId:'node'+i,nodeStates:{index:i}});
emit({type:'worker_waiting',dueAt:Date.now()+60000});
emit({type:'session_ended',status:' Failed ',error:'fixture failure'});
process.exit(1);
});
"#,
    )
    .await
    .unwrap();
    let writes = Arc::new(Mutex::new(Vec::new()));
    let seen = writes.clone();
    let fixture = Fixture::start(move |request| {
        let seen = seen.clone();
        async move {
            if request.uri().path() == "/api/automations/update-status" {
                seen.lock().await.push(body(request).await);
                tokio::time::sleep(Duration::from_millis(40)).await;
            }
            Json(json!({"isActive":true,"routine":{},"nodeStates":{}})).into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let owner = Processes::new(Arc::new(api), root.path().into());
    let mut closed = owner.closed.subscribe();
    owner.start_automation("a").await.unwrap();
    let (_, at) = tokio::time::timeout(Duration::from_secs(5), closed.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(at.is_none());
    let writes = writes.lock().await;
    assert!(writes.len() < 10, "checkpoint writes must coalesce");
    let last = writes.last().unwrap();
    assert_eq!(last["status"], "failed");
    assert_eq!(last["nodeStates"]["index"], 99);
    assert_eq!(last["error"], "fixture failure");
    assert_eq!(owner.ownership().await["processCount"], 0);
}

#[tokio::test]
async fn malformed_control_frames_preserve_later_checkpoints_and_plain_diagnostics() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("server/automation");
    tokio::fs::create_dir_all(&dir).await.unwrap();
    tokio::fs::write(dir.join("worker.ts"), r#"
process.stdin.once('data', () => {
for (const value of ['true', '[]', 'null', '{"type":42}', '{broken'])
  console.log('__EVENT__'+value+'__EVENT__');
for (let i=0;i<25;i++) console.log('diagnostic '+i);
console.error('Import failed: password=hidden fixture-key');
console.log('__EVENT__'+JSON.stringify({type:'checkpoint',nodeId:'saved',nodeStates:{saved:'done'}})+'__EVENT__');
process.exit(0);
});
"#).await.unwrap();
    let writes = Arc::new(Mutex::new(Vec::new()));
    let seen = writes.clone();
    let release = Arc::new(tokio::sync::Semaphore::new(0));
    let save = release.clone();
    let fixture = Fixture::start(move |request| {
        let seen = seen.clone();
        let save = save.clone();
        async move {
            if request.uri().path() == "/api/automations/update-status" {
                seen.lock().await.push(body(request).await);
                save.acquire().await.unwrap().forget();
            }
            Json(json!({"isActive":true,"nodeStates":{}})).into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture-key".into();
    let owner = Processes::new(Arc::new(api), root.path().into());
    let mut closed = owner.closed.subscribe();
    owner.start_automation("a").await.unwrap();
    let job = owner.jobs.lock().await[&Processes::key(true, "a")].clone();
    release.add_permits(10);
    tokio::time::timeout(Duration::from_secs(5), closed.recv())
        .await
        .unwrap()
        .unwrap();
    let writes = writes.lock().await;
    assert_eq!(writes.last().unwrap()["nodeStates"]["saved"], "done");
    assert_eq!(writes.last().unwrap()["status"], "completed");
    let progress = job.progress.lock().await;
    assert_eq!(progress.diagnostic_count, 31);
    assert_eq!(progress.diagnostics.len(), 20);
    let notes = serde_json::to_string(progress.diagnostic_error.as_ref().unwrap()).unwrap();
    assert!(notes.contains("Import failed:"));
    assert!(!notes.contains("hidden"));
    assert!(!notes.contains("fixture-key"));
}

#[tokio::test]
async fn final_status_retries_transient_failure_before_releasing_worker_ownership() {
    use std::sync::atomic::AtomicUsize;
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("server/automation");
    tokio::fs::create_dir_all(&dir).await.unwrap();
    tokio::fs::write(
        dir.join("worker.ts"),
        "process.stdin.once('data', () => process.exit(0));",
    )
    .await
    .unwrap();
    let attempts = Arc::new(AtomicUsize::new(0));
    let attempted = Arc::new(tokio::sync::Notify::new());
    let observed = attempts.clone();
    let notify = attempted.clone();
    let fixture = Fixture::start(move |request| {
        let attempts = observed.clone();
        let notify = notify.clone();
        async move {
            if request.uri().path() == "/api/automations/update-status" {
                assert_eq!(body(request).await["status"], "completed");
                if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                    notify.notify_one();
                    return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response();
                }
            }
            Json(json!({"isActive":true})).into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let owner = Processes::new(Arc::new(api), root.path().into());
    let mut closed = owner.closed.subscribe();
    owner.start_automation("a").await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), attempted.notified())
        .await
        .unwrap();
    assert!(owner.is_running("a").await);
    tokio::time::timeout(Duration::from_secs(5), closed.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    assert!(!owner.is_running("a").await);
}
