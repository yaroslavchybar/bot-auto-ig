use super::*;
use crate::test_support::{body, Fixture};
use axum::{response::IntoResponse, Json};
use std::sync::atomic::AtomicUsize;

async fn resource_child() -> tokio::process::Child {
    let mut command = Command::new("bun");
    command
        .args(["--eval", "setInterval(()=>{},1000)"])
        .kill_on_drop(true)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command.spawn().unwrap()
}

#[tokio::test(start_paused = true)]
async fn resource_identity_retries_empty_reads_without_registering_an_unverified_process() {
    let mut child = resource_child().await;
    let pid = child.id().unwrap();
    let mut calls = 0;
    let result = resource_identity(&mut child, async |seen| {
        assert_eq!(seen, pid);
        calls += 1;
        match calls {
            1 => None,
            2 => Some((123, vec![])),
            _ => Some((123, vec!["bun".into()])),
        }
    })
    .await
    .unwrap();
    assert_eq!(result, (pid, 123, PathBuf::from("bun")));
    assert_eq!(calls, 3);
    child.kill().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn resource_identity_gives_up_after_a_bounded_number_of_reads() {
    let mut child = resource_child().await;
    let mut calls = 0;
    let started = tokio::time::Instant::now();
    let error = resource_identity(&mut child, async |_| {
        calls += 1;
        Some((123, vec![]))
    })
    .await
    .unwrap_err();
    assert!(error.message.contains("identity unavailable"));
    assert_eq!(calls, 20);
    assert_eq!(started.elapsed(), Duration::from_millis(950));
    child.kill().await.unwrap();
}

#[tokio::test]
async fn resource_identity_rejects_an_exited_child_without_reading_a_reused_pid() {
    let mut child = resource_child().await;
    child.kill().await.unwrap();
    assert!(resource_identity(&mut child, async |_| {
        panic!("Exited PID must not be inspected")
    })
    .await
    .is_err());
}

#[cfg(windows)]
async fn wait_for(mut condition: impl AsyncFnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !condition().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn concurrent_manual_starts_do_not_publish_status_without_browser_ownership() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("server/browser");
    tokio::fs::create_dir_all(&dir).await.unwrap();
    tokio::fs::write(dir.join("manual.ts"), "process.stdin.on('data', data => { if (data.toString().includes('stop')) process.exit(0) });").await.unwrap();
    let idle = Arc::new(AtomicUsize::new(0));
    let seen = idle.clone();
    let fixture = Fixture::start(move |request| {
        let seen = seen.clone();
        async move {
            if request.uri().path() == "/api/profiles/by-name" {
                return Json(json!({"id":"p", "name":"test", "status":"idle"})).into_response();
            }
            let data = body(request).await;
            if !data["status"].is_null() {
                seen.fetch_add(1, Ordering::Relaxed);
            }
            Json(json!({})).into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let owner = Processes::new(Arc::new(api), root.path().into());
    let (a, b) = tokio::join!(owner.start_manual("test"), owner.start_manual("test"));
    assert_eq!([a.is_ok(), b.is_ok()].iter().filter(|v| **v).count(), 1);
    assert_eq!(owner.ownership().await["processCount"], 1);
    assert!(owner.start_manual("test").await.is_err());
    assert!(owner.stop(false, "test", false).await.unwrap());
    assert_eq!(
        idle.load(Ordering::Relaxed),
        0,
        "process lifecycle cannot clear an existing browser owner's status"
    );
    assert_eq!(owner.ownership().await["processCount"], 0);
    assert!(owner.registry.lock().await.is_empty());
    owner.shutdown().await.unwrap();
    assert!(owner.start_manual("test").await.is_err());
}

#[tokio::test]
async fn automation_uses_started_snapshot_and_yields_capacity() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("server/automation");
    tokio::fs::create_dir_all(&dir).await.unwrap();
    tokio::fs::write(dir.join("worker.ts"), r#"
let input = ''; process.stdin.on('data', data => { input += data.toString(); if (!input.includes('\n')) return;
const payload = JSON.parse(input.split('\n')[0]); if (payload.automation.routine.headless !== true) process.exit(2);
console.log('__EVENT__'+JSON.stringify({type:'worker_waiting',dueAt:2000000000000.25})+'__EVENT__'); process.exit(0); });
"#).await.unwrap();
    let states = Arc::new(Mutex::new(Vec::new()));
    let observed = states.clone();
    let fixture = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            match request.uri().path() {
                "/api/automations/by-id" => {
                    Json(json!({"isActive":true,"routine":{"headless":false}})).into_response()
                }
                "/api/automations/start" => {
                    Json(json!({"isActive":true,"routine":{"headless":true}})).into_response()
                }
                _ => {
                    observed.lock().await.push(body(request).await);
                    Json(json!({})).into_response()
                }
            }
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let owner = Processes::new(Arc::new(api), root.path().into());
    let mut closed = owner.closed.subscribe();
    owner.start_automation("a").await.unwrap();
    let (id, due) = tokio::time::timeout(Duration::from_secs(5), closed.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(id, "a");
    assert_eq!(due, Some(2_000_000_000_001));
    let states = states.lock().await;
    let final_state = states.last().unwrap();
    assert_eq!(final_state["status"], "pending");
    assert!(final_state.get("nodeStates").is_none());
    assert!(final_state.get("currentNodeId").is_none());
    assert!(!owner.is_running("a").await);
}

#[tokio::test]
async fn orphan_cleanup_never_kills_a_recycled_pid_or_a_different_script() {
    let root = tempfile::tempdir().unwrap();
    let owner = Processes::new(Arc::new(Api::from_env().unwrap()), root.path().into());
    let pid = std::process::id();
    let (start, _) = identity(pid).unwrap();
    owner
        .persist(&[Registry {
            pid,
            start,
            script: root.path().join("different.ts"),
        }])
        .await
        .unwrap();
    owner.cleanup_orphans().await.unwrap();
    assert!(identity(pid).is_some());
    assert!(owner.registry.lock().await.is_empty());
    owner
        .persist(&[Registry {
            pid,
            start: start.saturating_sub(100),
            script: std::env::current_exe().unwrap(),
        }])
        .await
        .unwrap();
    owner.cleanup_orphans().await.unwrap();
    assert!(identity(pid).is_some());
}

#[cfg(windows)]
#[tokio::test]
async fn closing_a_worker_job_kills_its_browser_descendants() {
    let root = tempfile::tempdir().unwrap();
    let marker = root.path().join("pid");
    let script = format!("const child = Bun.spawn(['bun','-e','setInterval(()=>{{}},1000)']); await Bun.write({}, String(child.pid)); setInterval(()=>{{}},1000)", serde_json::to_string(&marker.to_string_lossy()).unwrap());
    let mut child = Command::new("bun")
        .args(["--eval", &script])
        .creation_flags(0x08000000)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let group = ProcessTree::attach(&child).unwrap();
    wait_for(async || marker.exists()).await;
    let pid: u32 = tokio::fs::read_to_string(marker)
        .await
        .unwrap()
        .parse()
        .unwrap();
    assert!(identity(pid).is_some());
    child.kill().await.unwrap();
    drop(group);
    wait_for(async || identity(pid).is_none()).await;
}
