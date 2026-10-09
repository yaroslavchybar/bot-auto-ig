use super::{Failure, Result};
mod output;
use crate::api::{self, Api};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{broadcast, mpsc, oneshot, watch, Mutex},
};

#[derive(Clone, Serialize, Deserialize)]
struct Registry {
    pid: u32,
    script: PathBuf,
    start: u64,
}
#[derive(Default)]
struct Progress {
    due_at: Option<u64>,
    terminal: Option<String>,
    checkpoint: Option<Value>,
    error: Option<String>,
    profiles: HashSet<String>,
    diagnostics: VecDeque<Value>,
    diagnostic_count: u64,
    diagnostic_error: Option<Value>,
}
#[derive(Clone)]
struct CheckpointUpdate {
    status: String,
    checkpoint: Option<Value>,
    error: Option<String>,
}
enum Control {
    Stop(oneshot::Sender<()>),
    Force(oneshot::Sender<()>),
}
struct Job {
    automation: bool,
    id: String,
    started: u64,
    stopping: AtomicBool,
    control: mpsc::Sender<Control>,
    done: watch::Receiver<bool>,
    progress: Mutex<Progress>,
    checkpoints: watch::Sender<Option<CheckpointUpdate>>,
}
pub struct Processes {
    api: Arc<Api>,
    root: PathBuf,
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    registry: Mutex<Vec<Registry>>,
    pub closed: broadcast::Sender<(String, Option<u64>)>,
    pub setup: broadcast::Sender<(String, String)>,
    pub(super) starting: Mutex<()>,
    stopping: AtomicBool,
    log_secrets: Vec<String>,
}
impl Processes {
    pub fn new(api: Arc<Api>, root: PathBuf) -> Arc<Self> {
        let (closed, _) = broadcast::channel(128);
        let mut log_secrets: Vec<_> = std::env::vars()
            .filter(|(key, value)| {
                let key = key.to_ascii_lowercase();
                value.len() >= 4
                    && [
                        "password",
                        "secret",
                        "token",
                        "api_key",
                        "apikey",
                        "private_key",
                        "privatekey",
                    ]
                    .iter()
                    .any(|name| key.contains(name))
            })
            .map(|(_, value)| value)
            .collect();
        if api.key.len() >= 4 {
            log_secrets.push(api.key.clone());
        }
        Arc::new(Self {
            api,
            root,
            jobs: Default::default(),
            registry: Default::default(),
            closed,
            setup: broadcast::channel(1000).0,
            starting: Default::default(),
            stopping: AtomicBool::new(false),
            log_secrets,
        })
    }
    fn key(automation: bool, id: &str) -> String {
        format!("{}:{id}", if automation { "automation" } else { "manual" })
    }
    fn script(&self, relative: &str) -> PathBuf {
        let source = self.root.join("server").join(format!("{relative}.ts"));
        if source.exists() {
            source
        } else {
            self.root.join("server/dist").join(format!("{relative}.js"))
        }
    }
    fn registry_file(&self) -> PathBuf {
        self.root.join("data/native-process-registry.json")
    }
    async fn persist(&self, entries: &[Registry]) -> Result<()> {
        tokio::fs::create_dir_all(self.root.join("data")).await?;
        super::content::atomic_write(&self.registry_file(), &serde_json::to_vec(entries)?).await
    }
    #[cfg(target_os = "linux")]
    pub async fn track_resource(&self, pid: u32) -> Result<()> {
        let (start, args) = tokio::task::spawn_blocking(move || identity(pid))
            .await
            .ok()
            .flatten()
            .ok_or_else(|| Failure::unavailable("Could not verify display process identity"))?;
        let script = args
            .first()
            .map(PathBuf::from)
            .ok_or_else(|| Failure::unavailable("Display process has no executable"))?;
        let mut registry = self.registry.lock().await;
        registry.push(Registry { pid, script, start });
        self.persist(&registry).await
    }
    #[cfg(target_os = "linux")]
    pub async fn forget_resource(&self, pid: u32) {
        let mut registry = self.registry.lock().await;
        registry.retain(|row| row.pid != pid);
        if let Err(error) = self.persist(&registry).await {
            ig_service_common::service_error("display.registry_failed", &error.message);
        }
    }
    pub async fn cleanup_orphans(&self) -> Result<()> {
        let _starting = self.starting.lock().await;
        let file = self.registry_file();
        let entries: Vec<Registry> = match tokio::fs::read(file).await {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(error) => return Err(error.into()),
        };
        let mut unresolved = Vec::new();
        for entry in entries {
            let expected = entry.clone();
            let live = tokio::task::spawn_blocking(move || identity(expected.pid))
                .await
                .map_err(|_| Failure::unavailable("Process identity task failed"))?;
            match live {
                Some((start, args))
                    if start == entry.start
                        && args
                            .iter()
                            .any(|arg| std::path::Path::new(arg) == entry.script) =>
                {
                    kill_tree(entry.pid, true).await;
                    let pid = entry.pid;
                    if tokio::task::spawn_blocking(move || identity(pid).is_some())
                        .await
                        .unwrap_or(true)
                    {
                        unresolved.push(entry);
                    }
                }
                Some((0, _)) => unresolved.push(entry),
                _ => {}
            }
        }
        self.persist(&unresolved).await?;
        *self.registry.lock().await = unresolved;
        Ok(())
    }
    pub async fn start_automation(self: &Arc<Self>, id: &str) -> Result<()> {
        if id.trim().is_empty() || id.len() > 128 {
            return Err(Failure::invalid("automationId is required"));
        }
        let _starting = self.starting.lock().await;
        self.can_start(true, id).await?;
        let automation = self
            .api
            .convex(
                axum::http::Method::GET,
                &encoded("/api/automations/by-id", "automationId", id),
                None,
            )
            .await?;
        if automation.is_null() {
            return Err(Failure::missing("Automation not found"));
        }
        if automation["isActive"] == false {
            return Err(Failure::invalid("Automation is disabled"));
        }
        let automation = self
            .api
            .convex(
                axum::http::Method::POST,
                "/api/automations/start",
                Some(&json!({"id": id})),
            )
            .await?;
        if automation.is_null() {
            return Err(Failure::missing("Automation not found"));
        }
        let payload = json!({"automationId": id, "automation": automation, "parallelProfiles": 1, "yieldWhenIdle": !automation["routine"].is_null()});
        if let Err(error) = self.spawn(true, id, vec![], Some(payload)).await {
            let _ = self.status(id, "failed", None, None).await;
            return Err(error);
        }
        let _ = self
            .api
            .events
            .send(json!({"type": "automation_status", "automationId": id, "status": "running"}));
        Ok(())
    }
    pub async fn start_manual(self: &Arc<Self>, name: &str) -> Result<()> {
        let _starting = self.starting.lock().await;
        self.can_start(false, name).await?;
        let profile = self
            .api
            .convex(
                axum::http::Method::GET,
                &encoded("/api/profiles/by-name", "name", name),
                None,
            )
            .await?;
        if profile.is_null() {
            return Err(Failure::missing("Profile not found"));
        }
        if profile["status"] == "deleting"
            || profile["renameFrom"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
        {
            return Err(Failure::invalid("Profile maintenance is in progress"));
        }
        self.profile_status(name, "running", true).await?;
        if let Err(error) = self
            .spawn(
                false,
                name,
                vec![
                    "--name".into(),
                    name.into(),
                    "--automation-id".into(),
                    "manual".into(),
                ],
                None,
            )
            .await
        {
            let _ = self.profile_status(name, "idle", false).await;
            return Err(error);
        }
        Ok(())
    }
    async fn can_start(&self, automation: bool, id: &str) -> Result<()> {
        if self.stopping.load(Ordering::Relaxed) {
            return Err(Failure::unavailable("Worker controller is stopping"));
        }
        let jobs = self.jobs.lock().await;
        if jobs.contains_key(&Self::key(automation, id)) {
            return Err(Failure::invalid("Browser worker already running"));
        }
        let limit = api::env("AUTOMATION_MAX_CONCURRENCY", "3")
            .parse::<usize>()
            .unwrap_or(3)
            .max(1);
        if automation && jobs.values().filter(|job| job.automation).count() >= limit {
            return Err(Failure {
                status: axum::http::StatusCode::TOO_MANY_REQUESTS,
                message: format!("Too many automations running (max {limit})"),
            });
        }
        if jobs.len() >= 64 {
            return Err(Failure::unavailable("Too many browser workers"));
        }
        Ok(())
    }
    async fn spawn(
        self: &Arc<Self>,
        automation: bool,
        id: &str,
        args: Vec<String>,
        input: Option<Value>,
    ) -> Result<()> {
        let script = self.script(if automation {
            "automation/worker"
        } else {
            "browser/manual"
        });
        let request_id = uuid::Uuid::new_v4().to_string();
        let mut command = Command::new(api::env("BUN", "bun"));
        command
            .arg(&script)
            .args(args)
            .current_dir(&self.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("RUNTIME_MANAGED", "1")
            .env("PROJECT_ROOT", &self.root)
            .env(
                "LOG_SERVICE",
                if automation {
                    "automation-worker"
                } else {
                    "manual-worker"
                },
            )
            .env("LOG_REQUEST_ID", &request_id)
            .env("LOG_AUTOMATION_ID", if automation { id } else { "manual" });
        #[cfg(unix)]
        {
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|_| Failure::unavailable("Could not start Bun browser worker"))?;
        #[cfg(windows)]
        let tree = match ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill().await;
                return Err(error);
            }
        };
        let pid = child
            .id()
            .ok_or_else(|| Failure::unavailable("Browser worker has no process ID"))?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let start =
            tokio::task::spawn_blocking(move || identity(pid).map_or(0, |(start, _)| start))
                .await
                .unwrap_or(0);
        if start == 0 {
            let _ = child.kill().await;
            return Err(Failure::unavailable(
                "Could not verify browser worker identity",
            ));
        }
        {
            let mut registry = self.registry.lock().await;
            registry.push(Registry { pid, script, start });
            if let Err(error) = self.persist(&registry).await {
                registry.retain(|row| row.pid != pid);
                let _ = child.kill().await;
                return Err(error);
            }
        }
        let (control, mut controls) = mpsc::channel(4);
        let (done, done_rx) = watch::channel(false);
        let (checkpoints, mut checkpoint_updates) =
            watch::channel::<Option<CheckpointUpdate>>(None);
        let job = Arc::new(Job {
            automation,
            id: id.into(),
            started: api::now_ms(),
            stopping: AtomicBool::new(false),
            control,
            done: done_rx,
            progress: Default::default(),
            checkpoints,
        });
        let key = Self::key(automation, id);
        self.jobs.lock().await.insert(key.clone(), job.clone());
        let owner = self.clone();
        let checkpoint_owner = owner.clone();
        let checkpoint_id = id.to_owned();
        let (finish_checkpoints, mut finish_updates) = oneshot::channel();
        // Keep only the latest cumulative checkpoint while a Convex write is in flight.
        let checkpoint_writer = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut finish_updates => break,
                    changed = checkpoint_updates.changed() => if changed.is_err() { break; },
                }
                let update = checkpoint_updates.borrow_and_update().clone();
                if let Some(update) = update {
                    if let Err(error) = checkpoint_owner
                        .status(
                            &checkpoint_id,
                            &update.status,
                            update.checkpoint.as_ref(),
                            update.error.as_deref(),
                        )
                        .await
                    {
                        ig_service_common::service_error(
                            "automation.checkpoint_failed",
                            &error.message,
                        );
                    }
                }
            }
        });
        let out_owner = owner.clone();
        let out_job = job.clone();
        let stdout = tokio::spawn(async move { out_owner.output(stdout, out_job, false).await });
        let err_owner = owner.clone();
        let err_job = job.clone();
        let stderr = tokio::spawn(async move { err_owner.output(stderr, err_job, true).await });
        let (ready, input_ready) = oneshot::channel();
        tokio::spawn(async move {
            let started = std::time::Instant::now();
            // The controller owns cleanup before the first cancellable stdin write.
            let input_written = match input {
                Some(input) => tokio::time::timeout(
                    Duration::from_secs(5),
                    stdin.write_all(format!("{input}\n").as_bytes()),
                )
                .await
                .is_ok_and(|result| result.is_ok()),
                None => true,
            };
            let _ = ready.send(input_written);
            if !input_written {
                let _ = child.kill().await;
            }
            let status = loop {
                tokio::select! {
                    status = child.wait() => break status,
                    command = controls.recv() => match command {
                        Some(Control::Stop(sent)) => { let _ = tokio::time::timeout(Duration::from_secs(2), stdin.write_all(b"stop\n")).await; let _ = sent.send(()); },
                        Some(Control::Force(sent)) => { kill_tree(pid, true).await; let _ = child.kill().await; let _ = sent.send(()); },
                        None => { let _ = child.kill().await; break child.wait().await; },
                    }
                }
            };
            #[cfg(windows)]
            drop(tree);
            // Descendants can inherit stdout. Never hang lifecycle cleanup on their pipes.
            let mut stdout = stdout;
            let mut stderr = stderr;
            if tokio::time::timeout(Duration::from_secs(5), &mut stdout)
                .await
                .is_err()
            {
                stdout.abort();
            }
            if tokio::time::timeout(Duration::from_secs(5), &mut stderr)
                .await
                .is_err()
            {
                stderr.abort();
            }
            #[cfg(unix)]
            kill_tree(pid, true).await;
            let _ = finish_checkpoints.send(());
            let _ = checkpoint_writer.await;
            let progress = job.progress.lock().await;
            let stopped = job.stopping.load(Ordering::Relaxed);
            let success = status.as_ref().is_ok_and(|status| status.success());
            let final_status = if stopped || progress.terminal.as_deref() == Some("cancelled") {
                "cancelled"
            } else if !success || progress.terminal.as_deref() == Some("failed") {
                "failed"
            } else if progress.due_at.is_some() {
                "pending"
            } else {
                progress.terminal.as_deref().unwrap_or("completed")
            };
            let due_at = if final_status == "pending" {
                progress.due_at
            } else {
                None
            };
            let checkpoint = progress.checkpoint.clone();
            let error = progress.error.clone();
            let diagnostics = progress.diagnostics.clone();
            let diagnostic_count = progress.diagnostic_count;
            let diagnostic_error = progress.diagnostic_error.clone();
            let final_status = final_status.to_owned();
            drop(progress);
            if automation {
                if let Err(error) = owner
                    .status(
                        &job.id,
                        &final_status,
                        checkpoint.as_ref(),
                        error.as_deref(),
                    )
                    .await
                {
                    ig_service_common::service_error("automation.status_failed", &error.message);
                }
            } else {
                if let Err(error) = owner.profile_status(&job.id, "idle", false).await {
                    ig_service_common::service_error("browser.status_failed", &error.message);
                }
            }
            owner.jobs.lock().await.remove(&key);
            {
                let mut registry = owner.registry.lock().await;
                registry.retain(|row| row.pid != pid);
                if let Err(error) = owner.persist(&registry).await {
                    ig_service_common::service_error("process.registry_failed", &error.message);
                }
            }
            if automation {
                let _ = owner.api.events.send(json!({"type": "automation_status", "automationId": job.id, "status": if due_at.is_some() { "pending" } else { "idle" }}));
                let _ = owner.closed.send((job.id.clone(), due_at));
            }
            let completion = json!({
                "id": uuid::Uuid::new_v4().to_string(), "ts": api::now_ms(),
                "requestId": request_id,
                "event": if automation { "automation.process" } else { "browser.process" },
                "message": "Browser worker finished", "source": "runtime",
                "level": if stopped || (success && diagnostic_error.is_none()) { "info" } else { "error" },
                "outcome": if stopped { "cancelled" } else if success && diagnostic_error.is_none() { "success" } else { "error" },
                "durationMs": started.elapsed().as_millis() as u64,
                "error": diagnostic_error.map(|note| json!({"type":"WorkerOutput", "message":note["message"]})),
                "context": {"workerId": job.id, "pid": pid,
                    "exitCode": status.ok().and_then(|s| s.code()),
                    "notes": diagnostics, "noteCount": diagnostic_count},
                "environment": {"service": "runtime", "runtime": "rust",
                    "commitHash": api::env("COMMIT_SHA", "unknown"),
                    "version": api::env("SERVICE_VERSION", "1.0.0"),
                    "region": api::env("REGION", "unknown"),
                    "instanceId": api::env("INSTANCE_ID", "runtime")}
            });
            println!("{completion}");
            let _ = done.send(true);
        });
        if !input_ready.await.unwrap_or(false) {
            self.stop(automation, id, true).await?;
            return Err(Failure::unavailable(
                "Worker closed stdin before reading input",
            ));
        }
        Ok(())
    }
    async fn output(&self, mut output: impl AsyncRead + Unpin, job: Arc<Job>, stderr: bool) {
        let mut pending = Vec::new();
        let mut buffer = vec![0; 16 * 1024];
        loop {
            let length = match output.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(length) => length,
            };
            pending.extend_from_slice(&buffer[..length]);
            while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
                let line: Vec<_> = pending.drain(..=end).collect();
                self.line(&job, &line, stderr).await;
            }
            if pending.len() > 1024 * 1024 {
                pending.clear();
                ig_service_common::service_error(
                    "worker.output_too_large",
                    "Worker output exceeded the line limit",
                );
            }
        }
        if !pending.is_empty() {
            self.line(&job, &pending, stderr).await;
        }
    }
    async fn line(&self, job: &Job, line: &[u8], stderr: bool) {
        let text = String::from_utf8_lossy(line);
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        if let Some(mut data) = output::control_event(text) {
            let kind = data["type"].as_str().unwrap_or("").to_owned();
            if job.automation {
                let mut progress = job.progress.lock().await;
                if !data["nodeStates"].is_null() {
                    progress.checkpoint = Some(data.clone());
                }
                match kind.as_str() {
                    "worker_waiting" => {
                        progress.due_at = api::timestamp_ms(&data["dueAt"]);
                    }
                    "profile_started" => {
                        if let Some(name) = data["profileName"].as_str() {
                            progress.profiles.insert(name.into());
                        }
                    }
                    "profile_completed" => {
                        if let Some(name) = data["profileName"].as_str() {
                            progress.profiles.remove(name);
                        }
                    }
                    "checkpoint" => {
                        progress.checkpoint = Some(data.clone());
                    }
                    "session_ended" => {
                        progress.terminal = Some(terminal(data["status"].as_str().unwrap_or("")));
                        progress.error = data["error"].as_str().map(str::to_owned);
                    }
                    "model_setup_after_session" => {
                        if let Some(profile) = data["profileId"].as_str() {
                            let _ = self.setup.send((profile.into(), job.id.clone()));
                        }
                    }
                    _ => {}
                }
                if matches!(
                    kind.as_str(),
                    "checkpoint" | "session_started" | "session_ended" | "worker_waiting"
                ) {
                    let status = if kind == "session_ended" {
                        progress.terminal.as_deref().unwrap_or("completed")
                    } else {
                        "running"
                    };
                    let checkpoint = if kind == "session_ended" && data["nodeStates"].is_null() {
                        progress.checkpoint.as_ref()
                    } else {
                        Some(&data)
                    };
                    job.checkpoints.send_replace(Some(CheckpointUpdate {
                        status: status.into(),
                        checkpoint: checkpoint.cloned(),
                        error: data["error"].as_str().map(str::to_owned),
                    }));
                }
                data["automationId"] = json!(job.id);
            }
            if !matches!(
                kind.as_str(),
                "checkpoint"
                    | "worker_waiting"
                    | "model_setup_after_session"
                    | "display_allocated"
                    | "display_released"
            ) {
                if let Some(object) = data.as_object_mut() {
                    object.remove("nodeStates");
                }
                let _ = self.api.events.send(data);
            }
        } else if let Ok(value) = serde_json::from_str::<Value>(text) {
            // Bun's shared logger has already redacted its structured entries.
            if value["event"].is_string()
                && matches!(value["level"].as_str(), Some("info" | "error"))
            {
                if stderr {
                    eprintln!("{value}");
                } else {
                    println!("{value}");
                }
                return;
            }
            self.diagnostic(job, text, stderr).await;
        } else {
            self.diagnostic(job, text, stderr).await;
        }
    }
    async fn diagnostic(&self, job: &Job, text: &str, stderr: bool) {
        let note = output::diagnostic(text, stderr, &self.log_secrets);
        let mut progress = job.progress.lock().await;
        progress.diagnostic_count += 1;
        if note["level"] == "error" {
            // Keep the last error even if later stdout fills the bounded notes buffer.
            progress.diagnostic_error = Some(note.clone());
        }
        progress.diagnostics.push_back(note);
        if progress.diagnostics.len() > 20 {
            progress.diagnostics.pop_front();
        }
    }
    async fn status(
        &self,
        id: &str,
        status: &str,
        checkpoint: Option<&Value>,
        error: Option<&str>,
    ) -> Result<()> {
        let mut body = json!({"id": id, "status": status});
        if let Some(checkpoint) = checkpoint {
            if !checkpoint["nodeStates"].is_null() {
                body["nodeStates"] = checkpoint["nodeStates"].clone();
            }
            if !checkpoint["nodeId"].is_null() {
                body["currentNodeId"] = checkpoint["nodeId"].clone();
            }
        }
        if let Some(error) = error {
            body["error"] = json!(error);
        }
        self.api
            .convex_retry(
                axum::http::Method::POST,
                "/api/automations/update-status",
                Some(&body),
            )
            .await?;
        Ok(())
    }
    async fn profile_status(&self, name: &str, status: &str, using: bool) -> Result<()> {
        self.api
            .convex_retry(
                axum::http::Method::POST,
                "/api/profiles/sync-status",
                Some(&json!({"name": name, "status": status, "using": using})),
            )
            .await?;
        Ok(())
    }
    pub async fn stop(&self, automation: bool, id: &str, force: bool) -> Result<bool> {
        let job = self
            .jobs
            .lock()
            .await
            .get(&Self::key(automation, id))
            .cloned();
        let Some(job) = job else {
            return Ok(false);
        };
        job.stopping.store(true, Ordering::Relaxed);
        let (sent, received) = oneshot::channel();
        let command = if force {
            Control::Force(sent)
        } else {
            Control::Stop(sent)
        };
        let _ = tokio::time::timeout(Duration::from_secs(2), job.control.send(command)).await;
        let _ = tokio::time::timeout(Duration::from_secs(2), received).await;
        let mut done = job.done.clone();
        if !*done.borrow()
            && tokio::time::timeout(
                Duration::from_secs(if force { 10 } else { 20 }),
                done.wait_for(|done| *done),
            )
            .await
            .is_err()
        {
            let (sent, received) = oneshot::channel();
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                job.control.send(Control::Force(sent)),
            )
            .await;
            let _ = tokio::time::timeout(Duration::from_secs(2), received).await;
            if !*done.borrow() {
                tokio::time::timeout(Duration::from_secs(15), done.wait_for(|done| *done))
                    .await
                    .map_err(|_| Failure::unavailable("Browser worker did not stop"))?
                    .map_err(|_| Failure::unavailable("Worker controller disconnected"))?;
            }
        }
        Ok(true)
    }
    pub async fn stop_automations(&self, id: Option<&str>) -> Result<Vec<String>> {
        let ids = if let Some(id) = id {
            vec![id.into()]
        } else {
            self.jobs
                .lock()
                .await
                .values()
                .filter(|job| job.automation)
                .map(|job| job.id.clone())
                .collect()
        };
        let mut stopped = Vec::new();
        for id in ids {
            if self.stop(true, &id, false).await? {
                stopped.push(id);
            }
        }
        Ok(stopped)
    }
    pub async fn shutdown(&self) -> Result<()> {
        let _starting = self.starting.lock().await;
        self.stopping.store(true, Ordering::Relaxed);
        let jobs: Vec<_> = self
            .jobs
            .lock()
            .await
            .values()
            .map(|job| (job.automation, job.id.clone()))
            .collect();
        let results = futures_util::future::join_all(
            jobs.into_iter()
                .map(|(automation, id)| async move { self.stop(automation, &id, false).await }),
        )
        .await;
        for result in results {
            result?;
        }
        Ok(())
    }
    pub async fn is_running(&self, id: &str) -> bool {
        self.jobs.lock().await.contains_key(&Self::key(true, id))
    }
    pub async fn status_value(&self, id: Option<&str>) -> Value {
        let jobs = self.jobs.lock().await;
        if let Some(id) = id {
            let job = jobs.get(&Self::key(true, id));
            return json!({"automationId": id, "status": job.map_or("idle", |j| if j.stopping.load(Ordering::Relaxed) { "stopping" } else { "running" }), "running": job.is_some(), "startedAt": job.map(|j| j.started)});
        }
        let jobs: Vec<_> = jobs.values().filter(|job| job.automation).map(|job| json!({"automationId": job.id, "status": if job.stopping.load(Ordering::Relaxed) { "stopping" } else { "running" }, "startedAt": job.started})).collect();
        json!({"running": !jobs.is_empty(), "runningCount": jobs.len(), "automations": jobs})
    }
    pub async fn ownership(&self) -> Value {
        let jobs: Vec<_> = self.jobs.lock().await.values().cloned().collect();
        let mut manuals = Vec::new();
        let mut automations = Vec::new();
        let mut names = HashSet::new();
        for job in &jobs {
            if job.automation {
                let profiles: Vec<_> = job.progress.lock().await.profiles.iter().cloned().collect();
                names.extend(profiles.iter().cloned());
                automations.push(json!({"automationId": job.id, "profiles": profiles}));
            } else {
                names.insert(job.id.clone());
                manuals.push(job.id.clone());
            }
        }
        json!({"manuals": manuals, "automations": automations, "activeProfileNames": names, "processCount": jobs.len()})
    }
    pub async fn stop_owners(&self, names: &[String]) -> Result<()> {
        let jobs: Vec<_> = self.jobs.lock().await.values().cloned().collect();
        for job in jobs {
            if if job.automation {
                job.progress
                    .lock()
                    .await
                    .profiles
                    .iter()
                    .any(|name| names.contains(name))
            } else {
                names.contains(&job.id)
            } {
                self.stop(job.automation, &job.id, false).await?;
            }
        }
        Ok(())
    }
}
fn terminal(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "failed" => "failed",
        "cancelled" | "stopped" => "cancelled",
        _ => "completed",
    }
    .into()
}
#[cfg(test)]
mod terminal_tests;
#[cfg(test)]
mod tests;
/// Windows closes the whole worker tree even if Bun exits before its browser children.
#[cfg(windows)]
struct ProcessTree(std::os::windows::io::OwnedHandle);
#[cfg(windows)]
impl ProcessTree {
    fn attach(child: &tokio::process::Child) -> Result<Self> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(Failure::unavailable(
                    "Could not create worker process group",
                ));
            }
            let group = Self(OwnedHandle::from_raw_handle(handle));
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                group.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(
                    group.0.as_raw_handle(),
                    child
                        .raw_handle()
                        .ok_or_else(|| Failure::unavailable("Browser worker already exited"))?,
                ) == 0
            {
                return Err(Failure::unavailable(
                    "Could not contain browser worker descendants",
                ));
            }
            Ok(group)
        }
    }
}
fn encoded(path: &str, key: &str, value: &str) -> String {
    let url = reqwest::Url::parse_with_params("http://local/", [(key, value)]).unwrap();
    format!("{path}?{}", url.query().unwrap())
}
fn identity(pid: u32) -> Option<(u64, Vec<std::ffi::OsString>)> {
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(pid)]),
        true,
        sysinfo::ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always),
    );
    system
        .process(sysinfo::Pid::from_u32(pid))
        .map(|p| (p.start_time(), p.cmd().to_vec()))
}
pub async fn kill_tree(pid: u32, force: bool) {
    #[cfg(unix)]
    unsafe {
        libc::kill(
            -(pid as i32),
            if force { libc::SIGKILL } else { libc::SIGTERM },
        );
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T"]);
        if force {
            command.arg("/F");
        }
        command
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = tokio::time::timeout(Duration::from_secs(5), command.status()).await;
    }
}
