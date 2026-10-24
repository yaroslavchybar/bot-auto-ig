use super::*;
use crate::{
    native::{
        accounts::Accounts, content::Content, coordination::Coordination, displays::Displays,
        processes::Processes, profiles::Profiles, subscriptions::Subscriptions,
    },
    test_support::{body, Fixture},
};
use axum::{response::IntoResponse, Json};
use futures_util::StreamExt;
use serde_json::json;
use tokio::io::AsyncWriteExt;

fn api() -> Api {
    let mut api = Api::from_env().unwrap();
    Arc::get_mut(&mut api.auth).unwrap().bypass = true;
    api
}

fn services(api: Arc<Api>, root: &std::path::Path) -> Arc<Native> {
    let content = Content::new(root.join("content"));
    let processes = Processes::new(api.clone(), root.into());
    let profiles = Profiles::new(api.clone(), processes.clone(), root.into());
    let subscriptions = Subscriptions::new(api.clone());
    let native = Arc::new(Native {
        displays: Displays::new(api.clone(), processes.clone()),
        accounts: Accounts::new(
            api.clone(),
            profiles.clone(),
            content.clone(),
            subscriptions.clone(),
        ),
        coordination: Coordination::new(
            api.clone(),
            subscriptions.clone(),
            processes.clone(),
            crate::scraper::Scraper::start(api.clone()).unwrap(),
        ),
        api: api.clone(),
        content,
        processes,
        profiles,
        subscriptions,
    });
    api.native.set(native.clone()).ok().unwrap();
    native
}

#[tokio::test]
async fn public_routes_keep_methods_and_static_aliases_without_a_native_fallback() {
    let public = Fixture::router(crate::api::router(Arc::new(api()))).await;
    let client = reqwest::Client::new();
    for (method, path) in [
        (Method::GET, "/api/profiles"),
        (Method::POST, "/api/profiles"),
        (Method::GET, "/api/profiles/by-id"),
        (Method::PUT, "/api/profiles/Name"),
        (Method::DELETE, "/api/profiles/Name"),
        (Method::POST, "/api/profiles/Name/start"),
        (Method::POST, "/api/profiles/Name/stop"),
        (Method::POST, "/api/profiles/reconcile-runtime"),
        (Method::POST, "/api/automations/stop"),
        (Method::GET, "/api/ig-accounts/page"),
        (Method::GET, "/api/ig-accounts/available-count"),
        (Method::GET, "/api/ig-accounts/blacklist"),
        (Method::GET, "/api/ig-accounts/warmup"),
        (Method::POST, "/api/ig-accounts/warmup/profile/reconcile"),
        (Method::GET, "/api/ig-accounts/credentials/id"),
        (Method::GET, "/api/ig-accounts/models/model/content"),
        (
            Method::GET,
            "/api/ig-accounts/models/model/content/posts/image/image",
        ),
        (Method::POST, "/api/ig-accounts/models/model/content/posts"),
        (
            Method::GET,
            "/api/ig-accounts/models/model/content/posts/image/copies",
        ),
        (
            Method::POST,
            "/api/ig-accounts/models/model/content/posts/image/copies",
        ),
        (
            Method::GET,
            "/api/ig-accounts/models/model/content/posts/image/copies/variant/image",
        ),
        (
            Method::DELETE,
            "/api/ig-accounts/models/model/content/posts/image",
        ),
        (Method::POST, "/api/ig-accounts/import"),
        (Method::POST, "/api/ig-accounts/create-batch"),
        (Method::POST, "/api/ig-accounts/profile/connect"),
        (Method::GET, "/api/displays/5901/clipboard"),
        (Method::POST, "/api/displays/5901/clipboard"),
        (Method::GET, "/api/displays/5901/file-picker"),
        (Method::POST, "/api/displays/5901/file-picker"),
        (Method::DELETE, "/api/displays/5901/file-picker"),
        (Method::GET, "/api/displays/5901/preview"),
        (Method::GET, "/api/displays"),
    ] {
        let response = client
            .request(method.clone(), format!("{}{path}", public.url))
            .body("{}")
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "{method} {path}"
        );
        assert_eq!(
            response.json::<Value>().await.unwrap()["error"]["code"],
            "NATIVE_UNAVAILABLE"
        );
        // The original API provides slash aliases only for static paths.
        if !path.trim_start_matches("/api/").contains('/')
            || [
                "/api/profiles/by-id",
                "/api/profiles/reconcile-runtime",
                "/api/automations/stop",
                "/api/ig-accounts/page",
                "/api/ig-accounts/available-count",
                "/api/ig-accounts/blacklist",
                "/api/ig-accounts/warmup",
                "/api/ig-accounts/import",
                "/api/ig-accounts/create-batch",
            ]
            .contains(&path)
        {
            assert_eq!(
                client
                    .request(method, format!("{}{path}/", public.url))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::SERVICE_UNAVAILABLE
            );
        }
    }
    assert_eq!(
        client
            .put(format!("{}/api/displays/5901/file-picker", public.url))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
}

#[tokio::test]
async fn native_body_limits_distinguish_json_images_and_streamed_file_picker_uploads() {
    let upstream =
        Fixture::start(|_| async { Json(json!([{"id":"model"}])).into_response() }).await;
    let root = tempfile::tempdir().unwrap();
    let mut state = api();
    state.convex_url = upstream.url.clone();
    state.key = "fixture".into();
    let state = Arc::new(state);
    let native = services(state.clone(), root.path());
    let public = Fixture::router(crate::api::router(state)).await;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    for (path, bytes, expected) in [
        (
            "/api/profiles",
            1024 * 1024 + 1,
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
        (
            "/api/ig-accounts/models/model/content/posts?name=photo.png",
            2 * 1024 * 1024,
            StatusCode::OK,
        ),
        (
            "/api/ig-accounts/models/model/content/posts?name=photo.png",
            15 * 1024 * 1024 + 1,
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
        (
            "/api/displays/5901/file-picker",
            2 * 1024 * 1024,
            StatusCode::NOT_FOUND,
        ),
        (
            "/api/displays/5901/file-picker",
            51 * 1024 * 1024 + 1,
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
    ] {
        let request = client.post(format!("{}{path}", public.url));
        // Early rejections must not race a large upload into a Windows TCP reset.
        let request = if expected != StatusCode::OK {
            request
                .header("Content-Length", bytes.to_string())
                .body(reqwest::Body::wrap_stream(futures_util::stream::pending::<
                    std::result::Result<Vec<u8>, std::io::Error>,
                >()))
        } else {
            request.body(vec![0; bytes])
        };
        assert_eq!(
            request.send().await.unwrap().status(),
            expected,
            "{path}: {bytes}"
        );
    }
    let chunks = futures_util::stream::iter([
        Ok::<_, std::io::Error>(vec![b' '; 600_000]),
        Ok(vec![b' '; JSON_LIMIT + 1 - 600_000]),
    ])
    .chain(futures_util::stream::pending());
    assert_eq!(
        client
            .post(format!("{}/api/profiles", public.url))
            .body(reqwest::Body::wrap_stream(chunks))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        client
            .get(format!("{}/api/displays/not-a-port/preview", public.url))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["message"],
        "Invalid display port"
    );
    native.shutdown().await.unwrap();
}

#[tokio::test]
async fn disconnected_native_mutation_finishes_after_its_http_handler_is_dropped() {
    let root = tempfile::tempdir().unwrap();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let waiting = entered.clone();
    let resume = release.clone();
    let upstream = Fixture::start(move |request| {
        let waiting = waiting.clone();
        let resume = resume.clone();
        async move {
            assert_eq!(request.uri().path(), "/api/profiles");
            assert_eq!(body(request).await["name"], "Fixture");
            waiting.notify_one();
            resume.notified().await;
            Json(json!({"ok":true})).into_response()
        }
    })
    .await;
    let mut state = api();
    state.convex_url = upstream.url.clone();
    state.key = "fixture".into();
    let state = Arc::new(state);
    let native = services(state.clone(), root.path());
    let public = Fixture::router(crate::api::router(state)).await;
    let mut socket = tokio::net::TcpStream::connect(public.url.trim_start_matches("http://"))
        .await
        .unwrap();
    let body = r#"{"name":"Fixture"}"#;
    socket.write_all(format!("POST /api/profiles HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
        .await
        .unwrap();
    drop(socket);
    release.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !root.path().join("data/profiles").exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    native.shutdown().await.unwrap();
}
