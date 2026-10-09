#![recursion_limit = "256"]
mod api;
mod instagram;
mod native;
mod scraper;
#[cfg(test)]
mod test_support;
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
    let _ = rustls::crypto::ring::default_provider().install_default();
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
                break;
            }
            if line.is_err() {
                break;
            }
        }
        // Closing the owner's pipe (including an abrupt Bun exit) stops the helper too.
        let _ = stop.send(());
    });
    tokio::select! { _ = shutdown() => {}, _ = stopped => {} }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "helper".into());
    let api_state = Arc::new(api::Api::from_env()?);
    let app = if mode == "helper" || mode == "supervise" {
        let uploads = Arc::new(uploads::Uploads {
            entries: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(4)),
        });
        let mobile = instagram::Service::new(api_state.clone(), uploads.clone());
        let scraper = scraper::Scraper::start(api_state.clone(), mobile.clone())?;
        let native = native::Native::new(api_state.clone(), mobile.clone(), scraper.clone())?;
        native.processes.cleanup_orphans().await?;
        api_state
            .native
            .set(native.clone())
            .ok()
            .expect("Native services initialize once");
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
            .merge(native::router(native))
            .merge(instagram::router(mobile))
            .merge(scraper::router(scraper))
            .merge(
                Router::new()
                    .route("/uploads", post(uploads::stage))
                    .route("/uploads/{id}", axum::routing::delete(uploads::remove))
                    .with_state(uploads),
            )
    } else {
        return Err("Use helper or supervise".into());
    };
    let app = app
        .route("/health", get(|| async { Json(json!({"ok": true})) }))
        .layer(DefaultBodyLimit::max(15 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(
            api_state.clone(),
            |axum::extract::State(api): axum::extract::State<Arc<api::Api>>,
             request: axum::extract::Request,
             next: axum::middleware::Next| async move {
                use axum::response::IntoResponse;
                if request.uri().path() != "/health"
                    && (api.key.is_empty()
                        || request
                            .headers()
                            .get("authorization")
                            .and_then(|v| v.to_str().ok())
                            != Some(format!("Bearer {}", api.key).as_str()))
                {
                    return axum::http::StatusCode::UNAUTHORIZED.into_response();
                }
                next.run(request).await
            },
        ))
        .layer(middleware::from_fn(ig_service_common::request_log));
    let port = std::env::var("RUNTIME_PORT").unwrap_or_else(|_| "3004".into());
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await?;
    let gateway = Router::new()
        .route("/vnc/{port}/websockify", get(vnc::upgrade))
        .with_state(vnc::Gateway {
            connections: Arc::new(Semaphore::new(64)),
        })
        .layer(middleware::from_fn(ig_service_common::request_log));
    // The reverse proxy reaches the gateway; RFB and helper endpoints stay local.
    let gateway_host = if mode == "supervise" {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    let gateway_port = std::env::var("VNC_GATEWAY_PORT").unwrap_or_else(|_| "3003".into());
    let gateway_listener =
        tokio::net::TcpListener::bind(format!("{gateway_host}:{gateway_port}")).await?;
    let public_api = api::router(api_state.clone());
    let api_port = api::env("SERVER_PORT", "3001");
    let api_listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{api_port}")).await?;
    let auth = api_state.auth.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        auth.register_webhook().await;
    });
    uploads::cleanup_orphans(&std::env::temp_dir(), Duration::from_secs(15 * 60)).await?;
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    let mut gateway_stopped = stopped.clone();
    let mut api_stopped = stopped.clone();
    let mut server = tokio::spawn(async move {
        tokio::try_join!(
            async {
                axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = stopped.changed().await;
                    })
                    .await
            },
            async {
                axum::serve(gateway_listener, gateway)
                    .with_graceful_shutdown(async move {
                        let _ = gateway_stopped.changed().await;
                    })
                    .await
            },
            async {
                axum::serve(
                    api_listener,
                    public_api.into_make_service_with_connect_info::<std::net::SocketAddr>(),
                )
                .with_graceful_shutdown(async move {
                    let _ = api_stopped.changed().await;
                })
                .await
            },
        )
        .map(|_| ())
    });
    if mode == "helper" {
        tokio::select! {
            result = &mut server => {
                if let Some(native) = api_state.native.get() { native.accounts.shutdown().await; native.coordination.shutdown().await; native.processes.shutdown().await?; }
                result??;
            },
            _ = helper_shutdown() => {
                if let Some(native) = api_state.native.get() { native.accounts.shutdown().await; native.coordination.shutdown().await; native.processes.shutdown().await?; }
                let _ = stop.send(true);
                if let Ok(result) = tokio::time::timeout(Duration::from_secs(5), server).await { result??; }
            }
        }
        return Ok(());
    }
    // The API closes its workers before this native controller stops the helper.
    let seed = tokio::process::Command::new("/app/server/scripts/seed-cloak-cache.sh")
        .status()
        .await?;
    if !seed.success() {
        return Err("Browser cache initialization failed".into());
    }
    let mut child = tokio::process::Command::new("bun")
        .arg("dist/index.js")
        .current_dir("/app/server")
        .env("RUNTIME_MANAGED", "1")
        .kill_on_drop(true)
        .spawn()?;
    let result = tokio::select! {
        result = child.wait() => result,
        _ = &mut server => {
            if let Some(native) = api_state.native.get() { native.accounts.shutdown().await; native.coordination.shutdown().await; native.processes.shutdown().await?; }
            child.kill().await?;
            return Err("Native runtime stopped unexpectedly".into());
        },
        _ = shutdown() => {
            if let Some(native) = api_state.native.get() { native.accounts.shutdown().await; native.coordination.shutdown().await; native.processes.shutdown().await?; }
            #[cfg(unix)]
            if let Some(pid) = child.id() { unsafe { libc::kill(pid as i32, libc::SIGTERM); } }
            match tokio::time::timeout(Duration::from_secs(60), child.wait()).await {
                Ok(result) => result,
                Err(_) => { child.kill().await?; child.wait().await }
            }
        }
    }?;
    if let Some(native) = api_state.native.get() {
        native.accounts.shutdown().await;
        native.coordination.shutdown().await;
        native.processes.shutdown().await?;
    }
    let _ = stop.send(true);
    let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    if !result.success() {
        return Err("API process stopped with an error".into());
    }
    Ok(())
}
