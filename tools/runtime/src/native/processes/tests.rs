use super::*;
use crate::test_support::{body, Fixture};
use axum::{response::IntoResponse, Json};
use std::sync::atomic::AtomicUsize;

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
async fn concurrent_manual_starts_have_one_owner_until_idle_status_is_saved() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("server/browser");
    tokio::fs::create_dir_all(&dir).await.unwrap();
    tokio::fs::write(dir.join("manual.ts"), "process.stdin.on('data', data => { if (data.toString().includes('stop')) process.exit(0) });").await.unwrap();
    let idle = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(tokio::sync::Notify::new());
    let seen = idle.clone();
    let finish = release.clone();
    let fixture = Fixture::start(move |request| {
        let seen = seen.clone();
        let finish = finish.clone();
        async move {
            if request.uri().path() == "/api/profiles/by-name" {
                return Json(json!({"id":"p", "name":"test", "status":"idle"})).into_response();
            }
            let data = body(request).await;
            if data["status"] == "idle" {
                seen.fetch_add(1, Ordering::Relaxed);
                finish.notified().await;
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
    let stopping = {
        let owner = owner.clone();
        tokio::spawn(async move { owner.stop(false, "test", false).await.unwrap() })
    };
    wait_for(async || idle.load(Ordering::Relaxed) == 1).await;
    assert_eq!(owner.ownership().await["processCount"], 1);
    assert!(owner.start_manual("test").await.is_err());
    release.notify_one();
    assert!(stopping.await.unwrap());
    assert_eq!(owner.ownership().await["processCount"], 0);
    assert!(owner.registry.lock().await.is_empty());
    owner.shutdown().await.unwrap();
    assert!(owner.start_manual("test").await.is_err());
}

#[tokio::test]
async fn automation_uses_started_snapshot_saves_final_checkpoint_and_yields_capacity() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("server/automation");
    tokio::fs::create_dir_all(&dir).await.unwrap();
    tokio::fs::write(dir.join("worker.ts"), r#"
let input = ''; process.stdin.on('data', data => { input += data.toString(); if (!input.includes('\n')) return;
const payload = JSON.parse(input.split('\n')[0]); if (payload.automation.currentNodeId !== null) process.exit(2);
console.log('__EVENT__'+JSON.stringify({type:'checkpoint',nodeId:'new',nodeStates:{new:'done'}})+'__EVENT__');
console.log('__EVENT__'+JSON.stringify({type:'worker_waiting',dueAt:Date.now()+60000})+'__EVENT__'); process.exit(0); });
"#).await.unwrap();
    let states = Arc::new(Mutex::new(Vec::new()));
    let observed = states.clone();
    let fixture = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            match request.uri().path() {
                "/api/automations/by-id" => {
                    Json(json!({"isActive":true,"currentNodeId":"old"})).into_response()
                }
                "/api/automations/start" => {
                    Json(json!({"isActive":true,"routine":{},"currentNodeId":null,"nodeStates":{}}))
                        .into_response()
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
    assert!(due.is_some());
    let states = states.lock().await;
    let final_state = states.last().unwrap();
    assert_eq!(final_state["status"], "pending");
    assert_eq!(final_state["nodeStates"], json!({"new":"done"}));
    assert_eq!(final_state["currentNodeId"], "new");
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
