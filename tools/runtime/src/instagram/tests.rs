use super::*;
use crate::test_support::{self, Fixture};
use axum::{http::StatusCode, response::IntoResponse, Json};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use transport::{Fields, Mobile};

#[test]
fn verification_contexts_match_instagrapi_3_0_24() {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/instagrapi-contexts.json")).unwrap();
    for (index, case) in cases.as_array().unwrap().iter().enumerate() {
        assert_eq!(
            caa::extract_context(&case["input"]),
            case["expected"].as_str().unwrap(),
            "Reference case {index}"
        );
    }
}

#[tokio::test]
async fn runtime_pigeon_id_is_stable_per_transport_and_independent_of_saved_device() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let observed = captured.clone();
    let fixture = Fixture::start(move |request| {
        let captured = observed.clone();
        async move {
            assert!(!request.headers().contains_key("x-ig-salt-ids"));
            captured.lock().await.push((
                request.headers()["x-pigeon-session-id"]
                    .to_str()
                    .unwrap()
                    .to_string(),
                request.headers()["x-pigeon-rawclienttime"]
                    .to_str()
                    .unwrap()
                    .to_string(),
            ));
            Json(json!({"status":"ok"})).into_response()
        }
    })
    .await;
    let mut first = mobile(Some(fixture.url.clone()));
    let mut second = mobile(Some(fixture.url.clone()));
    assert_eq!(first.state.device_id, second.state.device_id);
    first
        .request(
            "i.instagram.com",
            Method::GET,
            "/probe",
            None,
            &Fields::new(),
        )
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    first
        .request(
            "i.instagram.com",
            Method::GET,
            "/probe",
            None,
            &Fields::new(),
        )
        .await
        .unwrap();
    second
        .request(
            "i.instagram.com",
            Method::GET,
            "/probe",
            None,
            &Fields::new(),
        )
        .await
        .unwrap();
    let captured = captured.lock().await;
    assert!(captured[0].0.starts_with("UFS-") && captured[0].0.ends_with("-1"));
    assert_eq!(captured[0].0, captured[1].0);
    assert_ne!(captured[0].0, captured[2].0);
    assert_ne!(captured[0].1, captured[1].1);
}

#[tokio::test]
async fn login_sleep_does_not_become_an_instagram_cooldown() {
    let ready = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let gate = ready.clone();
    let spent = Arc::new(AtomicUsize::new(0));
    let requests = spent.clone();
    let upstream = Arc::new(AtomicUsize::new(0));
    let hits = upstream.clone();
    let fixture = Fixture::start(move |request| {
        let ready = gate.clone();
        let spent = requests.clone();
        let upstream = hits.clone();
        async move {
            match request.uri().path() {
                "/api/mobile/context" => Json(json!({"connected":true,"state":Service::fixture_session(),"token":"old","profile":{"proxy":"","proxyType":""}})).into_response(),
                "/api/mobile-requests/reserve" => {
                    let body = test_support::body(request).await;
                    assert_eq!(body["login"], true);
                    assert_eq!(body["manualReconnect"], true);
                    let allowed = ready.load(Ordering::SeqCst);
                    if allowed { spent.fetch_add(1, Ordering::SeqCst); }
                    Json(json!({"allowed":allowed,"retryAt":api::now_ms()+3_600_000,"reason":"Mobile session is sleeping"})).into_response()
                },
                "/api/v1/qe/sync/" => { upstream.fetch_add(1, Ordering::SeqCst); (StatusCode::BAD_REQUEST, Json(json!({"status":"fail"}))).into_response() },
                _ => panic!("Unexpected quota test request"),
            }
        }
    }).await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let mut service = Service::fixture(Arc::new(api), fixture.url.clone());
    Arc::get_mut(&mut service).unwrap().request_budget_enabled = true;
    let command = Command {
        profile_id: "profile".into(),
        token: None,
        args: json!({"username":"source","password":"fixture"}),
    };
    for _ in 0..2 {
        let error = service.reconnect(&command).await.unwrap_err();
        assert_eq!(error.name, "MobileRequestBudget");
        assert_eq!(error.status, 429);
        assert_eq!(error.message, "Mobile session is sleeping");
    }
    assert_eq!(spent.load(Ordering::SeqCst), 0);
    assert_eq!(upstream.load(Ordering::SeqCst), 0);
    ready.store(true, Ordering::SeqCst);
    assert_eq!(service.reconnect(&command).await.unwrap_err().status, 400);
    assert_eq!(spent.load(Ordering::SeqCst), 1);
    assert_eq!(upstream.load(Ordering::SeqCst), 1);
}

#[test]
fn mobile_headers_keep_profile_identity_cookie_scope_and_reject_invalid_values() {
    let mut first = mobile(None);
    let mut second = mobile(None);
    first.state.cookies = Default::default();
    second.state.cookies = Default::default();
    let origin = "https://i.instagram.com/".parse().unwrap();
    first.state.authorization = "Bearer first".into();
    second.state.authorization = "Bearer second".into();
    second.state.uuid = "second-device".into();
    first
        .state
        .set_cookie("mid=first-mid; Domain=.instagram.com; Path=/", &origin);
    first.state.set_cookie(
        "restricted=hidden; Domain=.instagram.com; Path=/private",
        &origin,
    );
    let mut first_headers = first.headers(&origin).unwrap();
    let second_headers = second.headers(&origin).unwrap();
    assert_eq!(first_headers["authorization"], "Bearer first");
    assert_eq!(second_headers["authorization"], "Bearer second");
    assert_eq!(second_headers["x-ig-device-id"], "second-device");
    assert_eq!(first_headers["cookie"], "mid=first-mid");
    assert_eq!(first_headers["x-mid"], "first-mid");
    assert_eq!(second_headers["x-ig-www-claim"], "0");
    assert!(!second_headers.contains_key("x-mid"));
    assert!(!second_headers.contains_key("cookie"));
    first_headers.remove("x-ig-app-id");
    assert_eq!(
        first.headers(&origin).unwrap()["x-ig-app-id"],
        transport::APP_ID
    );
    first.state.authorization = "Bearer invalid\nheader".into();
    assert_eq!(
        first.headers(&origin).unwrap_err().message,
        "Invalid Instagram session header"
    );
}

#[test]
fn unchanged_sessions_serialize_identically_after_reload() {
    let mut client = mobile(None);
    let url = "https://i.instagram.com/".parse().unwrap();
    for i in 0..20 {
        client.state.set_cookie(
            &format!("fixture{i}=value{i}; Domain=.instagram.com; Path=/"),
            &url,
        );
    }
    let original = serde_json::to_string(&client.state).unwrap();
    for _ in 0..20 {
        let restored = Session::from_saved(&original).unwrap();
        assert_eq!(serde_json::to_string(&restored).unwrap(), original);
    }
}

#[test]
fn reconnect_requires_a_valid_login_response_even_with_an_existing_session() {
    let mut client = mobile(None);
    client.state.set_cookie(
        "sessionid=existing; Domain=.instagram.com; Path=/",
        &"https://i.instagram.com/".parse().unwrap(),
    );
    let original = serde_json::to_string(&client.state).unwrap();
    for response in [
        "not json",
        "{}",
        "{\"status\":\"fail\",\"message\":\"bad_password\"}",
    ] {
        assert!(!caa::apply_login(
            &mut client,
            &json!({"login_response":response,"headers":"{}"})
        ));
        assert_eq!(serde_json::to_string(&client.state).unwrap(), original);
    }
    assert!(!caa::apply_login(
        &mut client,
        &json!({"login_response":"{\"logged_in_user\":{\"pk\":123}}","headers":"invalid json"})
    ));
    assert_eq!(serde_json::to_string(&client.state).unwrap(), original);
}

#[tokio::test]
async fn reconnect_key_fetch_requires_keys_from_the_current_response() {
    let mode = Arc::new(AtomicUsize::new(0));
    let observed = mode.clone();
    let fixture = Fixture::start(move |_| {
        let mode = observed.load(Ordering::SeqCst);
        async move {
            if mode == 1 {
                return (
                    StatusCode::METHOD_NOT_ALLOWED,
                    [
                        ("ig-set-password-encryption-pub-key", "new-key"),
                        ("ig-set-password-encryption-key-id", "7"),
                    ],
                    "",
                )
                    .into_response();
            }
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    })
    .await;
    let mut client = mobile(Some(fixture.url.clone()));
    client.state.password_key = "saved-key".into();
    let error = client
        .request(
            "i.instagram.com",
            Method::GET,
            "/api/v1/qe/sync/",
            None,
            &Fields::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.status, 503);
    assert_eq!(client.state.password_key, "saved-key");
    mode.store(1, Ordering::SeqCst);
    client
        .request(
            "i.instagram.com",
            Method::GET,
            "/api/v1/qe/sync/",
            None,
            &Fields::new(),
        )
        .await
        .unwrap();
    assert_eq!(client.state.password_key, "new-key");
    assert_eq!(client.state.password_key_id, 7);
}

#[tokio::test]
async fn non_json_errors_preserve_status_and_login_rate_limits_stop_repeated_requests() {
    let requests = Arc::new(AtomicUsize::new(0));
    let observed = requests.clone();
    let upstream = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            observed.fetch_add(1, Ordering::SeqCst);
            let status = if request.uri().path().ends_with("unavailable") {
                StatusCode::SERVICE_UNAVAILABLE
            } else {
                StatusCode::TOO_MANY_REQUESTS
            };
            (
                status,
                [("retry-after", "60")],
                "<html>private upstream body</html>",
            )
                .into_response()
        }
    })
    .await;
    let mut client = mobile(Some(upstream.url.clone()));
    let error = client
        .request(
            "i.instagram.com",
            Method::GET,
            "/unavailable?secret=private",
            None,
            &Fields::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.status, 503);
    assert!(!error.message.contains("Invalid JSON"));
    assert!(!error.message.contains("private"));

    let saves = Arc::new(AtomicUsize::new(0));
    let observed = saves.clone();
    let convex = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            assert_eq!(request.uri().path(), "/api/mobile/context");
            if request.method() == Method::POST {
                observed.fetch_add(1, Ordering::SeqCst);
            }
            Json(json!({"connected":false,"profile":{"proxy":"","proxyType":""}})).into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = convex.url.clone();
    api.key = "fixture".into();
    let mut service = Service::new(Arc::new(api));
    Arc::get_mut(&mut service).unwrap().base = Some(upstream.url.clone());
    let command = Command {
        profile_id: "profile".into(),
        token: None,
        args: json!({"username":"source","password":"fixture","authenticatorKey":""}),
    };
    let error = service.invoke("login", &command).await.unwrap_err();
    assert_eq!(error.status, 429);
    assert_eq!(error.name, "IgRateLimitError");
    assert_eq!(error.retry_after_ms, 60_000);
    assert!(error.message.contains("limiting requests"));
    let request_count = requests.load(Ordering::SeqCst);
    let second = service.invoke("login", &command).await.unwrap_err();
    assert_eq!(second.status, 429);
    assert!(second.retry_after_ms > 0 && second.retry_after_ms <= 60_000);
    assert_eq!(requests.load(Ordering::SeqCst), request_count);
    assert_eq!(saves.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cache_eviction_preserves_live_cooldowns_and_reclaims_expired_ones() {
    let service = Service::new(Arc::new(Api::from_env().unwrap()));
    let cooling = service.entry("cooling").await.unwrap();
    cooling.lock().await.login_retry_at_ms = api::now_ms() + 60_000;
    let original = Arc::downgrade(&cooling);
    drop(cooling);
    let mut active = Vec::new();
    for id in 0..31 {
        active.push(service.entry(&format!("active-{id}")).await.unwrap());
    }
    assert!(service.entry("extra").await.is_err());

    // An unrelated idle entry is evicted while the cooldown's lock stays intact.
    drop(active.pop());
    active.push(service.entry("extra").await.unwrap());
    let request = Command {
        profile_id: "cooling".into(),
        token: None,
        args: json!({}),
    };
    let error = service.invoke("login", &request).await.unwrap_err();
    assert_eq!(error.status, 429);
    assert!(error.retry_after_ms > 0 && error.retry_after_ms <= 60_000);
    let cooling = service.entry("cooling").await.unwrap();
    assert!(Arc::ptr_eq(&cooling, &original.upgrade().unwrap()));
    assert_eq!(service.locks.lock().await.len(), 32);

    // Once expired, that entry is the only idle candidate and can be reclaimed.
    cooling.lock().await.login_retry_at_ms = api::now_ms().saturating_sub(1);
    drop(cooling);
    let _extra = service.entry("after-expiry").await.unwrap();
    assert!(original.upgrade().is_none());
    assert_eq!(service.locks.lock().await.len(), 32);
}

#[tokio::test]
async fn combined_context_uses_one_read_and_observes_proxy_token_and_profile_changes() {
    let mode = Arc::new(AtomicUsize::new(0));
    let reads = Arc::new(AtomicUsize::new(0));
    let observed = reads.clone();
    let changes = mode.clone();
    let state = serde_json::to_string(&mobile(None).state).unwrap();
    let convex = Fixture::start(move |request| {
        let reads = observed.clone();
        let mode = changes.load(Ordering::SeqCst);
        let state = state.clone();
        async move {
            assert_eq!(request.method(), Method::GET);
            assert_eq!(request.uri().path(), "/api/mobile/context");
            assert_eq!(request.uri().query(), Some("profileId=profile"));
            assert_eq!(request.headers()["authorization"], "Bearer fixture");
            reads.fetch_add(1, Ordering::SeqCst);
            Json(json!({
                "connected": true, "state": state,
                "token": if mode == 2 { "changed-token" } else { "saved-token" },
                "profile": if mode == 3 { Value::Null } else {
                    json!({"proxy":if mode == 1 {"unsupported://proxy"} else {""},"proxyType":""})
                }
            }))
            .into_response()
        }
    })
    .await;
    let hits = Arc::new(AtomicUsize::new(0));
    let observed = hits.clone();
    let upstream = Fixture::start(move |_| {
        observed.fetch_add(1, Ordering::SeqCst);
        async { Json(json!({"inbox":{"threads":[]}})).into_response() }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = convex.url.clone();
    api.key = "fixture".into();
    let mut service = Service::new(Arc::new(api));
    Arc::get_mut(&mut service).unwrap().base = Some(upstream.url.clone());
    let request = Command {
        profile_id: "profile".into(),
        token: Some("saved-token".into()),
        args: json!({"mediaId":"4_123"}),
    };
    service.invoke("likers", &request).await.unwrap();
    assert_eq!(reads.load(Ordering::SeqCst), 1);
    for (next_mode, message) in [
        (1, "Invalid proxy protocol or URL"),
        (2, "Mobile session was logged out"),
        (3, "Profile not found"),
    ] {
        mode.store(next_mode, Ordering::SeqCst);
        assert_eq!(
            service
                .invoke("likers", &request)
                .await
                .unwrap_err()
                .message,
            message
        );
        assert_eq!(reads.load(Ordering::SeqCst), next_mode + 1);
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn socks_proxy_authenticates_and_resolves_instagram_at_proxy() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let proxy = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        assert_eq!(socket.read_u8().await.unwrap(), 5);
        let count = socket.read_u8().await.unwrap();
        let mut methods = vec![0; count as usize];
        socket.read_exact(&mut methods).await.unwrap();
        assert!(methods.contains(&2));
        socket.write_all(&[5, 2]).await.unwrap();
        assert_eq!(socket.read_u8().await.unwrap(), 1);
        let count = socket.read_u8().await.unwrap();
        let mut username = vec![0; count as usize];
        socket.read_exact(&mut username).await.unwrap();
        assert_eq!(username, b"proxy-user");
        let count = socket.read_u8().await.unwrap();
        let mut password = vec![0; count as usize];
        socket.read_exact(&mut password).await.unwrap();
        assert_eq!(password, b"p@ss:word");
        socket.write_all(&[1, 0]).await.unwrap();
        let mut header = [0; 4];
        socket.read_exact(&mut header).await.unwrap();
        assert_eq!(header, [5, 1, 0, 3]);
        let count = socket.read_u8().await.unwrap();
        let mut hostname = vec![0; count as usize];
        socket.read_exact(&mut hostname).await.unwrap();
        assert_eq!(hostname, b"i.instagram.com");
        assert_eq!(socket.read_u16().await.unwrap(), 80);
        socket
            .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 80])
            .await
            .unwrap();
        let mut request = vec![];
        while !request.ends_with(b"\r\n\r\n") {
            request.push(socket.read_u8().await.unwrap());
            assert!(request.len() < 8192);
        }
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
            .await
            .unwrap();
    });
    let proxy_url =
        normalize_proxy(&format!("127.0.0.1:{port}:proxy-user:p@ss:word"), "socks5").unwrap();
    let response = transport::client(&proxy_url)
        .unwrap()
        .get("http://i.instagram.com/fixture")
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    proxy.await.unwrap();
}

#[tokio::test]
async fn complete_caa_login_follows_attestation_and_totp_flow() {
    use rsa::pkcs8::{EncodePublicKey, LineEnding};
    let key = rsa::RsaPrivateKey::new(&mut rand::rngs::OsRng, 2048).unwrap();
    let public = STANDARD.encode(
        key.to_public_key()
            .to_public_key_pem(LineEnding::LF)
            .unwrap(),
    );
    let calls = Arc::new(Mutex::new(vec![]));
    let observed = calls.clone();
    let fixture=Fixture::start(move|request|{let public=public.clone();let observed=observed.clone();async move{
        let path=request.uri().path().to_string();
        assert!(!request.headers().contains_key("authorization"), "Credential login must not reuse expired authorization");
        assert_eq!(request.headers()["x-ig-www-claim"], "0");
        if path.ends_with("qe/sync/"){
            assert!(!request.headers().contains_key("cookie"));
            return (StatusCode::METHOD_NOT_ALLOWED,[("ig-set-password-encryption-pub-key",public.as_str()),("ig-set-password-encryption-key-id","7"),("set-cookie","mid=fresh-mid; Domain=.instagram.com; Path=/; Secure")],Json(json!({}))).into_response();
        }
        assert_eq!(request.headers()["cookie"], "mid=fresh-mid");
        assert_eq!(request.headers().get_all("content-type").iter().count(), 1);
        assert_eq!(request.headers()["content-type"], "application/x-www-form-urlencoded; charset=UTF-8");
        let attest=request.headers().get("x-ig-attest-params").map(|v|v.to_str().unwrap().to_string());
        let bytes=axum::body::to_bytes(request.into_body(),1_000_000).await.unwrap();let query=reqwest::Url::parse(&format!("http://local/?{}",String::from_utf8(bytes.to_vec()).unwrap())).unwrap();let fields:HashMap<_,_>=query.query_pairs().into_owned().collect();
        let params:Value=serde_json::from_str(fields.get("params").map(String::as_str).unwrap_or("{}")).unwrap();observed.lock().await.push(path.clone());
        if path=="/graphql_www" {assert!(fields["variables"].contains("usdid_token"));return Json(json!({"data":{"usdid_registration":{"success":true}}})).into_response();}
        if path.contains("process_client_data_and_redirect"){return Json(json!({"layout":{"bloks_payload":{"data":[{"data":{"key":"CAA_ACCOUNT_ACCESS_CONTEXT:aac","initial":"fixture-aac"}}]}}})).into_response();}
        if path.contains("create_android_keystore"){return Json(json!({"challenge_nonce":"fixture-nonce"})).into_response();}
        if path.contains("send_login_request"){
            assert_eq!(params["client_input_params"]["aac"],"fixture-aac");assert_eq!(params["client_input_params"]["contact_point"],"source");
            assert!(params["client_input_params"]["password"].as_str().unwrap().starts_with("#PWD_INSTAGRAM:4:"));assert!(attest.unwrap().contains("fixture-nonce"));assert!(!params.to_string().contains("plain-password"));
            return Json(json!({"two_step_verification_context":"fixture-context"})).into_response();
        }
        if path.contains("two_step_verification") {assert_eq!(params["server_params"]["two_step_verification_context"],"fixture-context");}
        if path.contains("verify_code.async"){
            assert_eq!(params["client_input_params"]["code"].as_str().unwrap().len(),6);
            let embedded=json!({"login_response":json!({"logged_in_user":{"pk_id":"9007199254740993"}}).to_string(),"headers":json!({"IG-Set-Authorization":"Bearer native-session"}).to_string(),"cookies":"sessionid=opaque%3Acookie; Domain=.instagram.com; Path=/; Secure"});
            return Json(json!({"embedded":embedded})).into_response();
        }
        Json(json!({"status":"ok"})).into_response()
    }}).await;
    let mut mobile = mobile(Some(fixture.url.clone()));
    let device = (
        mobile.state.uuid.clone(),
        mobile.state.phone_id.clone(),
        mobile.state.device_id.clone(),
    );
    let (identity, _) = crypto::Usdid::create(&mobile.state.phone_id).unwrap();
    let identity_before = serde_json::to_value(&identity).unwrap();
    mobile.state.usdid = Some(identity);
    mobile.state.claim = "expired-claim".into();
    mobile.state.set_cookie(
        "sessionid=expired; Domain=.instagram.com; Path=/",
        &"https://i.instagram.com/".parse().unwrap(),
    );
    caa::login(
        &mut mobile,
        "source",
        "plain-password",
        "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    )
    .await
    .unwrap();
    assert_eq!(mobile.state.viewer_id().unwrap(), "9007199254740993");
    assert_eq!(mobile.state.authorization, "Bearer native-session");
    assert_eq!(mobile.state.cookie("sessionid"), "opaque%3Acookie");
    assert_eq!(
        (
            mobile.state.uuid.clone(),
            mobile.state.phone_id.clone(),
            mobile.state.device_id.clone()
        ),
        device
    );
    assert_eq!(
        serde_json::to_value(&mobile.state.usdid).unwrap(),
        identity_before
    );
    assert_eq!(calls.lock().await.len(), 9);
}
fn mobile(base: Option<String>) -> Mobile {
    let mut state = new_session("profile-123", "example");
    state.set_cookie(
        "ds_user_id=123; Domain=.instagram.com; Path=/",
        &"https://i.instagram.com/".parse().unwrap(),
    );
    state.authorization = "Bearer test".into();
    Mobile {
        state,
        client: transport::client("").unwrap(),
        budget: None,
        base,
    }
}

#[test]
fn caa_contexts_preserve_nested_values_and_reject_wrong_types() {
    let rows=[
        ("\"com.bloks.www.two_step_verification.entrypoint\" (dkc \"server_params\") (dkc (f4i (dkc \"two_step_verification_context\" \"flow_source\") (dkc \"context-1\" \"two_factor_login\")))","context-1"),
        ("\"com.bloks.www.two_step_verification.entrypoint\" (dkc \"server_params\") (dkc (f4i (dkc \"attempt_count\" \"flow_source\" \"two_step_verification_context\") (dkc 1 (f4i \"login\" \"manual\") \"context-2\")))","context-2"),
        ("\"com.bloks.www.two_step_verification.entrypoint\" (dkc \"server_params\") (dkc (f4i (dkc \"two_step_verification_context\" \"flow_source\") (dkc 42 \"manual\")))",""),
    ];
    for (action, expected) in rows {
        assert_eq!(
            caa::extract_context(&json!({"layout":{"bloks_payload":{"action":action}}})),
            expected
        );
    }
    assert_eq!(
        caa::extract_context(&json!({"nested":[{"two_step_verification_context":"direct"}]})),
        "direct"
    );
    assert_eq!(
        caa::extract_aac(
            &json!({"layout":{"bloks_payload":{"data":[{"data":{"key":"CAA_ACCOUNT_ACCESS_CONTEXT:aac","initial_lispy":"(fhy \"\")"}},{"data":{"key":"CAA_ACCOUNT_ACCESS_CONTEXT:aac","initial_lispy":"(fhy \"server-aac\")"}}]}}})
        ),
        "server-aac"
    );
}
#[test]
fn embedded_login_and_session_only_cookies_survive_restart() {
    let mut mobile = mobile(None);
    let embedded = json!({"login_response":json!({"logged_in_user":{"pk":123}}).to_string(),"headers":json!({"IG-Set-Authorization":"Bearer IGT:2:encoded"}).to_string(),"cookies":"Set-Cookie: csrftoken=token-1; Domain=.instagram.com; Path=/; Secure\r\nSet-Cookie: sessionid=123%3Aabc; Domain=.instagram.com; Path=/; Secure, other=value; Domain=.instagram.com; Path=/; Expires=Tue, 03 Aug 2100 00:38:37 GMT"});
    let result = json!({"layout":{"bloks_payload":{"action":format!("BK.action(\"ignored\", {})",json!(embedded.to_string()))}}});
    assert!(caa::apply_login(&mut mobile, &result));
    assert_eq!(mobile.state.authorization, "Bearer IGT:2:encoded");
    assert_eq!(mobile.state.cookie("sessionid"), "123%3Aabc");
    assert_eq!(mobile.state.cookie("other"), "value");
    let restored: Session =
        serde_json::from_str(&serde_json::to_string(&mobile.state).unwrap()).unwrap();
    assert_eq!(restored.cookie("sessionid"), "123%3Aabc");
    assert_eq!(restored.viewer_id().unwrap(), "123");
    assert_eq!(restored.device, mobile.state.device);
    assert_eq!(restored.uuid, mobile.state.uuid);
    assert_eq!(
        new_session("profile-123", "example").device,
        mobile.state.device
    );
    assert_eq!(
        include_str!("devices.txt")
            .lines()
            .collect::<std::collections::HashSet<_>>()
            .len(),
        13
    );
}
#[test]
fn totp_matches_rfc6238_and_rejects_invalid_padding() {
    assert_eq!(
        crypto::authenticator_code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000).unwrap(),
        "287082"
    );
    assert!(crypto::authenticator_code("INVALID!", 0).is_err());
    assert!(crypto::authenticator_code("B", 0).is_err());
}
#[test]
fn password_packet_decrypts_with_original_rsa_aes_protocol() {
    use aes_gcm::{
        aead::{AeadInPlace, KeyInit},
        Aes256Gcm, Nonce, Tag,
    };
    use rsa::{
        pkcs8::{EncodePublicKey, LineEnding},
        Pkcs1v15Encrypt,
    };
    let key = rsa::RsaPrivateKey::new(&mut rand::rngs::OsRng, 2048).unwrap();
    let pem = key
        .to_public_key()
        .to_public_key_pem(LineEnding::LF)
        .unwrap();
    let password = "unicode:пароль";
    let (time, encrypted) = crypto::encrypt_password(password, 7, &STANDARD.encode(pem)).unwrap();
    let bytes = STANDARD.decode(encrypted).unwrap();
    assert_eq!(&bytes[..2], &[1, 7]);
    let size = u16::from_le_bytes(bytes[14..16].try_into().unwrap()) as usize;
    let aes = key.decrypt(Pkcs1v15Encrypt, &bytes[16..16 + size]).unwrap();
    let mut text = bytes[32 + size..].to_vec();
    Aes256Gcm::new_from_slice(&aes)
        .unwrap()
        .decrypt_in_place_detached(
            Nonce::from_slice(&bytes[2..14]),
            time.as_bytes(),
            &mut text,
            Tag::from_slice(&bytes[16 + size..32 + size]),
        )
        .unwrap();
    assert_eq!(text, password.as_bytes());
}
#[test]
fn device_registration_signatures_use_der_and_exported_public_key() {
    use p256::{
        ecdsa::{signature::Verifier, Signature, VerifyingKey},
        pkcs8::DecodePublicKey,
    };
    let (identity, variables) = crypto::Usdid::create("phone").unwrap();
    let variables: Value = serde_json::from_str(&variables).unwrap();
    let token: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(
                variables["input"]["usdid_token"]["sensitive_string_value"]
                    .as_str()
                    .unwrap(),
            )
            .unwrap(),
    )
    .unwrap();
    let payload = token["payload"].as_str().unwrap();
    let decoded: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
    let key = VerifyingKey::from_public_key_der(
        &STANDARD.decode(decoded["pub"].as_str().unwrap()).unwrap(),
    )
    .unwrap();
    let signed = &token["signatures"][0];
    let protected = signed["protected"].as_str().unwrap();
    let signature = Signature::from_der(
        &URL_SAFE_NO_PAD
            .decode(signed["signature"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    key.verify(format!("{protected}.{payload}").as_bytes(), &signature)
        .unwrap();
    assert_eq!(decoded["sub"], identity.id);
    let header = identity.header().unwrap();
    let (text, signature) = header.rsplit_once('.').unwrap();
    key.verify(
        text.as_bytes(),
        &Signature::from_der(&URL_SAFE_NO_PAD.decode(signature).unwrap()).unwrap(),
    )
    .unwrap();
}
#[test]
fn proxy_normalization_handles_legacy_credentials_ipv6_and_rejections() {
    for (raw, protocol, expected) in [
        (
            "host:8080:user:pass:word",
            "http",
            "http://user:pass%3Aword@host:8080",
        ),
        (
            "socks5://user:p%40ss@host",
            "http",
            "socks5://user:p%40ss@host:1080",
        ),
        (
            "[::1]:8080:user:pass",
            "https",
            "https://user:pass@[::1]:8080",
        ),
        ("none", "http", ""),
    ] {
        assert_eq!(normalize_proxy(raw, protocol).unwrap(), expected);
    }
    for raw in [
        "ftp://secret:password@host",
        "http://host/path",
        "http://host:0",
        "http://host?token=secret",
    ] {
        let error = normalize_proxy(raw, "http").unwrap_err();
        assert_eq!(error.message, "Invalid proxy protocol or URL");
        assert!(!format!("{error:?}").contains("secret"));
    }
}
#[tokio::test]
async fn mobile_transport_persists_response_headers_and_sanitizes_errors() {
    let fixture = Fixture::start(|request| async move {
        if request.uri().path().ends_with("qe/sync/") {
            return (
                StatusCode::METHOD_NOT_ALLOWED,
                [
                    ("ig-set-password-encryption-key-id", "7"),
                    ("ig-set-password-encryption-pub-key", "fixture"),
                    ("ig-set-x-mid", "header-mid"),
                ],
                Json(json!({})),
            )
                .into_response();
        }
        if request.uri().path().ends_with("bad/") {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                [("retry-after", "3600")],
                Json(json!({"status":"fail","error_type":"secret-cookie-value:123"})),
            )
                .into_response();
        }
        assert_eq!(request.headers()["x-ig-app-id"], transport::APP_ID);
        assert_eq!(request.headers()["x-mid"], "header-mid");
        assert!(request.headers()["cookie"]
            .to_str()
            .unwrap()
            .contains("ds_user_id=123"));
        (
            [
                ("set-cookie", "mid=new-mid; Domain=.instagram.com; Path=/"),
                ("ig-set-authorization", "Bearer changed"),
            ],
            Json(json!({"status":"ok","pk":9007199254740993u64})),
        )
            .into_response()
    })
    .await;
    let mut mobile = mobile(Some(fixture.url.clone()));
    mobile
        .request(
            "i.instagram.com",
            Method::GET,
            "/api/v1/qe/sync/",
            None,
            &Fields::new(),
        )
        .await
        .unwrap();
    assert_eq!(mobile.state.password_key_id, 7);
    assert_eq!(mobile.state.mid(), "header-mid");
    let restored = Session::from_saved(&serde_json::to_string(&mobile.state).unwrap()).unwrap();
    assert_eq!(restored.mid(), "header-mid");
    let result = mobile
        .mobile(Method::GET, "read/", None, &Fields::new())
        .await
        .unwrap();
    assert_eq!(string(&result["pk"]), "9007199254740993");
    assert_eq!(mobile.state.cookie("mid"), "new-mid");
    assert_eq!(mobile.state.authorization, "Bearer changed");
    let error = mobile
        .mobile(Method::GET, "bad/", None, &Fields::new())
        .await
        .unwrap_err();
    assert_eq!(error.status, 429);
    assert_eq!(error.retry_after_ms, 3_600_000);
    assert!(!format!("{error:?}").contains("secret"));
}

#[tokio::test]
async fn mobile_likers_follow_instagrapi_media_id_normalization() {
    let calls = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let observed = calls.clone();
    let fixture = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            let path = request.uri().path().to_string();
            assert!(request.uri().query().is_none());
            assert!(request.headers()["user-agent"]
                .to_str()
                .unwrap()
                .starts_with("Instagram"));
            observed.lock().await.push(path.clone());
            if path == "/api/v1/media/9007199254740993/info/" {
                return Json(json!({"items":[{"user":{"pk":"123"}}]})).into_response();
            }
            assert_eq!(path, "/api/v1/media/9007199254740993_123/likers/");
            Json(json!({"status":"ok","users":[]})).into_response()
        }
    })
    .await;
    let mut mobile = mobile(Some(fixture.url.clone()));
    let service = Service::new(Arc::new(Api::from_env().unwrap()));
    for media_id in ["9007199254740993", "9007199254740993_123"] {
        assert_eq!(
            operations::invoke(
                &service,
                &mut mobile,
                "likers",
                &json!({"mediaId":media_id})
            )
            .await
            .unwrap()["users"],
            json!([])
        );
    }
    assert_eq!(
        *calls.lock().await,
        vec![
            "/api/v1/media/9007199254740993/info/",
            "/api/v1/media/9007199254740993_123/likers/",
            "/api/v1/media/9007199254740993_123/likers/",
        ]
    );
    for media_id in ["", "1_", "1_2_3", "../1", "1/not-an-id"] {
        assert!(operations::invoke(
            &service,
            &mut mobile,
            "likers",
            &json!({"mediaId":media_id})
        )
        .await
        .is_err());
    }
    assert_eq!(calls.lock().await.len(), 3);
}

#[tokio::test]
async fn request_budget_covers_every_call_and_survives_entry_eviction() {
    let counts = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::<
        String,
        usize,
    >::new()));
    let instagram_calls = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let observed = counts.clone();
    let calls = instagram_calls.clone();
    let fixture = Fixture::start(move |request| {
        let counts = observed.clone();
        let calls = calls.clone();
        async move {
            let path = request.uri().path().to_string();
            if path == "/api/mobile/context" {
                return Json(json!({"connected":true,"state":Service::fixture_session(),"token":"fixture","profile":{"proxy":"","proxyType":""}})).into_response();
            }
            if path == "/api/mobile-requests/reserve" {
                let bytes = axum::body::to_bytes(request.into_body(), 4096).await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                let mut counts = counts.lock().await;
                let count = counts.entry(body["profileId"].as_str().unwrap().into()).or_default();
                if *count >= 10 {
                    return Json(json!({"allowed":false,"retryAt":api::now_ms()+3_600_000,"reason":"Hourly mobile request limit reached"})).into_response();
                }
                *count += 1;
                return Json(json!({"allowed":true})).into_response();
            }
            calls.lock().await.push(path.clone());
            if path.ends_with("/info/") {
                return Json(json!({"items":[{"user":{"pk":"123"},"like_count":150}]})).into_response();
            }
            if path == "/api/v1/media/3_123/likers/" {
                return (StatusCode::BAD_GATEWAY, Json(json!({"status":"fail"}))).into_response();
            }
            Json(json!({"status":"ok","users":[]})).into_response()
        }
    }).await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let mut service = Service::fixture(Arc::new(api), fixture.url.clone());
    Arc::get_mut(&mut service).unwrap().request_budget_enabled = true;
    let request = |profile: &str, media: &str| Command {
        profile_id: profile.into(),
        token: None,
        args: json!({"mediaId":media}),
    };
    service
        .invoke("likers", &request("first", "1"))
        .await
        .unwrap(); // Metadata + likers are two requests.
    assert_eq!(
        service
            .invoke("likers", &request("first", "3_123"))
            .await
            .unwrap_err()
            .status,
        502
    );
    for _ in 0..7 {
        service
            .invoke("likers", &request("first", "4_123"))
            .await
            .unwrap();
    }
    assert_eq!(instagram_calls.lock().await.len(), 10);
    service.locks.lock().await.clear(); // A new in-memory session cannot reset persisted usage.
    assert_eq!(
        service
            .invoke("likers", &request("first", "4_123"))
            .await
            .unwrap_err()
            .name,
        "MobileRequestBudget"
    );
    assert_eq!(instagram_calls.lock().await.len(), 10);
    service
        .invoke("likers", &request("second", "4_123"))
        .await
        .unwrap();
    assert_eq!(instagram_calls.lock().await.len(), 11);
    assert_eq!(counts.lock().await["first"], 10);
    assert_eq!(counts.lock().await["second"], 1);
}

#[tokio::test]
async fn native_post_pagination_preserves_limits_and_pinned_posts() {
    let fixture=Fixture::start(|request|async move{
        let query=reqwest::Url::parse(&format!("http://local{}",request.uri())).unwrap();let query:HashMap<_,_>=query.query_pairs().into_owned().collect();let path=request.uri().path();
        if path.ends_with("inbox/"){let start=if query.contains_key("cursor"){20}else{0};return Json(json!({"inbox":{"threads":(start..start+20).map(|id|json!({"thread_id":id.to_string(),"items":[{"timestamp":"1"},{"timestamp":"2"}]})).collect::<Vec<_>>(),"oldest_cursor":if start==0{"next"}else{""},"has_older":start==0}})).into_response();}
        if path.ends_with("users/search/"){return Json(json!({"users":[{"pk":"123","username":"source"}]})).into_response();}
        let first=!query.contains_key("max_id");let items=if first{json!([{"pk":"1","code":"old_pinned","taken_at":10,"timeline_pinned_user_ids":["123"]},{"pk":"2","code":"two","taken_at":300}])}else{json!([{"pk":"2","code":"two","taken_at":300},{"pk":"3","code":"three","taken_at":200},{"pk":"4","code":"old","taken_at":10}])};Json(json!({"items":items,"next_max_id":"next","more_available":true})).into_response()
    }).await;
    let mut mobile = mobile(Some(fixture.url.clone()));
    let service = Service::new(Arc::new(Api::from_env().unwrap()));
    let posts = operations::invoke(
        &service,
        &mut mobile,
        "posts",
        &json!({"username":"source","sinceDate":100_000,"postLimit":10}),
    )
    .await
    .unwrap();
    assert_eq!(
        posts,
        json!([{"id":"2","code":"two","takenAt":300000,"likeCount":null},{"id":"3","code":"three","takenAt":200000,"likeCount":null}])
    );
    let posts = operations::invoke(
        &service,
        &mut mobile,
        "posts",
        &json!({"username":"source","sinceDate":100_000,"postLimit":1}),
    )
    .await
    .unwrap();
    assert_eq!(
        posts,
        json!([{"id":"2","code":"two","takenAt":300000,"likeCount":null}])
    );
}

#[tokio::test]
async fn latest_post_limit_uses_dates_instead_of_pinned_feed_order() {
    let pages = Arc::new(AtomicUsize::new(0));
    let reads = pages.clone();
    let fixture = Fixture::start(move |request| {
        let reads = reads.clone();
        async move {
            if request.uri().path().ends_with("users/search/") {
                return Json(json!({"users":[{"pk":"123","username":"source"}]})).into_response();
            }
            let page = reads.fetch_add(1, Ordering::SeqCst);
            Json(if page == 0 {
                json!({"items":[
                    {"pk":"1","code":"pinned","taken_at":100,"like_count":200,"timeline_pinned_user_ids":["123"]},
                    {"pk":"2","code":"newest","taken_at":300,"like_count":200}
                ],"more_available":true,"next_max_id":"next"})
            } else {
                json!({"items":[{"pk":"3","code":"second","taken_at":200,"like_count":200}],"more_available":false})
            }).into_response()
        }
    }).await;
    let mut mobile = mobile(Some(fixture.url.clone()));
    let service = Service::new(Arc::new(Api::from_env().unwrap()));
    let posts = operations::invoke(
        &service,
        &mut mobile,
        "posts",
        &json!({"username":"source","sinceDate":0,"postLimit":2}),
    )
    .await
    .unwrap();
    assert_eq!(posts.as_array().unwrap().len(), 2);
    assert_eq!(posts[0]["code"], "newest");
    assert_eq!(posts[1]["code"], "second");
    assert_eq!(pages.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn native_session_serialization_prevents_stale_saves_after_logout() {
    let mut original = mobile(None).state;
    original.mid = "fixture-machine".into();
    original.usdid = Some(crypto::Usdid::create(&original.phone_id).unwrap().0);
    original.set_cookie(
        "sessionid=fixture; Domain=.instagram.com; Path=/",
        &"https://i.instagram.com/".parse().unwrap(),
    );
    let session = serde_json::to_string(&original).unwrap();
    let token = uuid::Uuid::new_v4().to_string();
    let store = Arc::new(Mutex::new(Some(
        json!({"connected":true,"state":session,"token":token}),
    )));
    let observed = store.clone();
    let deletes = Arc::new(AtomicUsize::new(0));
    let d = deletes.clone();
    let fixture = Fixture::start(move |request| {
        let store = observed.clone();
        let d = d.clone();
        async move {
            assert!(matches!(
                request.uri().path(),
                "/api/mobile/session" | "/api/mobile/context"
            ));
            match *request.method() {
                Method::GET => Json(
                    store
                        .lock()
                        .await
                        .clone()
                        .unwrap_or(json!({"connected":false})),
                )
                .into_response(),
                Method::POST => {
                    let body = test_support::body(request).await;
                    let mut saved = store.lock().await;
                    assert_eq!(body["expectedToken"], saved.as_ref().unwrap()["token"]);
                    assert_ne!(body["token"], body["expectedToken"]);
                    assert_eq!(body["reconnectRequired"], true);
                    *saved = Some(json!({"connected":true,"state":body["state"],"token":body["token"],"reconnectRequired":true}));
                    d.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"connected":false})).into_response()
                }
                _ => panic!("Unexpected session resurrection"),
            }
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let service = Service::new(Arc::new(api));
    let request = Command {
        profile_id: "profile".into(),
        token: Some(token),
        args: json!({}),
    };
    service.invoke("load", &request).await.unwrap();
    service.invoke("logout", &request).await.unwrap();
    assert!(service.invoke("load", &request).await.is_err());
    assert_eq!(deletes.load(Ordering::SeqCst), 1);
    let saved = store.lock().await;
    let logged_out =
        Session::from_saved(saved.as_ref().unwrap()["state"].as_str().unwrap()).unwrap();
    assert_eq!(logged_out.uuid, original.uuid);
    assert_eq!(logged_out.phone_id, original.phone_id);
    assert_eq!(logged_out.device_id, original.device_id);
    assert_eq!(logged_out.device, original.device);
    assert_eq!(logged_out.mid(), original.mid());
    assert_eq!(
        serde_json::to_value(&logged_out.usdid).unwrap(),
        serde_json::to_value(&original.usdid).unwrap()
    );
    assert!(logged_out.authorization.is_empty());
    assert!(logged_out.claim.is_empty());
    assert_eq!(logged_out.cookie("sessionid"), "");
}

#[tokio::test]
async fn typescript_session_is_reused_without_login_and_reconnect_preserves_its_device() {
    use p256::{
        ecdsa::SigningKey,
        pkcs8::{EncodePrivateKey, LineEnding},
    };
    let key = SigningKey::random(&mut rand::rngs::OsRng);
    let identity_id = uuid::Uuid::new_v4().to_string();
    let original = json!({
        "uuid":"9dd1eefe-a562-588b-ab8e-61978afa3100", "phoneId":"b9e199eb-139d-51e7-975e-6c63264b41a4",
        "deviceId":"android-40dca286d0981087", "deviceString":"33/13; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther",
        "authorization":format!("Bearer IGT:2:{}", STANDARD.encode(json!({"ds_user_id":"9007199254740993"}).to_string())),
        "chatUsdid":{"id":identity_id,"privateKey":key.to_pkcs8_pem(LineEnding::LF).unwrap().to_string()},
        "cookies":json!({"cookies":[
            {"key":"mid","value":"fixture-mid","domain":"instagram.com","path":"/","hostOnly":false},
            {"key":"sessionid","value":"fixture-cookie","domain":"instagram.com","path":"/","hostOnly":false,"secure":true,"httpOnly":true},
            {"key":"expired","value":"discard","domain":"instagram.com","path":"/","hostOnly":false,"expires":"2000-01-01T00:00:00.000Z"}
        ]}).to_string()
    });
    let imported = Session::from_saved(&original.to_string()).unwrap();
    assert_eq!(imported.viewer_id().unwrap(), "9007199254740993");
    assert_eq!(imported.cookie("mid"), "fixture-mid");
    assert_eq!(imported.cookie("sessionid"), "fixture-cookie");
    assert_eq!(imported.cookie("expired"), "");
    let identity = imported.usdid.as_ref().unwrap();
    assert_eq!(identity.id, identity_id);
    let variables: Value =
        serde_json::from_str(&identity.registration(&imported.phone_id).unwrap()).unwrap();
    let token: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(
                variables["input"]["usdid_token"]["sensitive_string_value"]
                    .as_str()
                    .unwrap(),
            )
            .unwrap(),
    )
    .unwrap();
    let payload: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(token["payload"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(payload["sub"], identity_id);
    use p256::pkcs8::EncodePublicKey;
    assert_eq!(
        payload["pub"],
        STANDARD.encode(key.verifying_key().to_public_key_der().unwrap().as_bytes())
    );
    let token = uuid::Uuid::new_v4().to_string();
    let saved = Arc::new(Mutex::new(
        json!({"connected":true,"state":original.to_string(),"token":token}),
    ));
    let observed = saved.clone();
    let saves = Arc::new(AtomicUsize::new(0));
    let writes = saves.clone();
    let convex = Fixture::start(move |request| {
        let saved = observed.clone();
        let writes = writes.clone();
        async move {
            let context = request.uri().path() == "/api/mobile/context";
            assert!(context || request.uri().path() == "/api/mobile/session");
            if request.method() == Method::POST {
                let body = test_support::body(request).await;
                let mut current = saved.lock().await;
                assert_eq!(body["expectedToken"], current["token"]);
                *current = json!({"connected":true,"state":body["state"],"token":body["token"]});
                writes.fetch_add(1, Ordering::SeqCst);
            }
            let mut response = saved.lock().await.clone();
            if context {
                response["profile"] = json!({"proxy":"","proxyType":""});
            }
            Json(response).into_response()
        }
    })
    .await;
    let requests = Arc::new(AtomicUsize::new(0));
    let hits = requests.clone();
    let upstream = Fixture::start(move |request| {
        let hits = hits.clone();
        async move {
            hits.fetch_add(1, Ordering::SeqCst);
            assert_eq!(
                request.headers()["x-ig-device-id"],
                "9dd1eefe-a562-588b-ab8e-61978afa3100"
            );
            assert_eq!(
                request.headers()["x-ig-family-device-id"],
                "b9e199eb-139d-51e7-975e-6c63264b41a4"
            );
            assert_eq!(
                request.headers()["x-ig-android-id"],
                "android-40dca286d0981087"
            );
            assert_eq!(request.headers()["accept-encoding"], "gzip");
            (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "60")], "").into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = convex.url.clone();
    api.key = "fixture".into();
    let mut service = Service::new(Arc::new(api));
    Arc::get_mut(&mut service).unwrap().base = Some(upstream.url.clone());
    let command = Command {
        profile_id: "profile".into(),
        token: None,
        args: json!({"username":"source","password":"fixture","authenticatorKey":""}),
    };
    let restored = service.invoke("load", &command).await.unwrap();
    assert_eq!(restored["token"], token);
    assert_eq!(requests.load(Ordering::SeqCst), 0);
    assert_eq!(saves.load(Ordering::SeqCst), 1);
    let state = saved.lock().await["state"].as_str().unwrap().to_string();
    let converted = Session::from_saved(&state).unwrap();
    assert_eq!(converted.uuid, imported.uuid);
    assert_eq!(converted.phone_id, imported.phone_id);
    assert_eq!(converted.device_id, imported.device_id);
    assert_eq!(converted.device, imported.device);
    assert_eq!(converted.authorization, imported.authorization);
    assert_eq!(converted.cookie("sessionid"), "fixture-cookie");
    service.invoke("load", &command).await.unwrap();
    assert_eq!(saves.load(Ordering::SeqCst), 1);
    assert_eq!(
        service.invoke("login", &command).await.unwrap_err().status,
        429
    );
    assert_eq!(requests.load(Ordering::SeqCst), 1);
    assert_eq!(saves.load(Ordering::SeqCst), 1);
    assert_eq!(saved.lock().await["state"], state);
}

#[tokio::test]
async fn rejected_sessions_require_reconnect_without_discarding_the_saved_device() {
    let original = serde_json::to_string(&mobile(None).state).unwrap();
    let saved = Arc::new(Mutex::new(
        json!({"connected":true,"state":original,"token":"saved-token"}),
    ));
    let store = saved.clone();
    let writes = Arc::new(AtomicUsize::new(0));
    let observed = writes.clone();
    let convex = Fixture::start(move |request| {
        let store = store.clone();
        let writes = observed.clone();
        async move {
            let context = request.uri().path() == "/api/mobile/context";
            assert!(context || request.uri().path() == "/api/mobile/session");
            if request.method() == Method::POST {
                let body = test_support::body(request).await;
                let mut saved = store.lock().await;
                assert_eq!(body["expectedToken"], saved["token"]);
                assert_eq!(body["state"], saved["state"]);
                saved["reconnectRequired"] = body["reconnectRequired"].clone();
                writes.fetch_add(1, Ordering::SeqCst);
            }
            let mut response = store.lock().await.clone();
            if context {
                response["profile"] = json!({"proxy":"","proxyType":""});
            }
            Json(response).into_response()
        }
    })
    .await;
    let mode = Arc::new(AtomicUsize::new(0));
    let observed = mode.clone();
    let upstream = Fixture::start(move |_| {
        let mode = observed.load(Ordering::SeqCst);
        async move {
            // A non-JSON 401 is still an expired login; other failures do not prove that.
            if mode == 0 {
                StatusCode::SERVICE_UNAVAILABLE.into_response()
            } else {
                StatusCode::UNAUTHORIZED.into_response()
            }
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = convex.url.clone();
    api.key = "fixture".into();
    let mut service = Service::new(Arc::new(api));
    Arc::get_mut(&mut service).unwrap().base = Some(upstream.url.clone());
    let request = Command {
        profile_id: "profile".into(),
        token: Some("saved-token".into()),
        args: json!({"mediaId":"4_123"}),
    };
    assert_eq!(
        service.invoke("likers", &request).await.unwrap_err().status,
        503
    );
    assert_eq!(writes.load(Ordering::SeqCst), 0);
    mode.store(1, Ordering::SeqCst);
    assert_eq!(
        service.invoke("likers", &request).await.unwrap_err().status,
        401
    );
    assert_eq!(writes.load(Ordering::SeqCst), 1);
    assert_eq!(saved.lock().await["reconnectRequired"], true);
    assert_eq!(saved.lock().await["state"], original);
}
