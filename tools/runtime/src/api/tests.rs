use super::*;
use crate::test_support::{body, Fixture};
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn timestamps_accept_integer_and_fractional_numbers_but_reject_invalid_values() {
    assert_eq!(
        timestamp_ms(&json!(1_791_572_361_635u64)),
        Some(1_791_572_361_635)
    );
    assert_eq!(
        timestamp_ms(&json!(1_791_572_361_635.0)),
        Some(1_791_572_361_635)
    );
    assert_eq!(
        timestamp_ms(&json!(1_791_572_361_635.119_4)),
        Some(1_791_572_361_636)
    );
    assert_eq!(timestamp_ms(&json!(0)), Some(0));
    for invalid in [
        Value::Null,
        json!(-1),
        json!(-0.25),
        json!("1791572361635"),
        json!(true),
        json!(1e30),
    ] {
        assert_eq!(timestamp_ms(&invalid), None);
    }
}

#[tokio::test]
async fn convex_retry_only_replays_transient_failures_for_explicit_safe_calls() {
    for (status, method, safe, expected) in [
        (StatusCode::TOO_MANY_REQUESTS, Method::POST, true, 2),
        (StatusCode::SERVICE_UNAVAILABLE, Method::POST, true, 2),
        (StatusCode::BAD_REQUEST, Method::POST, true, 1),
        (StatusCode::SERVICE_UNAVAILABLE, Method::POST, false, 1),
        (StatusCode::OK, Method::POST, true, 1),
        (StatusCode::SERVICE_UNAVAILABLE, Method::GET, false, 2),
    ] {
        let attempts = Arc::new(AtomicUsize::new(0));
        let seen = attempts.clone();
        let fixture = Fixture::start(move |_| {
            let seen = seen.clone();
            async move {
                if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                    return (status, "invalid response").into_response();
                }
                Json(json!({"saved":true})).into_response()
            }
        })
        .await;
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.key = "fixture".into();
        let result = if safe {
            api.convex_retry(method, "/status", Some(&json!({}))).await
        } else {
            api.convex(method, "/claim", Some(&json!({}))).await
        };
        assert_eq!(result.is_ok(), expected == 2);
        assert_eq!(attempts.load(Ordering::SeqCst), expected);
    }
}

#[tokio::test]
async fn bounded_json_handles_large_prefixed_data_and_rejects_oversized_bodies() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let expected = json!({"text":"Привіт 🚀".repeat(16_384)});
    let encoded = Arc::new(format!("for (;;);{expected}"));
    let fixture = Fixture::start(move |request| {
        let encoded = encoded.clone();
        async move {
            match request.uri().path() {
                "/large" => encoded.as_str().to_owned().into_response(),
                "/invalid" => "invalid JSON".into_response(),
                "/declared" => Response::builder()
                    .header(header::CONTENT_LENGTH, "1000")
                    .body(Body::from_stream(futures_util::stream::pending::<
                        Result<axum::body::Bytes, std::io::Error>,
                    >()))
                    .unwrap(),
                _ => Body::from_stream(futures_util::stream::iter([
                    Ok::<_, std::io::Error>("{\"text\":"),
                    Ok("\"too large\"}"),
                ]))
                .into_response(),
            }
        }
    })
    .await;
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/large", fixture.url))
        .send()
        .await
        .unwrap();
    assert_eq!(bounded_json(response, 1_000_000).await.unwrap(), expected);
    let response = client
        .get(format!("{}/invalid", fixture.url))
        .send()
        .await
        .unwrap();
    assert_eq!(
        bounded_json(response, 100).await.unwrap_err(),
        "Invalid JSON response"
    );
    for path in ["declared", "chunked"] {
        let response = client
            .get(format!("{}/{path}", fixture.url))
            .send()
            .await
            .unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), bounded_json(response, 10))
                .await
                .unwrap()
                .unwrap_err(),
            "Response too large"
        );
    }
}

#[tokio::test]
async fn streamed_body_limit_returns_413_and_releases_capacity() {
    let worker = Fixture::start(|request| async {
        match axum::body::to_bytes(request.into_body(), 100).await {
            Ok(bytes) => bytes.into_response(),
            Err(_) => StatusCode::BAD_REQUEST.into_response(),
        }
    })
    .await;
    let mut state = Api::from_env().unwrap();
    Arc::get_mut(&mut state.auth).unwrap().bypass = true;
    state.worker_url = worker.url.clone();
    state.slots = Arc::new(Semaphore::new(1));
    let slots = state.slots.clone();
    let state = Arc::new(state);
    let operation = Arc::new(Operation {
        id: "fixture".into(),
        method: "POST".into(),
        path: "/upload".into(),
        body: "stream".into(),
        max_body: 8,
        image_read: false,
    });
    let router = Router::new()
        .route(
            "/upload",
            axum::routing::post(move |State(state): State<Arc<Api>>, request: Request| {
                invoke(state, operation.clone(), HashMap::new(), request)
            })
            .layer(RequestBodyLimitLayer::new(8)),
        )
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(state, policy));
    let public = Fixture::router(router).await;
    let stream =
        futures_util::stream::iter([Ok::<_, std::io::Error>(vec![0u8; 4]), Ok(vec![0u8; 8])]);
    let response = reqwest::Client::new()
        .post(format!("{}/upload", public.url))
        .body(reqwest::Body::wrap_stream(stream))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    response.bytes().await.unwrap();
    tokio::task::yield_now().await;
    assert_eq!(slots.available_permits(), 1);
}

#[tokio::test]
async fn api_preserves_parameters_streams_images_profiles_and_body_limits() {
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let worker = Fixture::start(move |request| {
        let calls = observed.clone();
        async move {
            calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(request.headers()["authorization"], "Bearer worker-key");
            let path = request.uri().path().to_string();
            if path == "/health" {
                return Json(json!({"ok":true})).into_response();
            }
            assert_eq!(request.headers()["x-request-id"], "fixture-request-123");
            let params: Value = serde_json::from_slice(
                &URL_SAFE_NO_PAD
                    .decode(request.headers()["x-worker-params"].as_bytes())
                    .unwrap(),
            )
            .unwrap();
            if path.ends_with("image") {
                return (
                    [("content-type", "image/jpeg"), ("vary", "Authorization")],
                    vec![255u8, 216, 255, 217],
                )
                    .into_response();
            }
            if path.ends_with("name_start") {
                assert_eq!(params["name"], "Profile A");
                assert_eq!(request.headers()["x-worker-method"], "POST");
                assert_eq!(body(request).await, json!({"value":42}));
                return Json(json!({"success":true})).into_response();
            }
            if path.ends_with("profileId_connect") {
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    [("retry-after", "60")],
                    Json(json!({"error":{"message":"Instagram is limiting requests."}})),
                )
                    .into_response();
            }
            if path == "/commands/chat.get.archives" {
                assert_eq!(params, json!({}));
                return Json(json!([{"profileId":"profile", "threadId":"123"}])).into_response();
            }
            if path == "/commands/chat.post.profileId_archive" {
                assert_eq!(params["profileId"], "profile");
                assert_eq!(
                    body(request).await,
                    json!({"threadId":"123", "archived":true})
                );
                return Json(json!([{"profileId":"profile", "threadId":"123"}])).into_response();
            }
            if path.contains("file-picker") {
                assert_eq!(request.headers()["x-worker-method"], "POST");
                let bytes = axum::body::to_bytes(request.into_body(), 100)
                    .await
                    .unwrap();
                return bytes.into_response();
            }
            Json(json!([])).into_response()
        }
    })
    .await;
    let convex=Fixture::start(|request|async move{
        assert_eq!(request.headers()["authorization"],"Bearer worker-key");
        if request.uri().path()=="/api/profiles/by-id"{assert_eq!(request.uri().query(),Some("profileId=profile"));return Json(json!({"id":"profile","cookiesJson":"editable","sessionId":"private-session","login":"private-login","testIp":"private-ip"})).into_response();}
        Json(json!([{"id":"profile","cookiesJson":"private-cookies","sessionId":"private-session","name":"Profile"}])).into_response()
    }).await;
    let mut state = Api::from_env().unwrap();
    Arc::get_mut(&mut state.auth).unwrap().bypass = true;
    state.worker_url = worker.url.clone();
    state.key = "worker-key".into();
    state.convex_url = convex.url.clone();
    let public = Fixture::router(router(Arc::new(state))).await;
    let client = reqwest::Client::new();
    let start = client
        .post(format!("{}/api/profiles/Profile%20A/start", public.url))
        .header("x-request-id", "fixture-request-123")
        .json(&json!({"value":42}))
        .send()
        .await
        .unwrap();
    assert_eq!(start.status(), StatusCode::OK);
    assert_eq!(start.headers()["x-request-id"], "fixture-request-123");
    let reconnect = client
        .post(format!("{}/api/ig-accounts/profile/connect", public.url))
        .header("x-request-id", "fixture-request-123")
        .json(&json!({"credentialId":"account"}))
        .send()
        .await
        .unwrap();
    assert_eq!(reconnect.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reconnect.headers()["retry-after"], "60");
    for method in [Method::GET, Method::POST] {
        let path = if method == Method::GET {
            "/api/chat/archives"
        } else {
            "/api/chat/profile/archive"
        };
        let mut request = client
            .request(method.clone(), format!("{}{path}", public.url))
            .header("x-request-id", "fixture-request-123");
        if method == Method::POST {
            request = request.json(&json!({
                "threadId":"123", "archived":true
            }));
        }
        let response = request.send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.json::<Value>().await.unwrap(),
            json!([{"profileId":"profile", "threadId":"123"}])
        );
    }
    let profiles: Value = client
        .get(format!("{}/api/profiles/", public.url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(profiles, json!([{"id":"profile","name":"Profile"}]));
    let profile: Value = client
        .get(format!("{}/api/profiles/by-id?id=profile", public.url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(profile, json!({"id":"profile","cookiesJson":"editable"}));
    assert_eq!(
        client
            .get(format!("{}/api/profiles/by-id", public.url))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    let image = client
        .get(format!(
            "{}/api/ig-accounts/models/model/content/posts/content/image",
            public.url
        ))
        .header("x-request-id", "fixture-request-123")
        .header("origin", "http://localhost:5173")
        .send()
        .await
        .unwrap();
    assert_eq!(image.status(), StatusCode::OK);
    assert_eq!(image.headers()["cache-control"], "private, max-age=3600");
    assert!(image
        .headers()
        .get_all("vary")
        .iter()
        .any(|v| v == "Authorization"));
    assert_eq!(image.bytes().await.unwrap().as_ref(), &[255, 216, 255, 217]);
    let upload = client
        .post(format!("{}/api/displays/5901/file-picker", public.url))
        .header("x-request-id", "fixture-request-123")
        .body(vec![0u8, 255, 1, 128])
        .send()
        .await
        .unwrap();
    assert_eq!(upload.status(), StatusCode::OK);
    assert_eq!(upload.bytes().await.unwrap().as_ref(), &[0, 255, 1, 128]);
    let before = calls.load(Ordering::SeqCst);
    assert_eq!(
        client
            .post(format!("{}/api/profiles", public.url))
            .header("content-type", "application/json")
            .body("invalid")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    // Declared oversized bodies are rejected before any bytes reach the worker.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let address = public.url.trim_start_matches("http://");
    let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
    socket.write_all(format!("POST /api/profiles HTTP/1.1\r\nHost: {address}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",1024*1024+1).as_bytes()).await.unwrap();
    let mut response = vec![];
    tokio::time::timeout(Duration::from_secs(3), socket.read_to_end(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 413"));
    assert_eq!(calls.load(Ordering::SeqCst), before);
    assert_eq!(
        client
            .get(format!("{}/api/health", public.url))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn gallery_quota_is_separate_and_internal_key_is_limited_to_automation() {
    let worker = Fixture::start(|_| async { Json(json!({"ok":true})).into_response() }).await;
    let mut state = Api::from_env().unwrap();
    Arc::get_mut(&mut state.auth).unwrap().bypass = true;
    state.worker_url = worker.url.clone();
    state.key = "fixture".into();
    let public = Fixture::router(router(Arc::new(state))).await;
    let client = reqwest::Client::new();
    for _ in 0..120 {
        assert_eq!(
            client
                .get(format!(
                    "{}/api/ig-accounts/models/model/content/posts/content/image",
                    public.url
                ))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    for _ in 0..100 {
        assert_eq!(
            client
                .get(format!("{}/api/ig-accounts/warmup", public.url))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    assert_eq!(
        client
            .get(format!("{}/api/ig-accounts/warmup", public.url))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    let mut state = Api::from_env().unwrap();
    Arc::get_mut(&mut state.auth).unwrap().bypass = false;
    Arc::get_mut(&mut state.auth).unwrap().production = true;
    state.worker_url = worker.url.clone();
    state.key = "fixture".into();
    let public = Fixture::router(router(Arc::new(state))).await;
    for (method, path) in [
        (Method::GET, "/api/chat/archives"),
        (Method::GET, "/api/chat/profile/avatars/42/image"),
        (Method::POST, "/api/chat/profile/archive"),
    ] {
        for token in [None, Some("invalid-session"), Some("fixture")] {
            let mut request = client.request(method.clone(), format!("{}{path}", public.url));
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            assert_eq!(
                request.send().await.unwrap().status(),
                StatusCode::UNAUTHORIZED
            );
        }
    }
    assert_eq!(
        client
            .get(format!("{}/api/ig-accounts/warmup", public.url))
            .bearer_auth("fixture")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .get(format!("{}/api/automations/status", public.url))
            .bearer_auth("fixture")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        client
            .post(format!("{}/api/auth/dev-login", public.url))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn public_events_are_native_and_filter_topics_without_a_bun_worker() {
    let mut state = Api::from_env().unwrap();
    Arc::get_mut(&mut state.auth).unwrap().bypass = true;
    state.worker_url = "http://127.0.0.1:1".into();
    let state = Arc::new(state);
    let public = Fixture::router(router(state.clone())).await;
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "{}/ws?topic=chat",
        public.url.replace("http://", "ws://")
    ))
    .await
    .unwrap();
    state
        .events
        .send(json!({"type":"display_allocated"}))
        .unwrap();
    let payload = json!({"type":"chat_changed","profileId":"p"});
    state.events.send(payload.clone()).unwrap();
    use futures_util::StreamExt;
    let received = tokio::time::timeout(Duration::from_secs(1), async {
        while let Some(Ok(message)) = socket.next().await {
            if message.is_text() {
                return serde_json::from_str::<Value>(&message.into_text().unwrap()).unwrap();
            }
        }
        panic!("Native event feed ended")
    })
    .await
    .unwrap();
    assert_eq!(received, payload);
    socket.close(None).await.unwrap();
}

#[test]
fn trusted_proxy_hop_count_uses_rightmost_hops() {
    let mut request = Request::new(Body::empty());
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()));
    assert_eq!(client_ip(&request), "127.0.0.1");
    request.headers_mut().insert(
        "x-forwarded-for",
        "forged, 203.0.113.1, 10.0.0.1".parse().unwrap(),
    );
    assert_eq!(client_ip(&request), "203.0.113.1");
}
