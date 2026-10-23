use super::*;
use crate::test_support::{body, Fixture};
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn interest_rewrite_is_routed_to_the_bun_worker_not_native_automation_control() {
    let routes: Vec<Operation> = serde_json::from_str(include_str!("worker-routes.json")).unwrap();
    let route = routes
        .iter()
        .find(|route| route.path == "/api/automations/interests/rewrite")
        .unwrap();
    assert_eq!(route.id, "interests.post.rewrite");
    assert_eq!(route.method, "POST");
    assert!(!crate::native::Native::handles(&route.id));
}

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
async fn streamed_json_body_limit_returns_413_and_releases_capacity() {
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
        id: "interests.post.rewrite".into(),
        method: "POST".into(),
        path: "/upload".into(),
        max_body: 8,
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
async fn public_api_proxies_only_json_rewrites_and_native_routes_fail_closed() {
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let worker = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            observed.fetch_add(1, Ordering::SeqCst);
            assert_eq!(request.uri().path(), "/commands/interests.post.rewrite");
            assert_eq!(request.headers()["authorization"], "Bearer worker-key");
            assert_eq!(request.headers()["x-request-id"], "fixture-request-123");
            assert!(request.headers().get("x-worker-params").is_none());
            assert!(request.headers().get("x-worker-method").is_none());
            let input = body(request).await;
            if input["label"] == "limited" {
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    [("retry-after", "60")],
                    Json(json!({"error":"limited"})),
                )
                    .into_response();
            }
            if input["label"] == "malformed" {
                return "not JSON".into_response();
            }
            assert_eq!(input, json!({"label":"fishing"}));
            Json(json!({"description":"Fishing techniques"})).into_response()
        }
    })
    .await;
    let mut state = Api::from_env().unwrap();
    Arc::get_mut(&mut state.auth).unwrap().bypass = true;
    state.worker_url = worker.url.clone();
    state.key = "worker-key".into();
    let public = Fixture::router(router(Arc::new(state))).await;
    let client = reqwest::Client::new();
    let rewrite = format!("{}/api/automations/interests/rewrite", public.url);
    let result = client
        .post(&rewrite)
        .header("x-request-id", "fixture-request-123")
        .json(&json!({"label":"fishing"}))
        .send()
        .await
        .unwrap();
    assert_eq!(result.status(), StatusCode::OK);
    assert_eq!(result.headers()["x-request-id"], "fixture-request-123");
    assert_eq!(
        result.json::<Value>().await.unwrap(),
        json!({"description":"Fishing techniques"})
    );
    let limited = client
        .post(&rewrite)
        .header("x-request-id", "fixture-request-123")
        .json(&json!({"label":"limited"}))
        .send()
        .await
        .unwrap();
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.headers()["retry-after"], "60");
    assert_eq!(
        client
            .post(&rewrite)
            .header("x-request-id", "fixture-request-123")
            .json(&json!({"label":"malformed"}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_GATEWAY
    );
    let before = calls.load(Ordering::SeqCst);
    assert_eq!(
        client
            .post(&rewrite)
            .body("invalid")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        client
            .post(&rewrite)
            .body(vec![0; 4097])
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    for (method, path) in [
        (Method::GET, "/api/profiles/"),
        (Method::GET, "/api/profiles/by-id?id=profile"),
        (Method::POST, "/api/profiles/Profile/start"),
        (
            Method::GET,
            "/api/ig-accounts/models/model/content/posts/content/image",
        ),
        (Method::POST, "/api/displays/5901/file-picker"),
    ] {
        assert_eq!(
            client
                .request(method, format!("{}{path}", public.url))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
    assert_eq!(
        calls.load(Ordering::SeqCst),
        before,
        "native operations and rejected bodies must not reach Bun"
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
            StatusCode::SERVICE_UNAVAILABLE
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
            StatusCode::SERVICE_UNAVAILABLE
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
        (Method::GET, "/api/profiles/"),
        (Method::GET, "/api/displays"),
        (Method::POST, "/api/profiles/Profile/start"),
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
        StatusCode::SERVICE_UNAVAILABLE
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
        "{}/ws?topic=displays",
        public.url.replace("http://", "ws://")
    ))
    .await
    .unwrap();
    state.events.send(json!({"type":"task_started"})).unwrap();
    let payload = json!({"type":"profile_completed","profileId":"p"});
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
    let decision = json!({"type":"session_decision", "displayId":"lease-1",
        "decision":{"kind":"interest","status":"complete","confidence":0.87,"related":true}});
    state.events.send(decision.clone()).unwrap();
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
    assert_eq!(received, decision);
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
