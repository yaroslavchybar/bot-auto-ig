mod schedules;
mod uploads;
mod vnc;

use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{Mutex, Semaphore};

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if let Err(error) = run().await {
        ig_service_common::service_error("runtime.failed", &error.to_string());
        std::process::exit(1);
    }
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut term =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
        tokio::select! { _ = term.recv() => {}, _ = tokio::signal::ctrl_c() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn helper_shutdown() {
    let (stop, stopped) = tokio::sync::oneshot::channel();
    // A plain thread avoids keeping Tokio's blocking pool alive on an unread stdin.
    std::thread::spawn(move || {
        use std::io::BufRead;
        for line in std::io::stdin().lock().lines() {
            if matches!(line.as_deref(), Ok("stop")) {
                let _ = stop.send(());
                break;
            }
            if line.is_err() {
                break;
            }
        }
    });
    tokio::select! { _ = shutdown() => {}, _ = async { if stopped.await.is_err() { std::future::pending::<()>().await; } } => {} }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "gateway".into());
    let app = if mode == "gateway" {
        Router::new()
            .route("/vnc/{port}/websockify", get(vnc::upgrade))
            .with_state(vnc::Gateway {
                host: std::env::var("VNC_UPSTREAM_HOST").unwrap_or_else(|_| "server".into()),
                connections: Arc::new(Semaphore::new(64)),
            })
    } else if mode == "helper" || mode == "supervise" {
        let uploads = Arc::new(uploads::Uploads {
            entries: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(4)),
        });
        let cleanup = uploads.clone();
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_secs(60));
            loop {
                timer.tick().await;
                cleanup
                    .entries
                    .lock()
                    .await
                    .retain(|_, upload| upload.is_live());
            }
        });
        Router::new()
            .merge(
                Router::new()
                    .route(
                        "/schedules/{id}",
                        post(schedules::set).delete(schedules::remove),
                    )
                    .route("/schedules/due", get(schedules::due))
                    .with_state(Arc::new(schedules::Schedules::default())),
            )
            .merge(
                Router::new()
                    .route("/uploads", post(uploads::stage))
                    .route("/uploads/{id}", axum::routing::delete(uploads::remove))
                    .with_state(uploads),
            )
    } else {
        return Err("Use gateway, helper or supervise".into());
    };
    let app = app
        .route("/health", get(|| async { Json(json!({"ok": true})) }))
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(middleware::from_fn(ig_service_common::request_log));
    let host = if mode == "gateway" {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    let port = std::env::var("RUNTIME_PORT").unwrap_or_else(|_| {
        if mode == "gateway" {
            "3003".into()
        } else {
            "3004".into()
        }
    });
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}")).await?;
    if mode != "gateway" {
        uploads::cleanup_orphans(&std::env::temp_dir(), Duration::from_secs(15 * 60)).await?;
    }
    if mode != "supervise" {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                if mode == "helper" {
                    helper_shutdown().await
                } else {
                    shutdown().await
                }
            })
            .await?;
        return Ok(());
    }
    // The API closes its workers before this native controller stops the helper.
    let seed = tokio::process::Command::new("/app/server/scripts/seed-cloak-cache.sh")
        .status()
        .await?;
    if !seed.success() {
        return Err("Browser cache initialization failed".into());
    }
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            })
            .await
    });
    let mut child = tokio::process::Command::new("bun")
        .arg("dist/index.js")
        .current_dir("/app/server")
        .env("RUNTIME_MANAGED", "1")
        .kill_on_drop(true)
        .spawn()?;
    let result = tokio::select! {
        result = child.wait() => result,
        _ = shutdown() => {
            #[cfg(unix)]
            if let Some(pid) = child.id() { unsafe { libc::kill(pid as i32, libc::SIGTERM); } }
            match tokio::time::timeout(Duration::from_secs(60), child.wait()).await {
                Ok(result) => result,
                Err(_) => { child.kill().await?; child.wait().await }
            }
        }
    }?;
    let _ = stop.send(());
    let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    if !result.success() {
        return Err("API process stopped with an error".into());
    }
    Ok(())
}
