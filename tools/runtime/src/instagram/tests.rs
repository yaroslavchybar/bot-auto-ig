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
            assert_eq!(request.uri().path(), "/api/chat/context");
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
    let mut service = Service::new(Arc::new(api), uploads());
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
    let service = Service::new(Arc::new(Api::from_env().unwrap()), uploads());
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
            assert_eq!(request.uri().path(), "/api/chat/context");
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
    let mut service = Service::new(Arc::new(api), uploads());
    Arc::get_mut(&mut service).unwrap().base = Some(upstream.url.clone());
    let request = Command {
        profile_id: "profile".into(),
        token: Some("saved-token".into()),
        args: json!({}),
    };
    service.invoke("inbox", &request).await.unwrap();
    assert_eq!(reads.load(Ordering::SeqCst), 1);
    for (next_mode, message) in [
        (1, "Invalid proxy protocol or URL"),
        (2, "Chat session was logged out"),
        (3, "Profile not found"),
    ] {
        mode.store(next_mode, Ordering::SeqCst);
        assert_eq!(
            service.invoke("inbox", &request).await.unwrap_err().message,
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
async fn profile_edits_avatar_and_signed_video_preserve_native_contracts() {
    let calls = Arc::new(Mutex::new(vec![]));
    let observed = calls.clone();
    let fixture = Fixture::start(move |request| {
        let calls = observed.clone();
        async move {
            let path = request.uri().path().to_string();
            calls.lock().await.push(path.clone());
            if path.ends_with("current_user/") {
                return Json(json!({"user":{"username":"old","full_name":"Name","email":"keep@example.test","biography":"keep bio"}})).into_response();
            }
            if path.contains("messenger_video") {
                if request.method() == Method::GET { return Json(json!({"offset":0})).into_response(); }
                assert_eq!(request.headers()["x-entity-type"], "video/mp4");
                assert_eq!(axum::body::to_bytes(request.into_body(), 100).await.unwrap().as_ref(), b"0000ftyp1234");
                return Json(json!({"media_id":"987654321"})).into_response();
            }
            if path.contains("rupload_igphoto") {
                assert!(request.headers().contains_key("x_fb_photo_waterfall_id"));
                let params: Value = serde_json::from_str(request.headers()["x-instagram-rupload-params"].to_str().unwrap()).unwrap();
                assert_eq!(params["media_type"], "1");
                assert_eq!(axum::body::to_bytes(request.into_body(), 100).await.unwrap().as_ref(), &[255,216,255,217]);
                return ([("set-cookie", "csrftoken=changed; Domain=.instagram.com; Path=/"), ("ig-set-authorization", "Bearer rotated")], Json(json!({"status":"ok"}))).into_response();
            }
            if path.ends_with("change_profile_picture/") { assert_eq!(request.headers()["authorization"], "Bearer rotated"); }
            let bytes = axum::body::to_bytes(request.into_body(), 1_000_000).await.unwrap();
            let url = reqwest::Url::parse(&format!("http://local/?{}", String::from_utf8(bytes.to_vec()).unwrap())).unwrap();
            let fields: HashMap<_,_> = url.query_pairs().into_owned().collect();
            if path.ends_with("edit_profile/") {
                let (_, payload) = fields["signed_body"].split_once('.').unwrap();
                let data: Value = serde_json::from_str(payload).unwrap();
                assert_eq!(data["email"], "keep@example.test");
                assert_eq!(data["biography"], "keep bio");
                assert_eq!(data["username"], "new");
                return Json(json!({"user":{"username":"new","full_name":"Name"}})).into_response();
            }
            if path.ends_with("change_profile_picture/") {
                assert_eq!(fields["_csrftoken"], "changed");
                return Json(json!({"status":"ok"})).into_response();
            }
            assert!(path.ends_with("raven_attachment/"));
            let (_, payload) = fields["signed_body"].split_once('.').unwrap();
            let data: Value = serde_json::from_str(payload).unwrap();
            assert_eq!(data["thread_ids"], "[123]");
            assert_eq!(data["attachment_fbid"], "987654321");
            assert_eq!(data["extra"], json!({"source_width":720,"source_height":1280}));
            assert_eq!(data["clips"][0]["length"], 2.5);
            assert_eq!(data["length"], 2.5);
            Json(json!({"status":"ok","payload":{"item_id":"456"}})).into_response()
        }
    }).await;
    let uploads = uploads();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("video");
    tokio::fs::write(&path, b"0000ftyp1234").await.unwrap();
    uploads.entries.lock().await.insert(
        "video".into(),
        Arc::new(crate::uploads::Upload {
            _directory: directory,
            expires: std::time::Instant::now() + std::time::Duration::from_secs(60),
            path,
            size: 12,
            kind: "video".into(),
        }),
    );
    let service = Service::new(Arc::new(Api::from_env().unwrap()), uploads);
    let mut mobile = mobile(Some(fixture.url.clone()));
    operations::invoke(
        &service,
        &mut mobile,
        "username",
        &json!({"username":"new"}),
    )
    .await
    .unwrap();
    operations::invoke(
        &service,
        &mut mobile,
        "avatar",
        &json!({"image":STANDARD.encode([255,216,255,217])}),
    )
    .await
    .unwrap();
    let before = calls.lock().await.len();
    assert!(operations::invoke(
        &service,
        &mut mobile,
        "attachment",
        &json!({"threadId":"123","kind":"video","uploadId":"video","video":{"width":0}})
    )
    .await
    .is_err());
    assert_eq!(calls.lock().await.len(), before);
    operations::invoke(&service, &mut mobile, "attachment", &json!({"threadId":"123","kind":"video","uploadId":"video","video":{"width":720,"height":1280,"duration":2.5}})).await.unwrap();
}

#[tokio::test]
async fn attachments_stream_native_owned_files_and_validate_resume_offsets() {
    let calls = Arc::new(Mutex::new(vec![]));
    let observed = calls.clone();
    let fixture = Fixture::start(move |request| {
        let calls = observed.clone();
        async move {
            let path = request.uri().path().to_string();
            assert_eq!(request.headers()["authorization"], "Bearer test");
            if request.method() == Method::GET {
                return Json(json!({"offset":if path.contains("messenger_audio"){2}else{99}}))
                    .into_response();
            }
            let offset = request.headers()["offset"]
                .to_str()
                .unwrap()
                .parse::<usize>()
                .unwrap();
            let size = request.headers()["x-entity-length"]
                .to_str()
                .unwrap()
                .parse::<usize>()
                .unwrap();
            let bytes = axum::body::to_bytes(request.into_body(), 100)
                .await
                .unwrap();
            calls
                .lock()
                .await
                .push((path, offset, size, bytes.to_vec()));
            Json(json!({"media_id":9007199254740993u64})).into_response()
        }
    })
    .await;
    let uploads = uploads();
    for kind in ["photo", "voice", "video"] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("input");
        let bytes = if kind == "photo" {
            vec![255, 216, 255, 217]
        } else {
            b"0000ftyp1234".to_vec()
        };
        tokio::fs::write(&path, &bytes).await.unwrap();
        uploads.entries.lock().await.insert(
            kind.into(),
            Arc::new(crate::uploads::Upload {
                _directory: directory,
                expires: std::time::Instant::now() + std::time::Duration::from_secs(60),
                path,
                size: bytes.len() as u64,
                kind: kind.into(),
            }),
        );
    }
    let service = Service::new(Arc::new(Api::from_env().unwrap()), uploads);
    let mobile = mobile(Some(fixture.url.clone()));
    for kind in ["photo", "voice"] {
        let result = attachments::upload(&service, &mobile, kind, &json!({"uploadId":kind}))
            .await
            .unwrap();
        assert_eq!(result.media_id, "9007199254740993");
    }
    let calls = calls.lock().await;
    assert_eq!(calls[0].1, 0);
    assert_eq!(calls[0].2, 4);
    assert_eq!(calls[0].3, vec![255, 216, 255, 217]);
    assert_eq!(calls[1].1, 2);
    assert_eq!(calls[1].2, 12);
    assert_eq!(calls[1].3, b"00ftyp1234");
    assert!(
        attachments::upload(&service, &mobile, "video", &json!({"uploadId":"video"}))
            .await
            .err()
            .unwrap()
            .message
            .contains("invalid offset")
    );
    assert!(
        attachments::upload(&service, &mobile, "voice", &json!({"uploadId":"photo"}))
            .await
            .is_err()
    );
    assert!(attachments::upload(
        &service,
        &mobile,
        "photo",
        &json!({"uploadId":"missing","path":"/private/file"})
    )
    .await
    .is_err());
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
        if path.ends_with("qe/sync/"){return (StatusCode::METHOD_NOT_ALLOWED,[("ig-set-password-encryption-pub-key",public.as_str()),("ig-set-password-encryption-key-id","7")],Json(json!({}))).into_response();}
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
    mobile.state.authorization.clear();
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
        base,
    }
}
fn uploads() -> Arc<Uploads> {
    Arc::new(Uploads {
        entries: Mutex::new(HashMap::new()),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    })
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
async fn malformed_inboxes_return_errors_without_panicking() {
    let service = Service::new(Arc::new(Api::from_env().unwrap()), uploads());
    for response in [
        Value::Null,
        json!([]),
        json!({}),
        json!({"inbox":[]}),
        json!({"inbox":{"threads":false}}),
    ] {
        let fixture = Fixture::start(move |_| {
            let response = response.clone();
            async move { Json(response).into_response() }
        })
        .await;
        let mut mobile = mobile(Some(fixture.url.clone()));
        assert_eq!(
            operations::invoke(&service, &mut mobile, "inbox", &json!({}))
                .await
                .unwrap_err()
                .message,
            "Instagram returned no DM inbox"
        );
    }
}

#[tokio::test]
async fn native_inbox_and_post_pagination_preserve_limits_and_pinned_posts() {
    let fixture=Fixture::start(|request|async move{
        let query=reqwest::Url::parse(&format!("http://local{}",request.uri())).unwrap();let query:HashMap<_,_>=query.query_pairs().into_owned().collect();let path=request.uri().path();
        if path.ends_with("inbox/"){let start=if query.contains_key("cursor"){20}else{0};return Json(json!({"inbox":{"threads":(start..start+20).map(|id|json!({"thread_id":id.to_string(),"items":[{"timestamp":"1"},{"timestamp":"2"}]})).collect::<Vec<_>>(),"oldest_cursor":if start==0{"next"}else{""},"has_older":start==0}})).into_response();}
        if path.ends_with("users/search/"){return Json(json!({"users":[{"pk":"123","username":"source"}]})).into_response();}
        let first=!query.contains_key("max_id");let items=if first{json!([{"pk":"1","code":"old_pinned","taken_at":10,"timeline_pinned_user_ids":["123"]},{"pk":"2","code":"two","taken_at":300}])}else{json!([{"pk":"2","code":"two","taken_at":300},{"pk":"3","code":"three","taken_at":200},{"pk":"4","code":"old","taken_at":10}])};Json(json!({"items":items,"next_max_id":"next","more_available":true})).into_response()
    }).await;
    let mut mobile = mobile(Some(fixture.url.clone()));
    let service = Service::new(Arc::new(Api::from_env().unwrap()), uploads());
    let inbox = operations::invoke(&service, &mut mobile, "inbox", &json!({}))
        .await
        .unwrap();
    assert_eq!(inbox["threads"].as_array().unwrap().len(), 30);
    assert_eq!(inbox["threads"][0]["items"].as_array().unwrap().len(), 1);
    assert_eq!(inbox["threads"][0]["items"][0]["timestamp"], "2");
    let unread = operations::invoke(&service, &mut mobile, "inbox", &json!({"onlyUnread":true}))
        .await
        .unwrap();
    assert_eq!(unread["threads"].as_array().unwrap().len(), 40);
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
        json!([{"id":"2","code":"two"},{"id":"3","code":"three"}])
    );
    let posts = operations::invoke(
        &service,
        &mut mobile,
        "posts",
        &json!({"username":"source","sinceDate":100_000,"postLimit":1}),
    )
    .await
    .unwrap();
    assert_eq!(posts, json!([{"id":"2","code":"two"}]));
}
#[tokio::test]
async fn native_replies_reactions_and_unsend_preserve_request_fields() {
    let calls = Arc::new(Mutex::new(vec![]));
    let observed = calls.clone();
    let fixture = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            let path = request.uri().path().to_string();
            let bytes = axum::body::to_bytes(request.into_body(), 1_000_000)
                .await
                .unwrap();
            let url = reqwest::Url::parse(&format!(
                "http://local/?{}",
                String::from_utf8(bytes.to_vec()).unwrap()
            ))
            .unwrap();
            let body: HashMap<_, _> = url.query_pairs().into_owned().collect();
            observed.lock().await.push((path, body));
            Json(json!({"status":"ok","payload":{"item_id":"456"}})).into_response()
        }
    })
    .await;
    let mut mobile = mobile(Some(fixture.url.clone()));
    let service = Service::new(Arc::new(Api::from_env().unwrap()), uploads());
    let context = uuid::Uuid::new_v4().to_string();
    operations::invoke(
        &service,
        &mut mobile,
        "reply",
        &json!({"threadId":"123","text":"hello https://example.com/path","clientContext":context}),
    )
    .await
    .unwrap();
    operations::invoke(&service,&mut mobile,"reaction",&json!({"threadId":"123","itemId":"456","kind":"text","emoji":"❤️","remove":true,"clientContext":context})).await.unwrap();
    operations::invoke(
        &service,
        &mut mobile,
        "unsend",
        &json!({"threadId":"123","itemId":"456"}),
    )
    .await
    .unwrap();
    let calls = calls.lock().await;
    assert!(calls[0].0.ends_with("broadcast/link/"));
    assert_eq!(calls[0].1["thread_ids"], "[123]");
    assert_eq!(calls[0].1["client_context"], context);
    assert_eq!(calls[0].1["link_urls"], "[\"https://example.com/path\"]");
    assert_eq!(calls[1].1["reaction_status"], "deleted");
    assert_eq!(calls[1].1["original_message_client_context"], context);
    assert!(calls[2].0.ends_with("threads/123/items/456/delete/"));
}
#[tokio::test]
async fn native_session_serialization_prevents_stale_saves_after_logout() {
    let session = serde_json::to_string(&mobile(None).state).unwrap();
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
                "/api/chat/session" | "/api/chat/context"
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
                Method::DELETE => {
                    *store.lock().await = None;
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
    let service = Service::new(Arc::new(api), uploads());
    let request = Command {
        profile_id: "profile".into(),
        token: Some(token),
        args: json!({}),
    };
    service.invoke("load", &request).await.unwrap();
    service.invoke("logout", &request).await.unwrap();
    assert!(service.invoke("load", &request).await.is_err());
    assert_eq!(deletes.load(Ordering::SeqCst), 1);
    let _ = test_support::body;
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
            let context = request.uri().path() == "/api/chat/context";
            assert!(context || request.uri().path() == "/api/chat/session");
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
    let mut service = Service::new(Arc::new(api), uploads());
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
            let context = request.uri().path() == "/api/chat/context";
            assert!(context || request.uri().path() == "/api/chat/session");
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
    let mut service = Service::new(Arc::new(api), uploads());
    Arc::get_mut(&mut service).unwrap().base = Some(upstream.url.clone());
    let request = Command {
        profile_id: "profile".into(),
        token: Some("saved-token".into()),
        args: json!({}),
    };
    assert_eq!(
        service.invoke("inbox", &request).await.unwrap_err().status,
        503
    );
    assert_eq!(writes.load(Ordering::SeqCst), 0);
    mode.store(1, Ordering::SeqCst);
    assert_eq!(
        service.invoke("inbox", &request).await.unwrap_err().status,
        401
    );
    assert_eq!(writes.load(Ordering::SeqCst), 1);
    assert_eq!(saved.lock().await["reconnectRequired"], true);
    assert_eq!(saved.lock().await["state"], original);
}
