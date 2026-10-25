use super::*;

#[tokio::test]
async fn periodic_content_recovery_retries_failed_deletions_without_blocking_account_setup() {
    use crate::test_support::Fixture;
    use axum::{response::IntoResponse, Json};
    let operations = Arc::new(Mutex::new(Vec::<String>::new()));
    let swept = Arc::new(tokio::sync::Notify::new());
    let retried = Arc::new(tokio::sync::Notify::new());
    let observed = operations.clone();
    let finished = swept.clone();
    let recovered = retried.clone();
    let fixture = Fixture::start(move |request| {
        let observed = observed.clone();
        let finished = finished.clone();
        let recovered = recovered.clone();
        async move {
            assert_eq!(request.headers()["authorization"], "Bearer fixture");
            match request.uri().path() {
                "/api/models" => {
                    let mut operations = observed.lock().await;
                    operations.push("recovery".into());
                    if operations
                        .iter()
                        .filter(|operation| *operation == "recovery")
                        .count()
                        == 2
                    {
                        recovered.notify_one();
                    }
                    axum::http::StatusCode::BAD_REQUEST.into_response()
                }
                "/api/ig-accounts-store" => {
                    let body = crate::test_support::body(request).await;
                    assert_eq!(body["operation"], "connectedNames");
                    observed.lock().await.push("sync_names".into());
                    Json(json!({"page":[],"isDone":true})).into_response()
                }
                "/api/automations" => {
                    observed.lock().await.push("sweep_setup".into());
                    finished.notify_one();
                    Json(json!([])).into_response()
                }
                _ => panic!("Unexpected periodic setup route"),
            }
        }
    })
    .await;
    let root = tempfile::tempdir().unwrap();
    let orphan = root.path().join("content/model-orphan");
    let pending = orphan.join("posts/image");
    tokio::fs::create_dir_all(pending.parent().unwrap())
        .await
        .unwrap();
    // A file where the item directory belongs makes the first cleanup fail.
    tokio::fs::write(&pending, b"blocked cleanup")
        .await
        .unwrap();
    tokio::fs::write(
        orphan.join("manifest.json"),
        serde_json::to_vec(&json!([{
            "id":"image", "kind":"posts", "name":"photo.jpg", "variants":[],
            "assigned":{}, "createdAt":0, "pendingDeletion":true
        }]))
        .unwrap(),
    )
    .await
    .unwrap();
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let profiles = Profiles::new(
        api.clone(),
        super::super::processes::Processes::new(api.clone(), root.path().into()),
        root.path().into(),
    );
    let mut accounts = Accounts::new(
        api.clone(),
        profiles,
        Content::new(root.path().join("content")),
        Subscriptions::new(api),
    );
    Arc::get_mut(&mut accounts).unwrap().credential_key = Some(vec![0xaa; 32]);
    let periodic = accounts.periodic_setup();
    tokio::pin!(periodic);
    tokio::time::timeout(Duration::from_secs(5), async {
        tokio::select! {
            result = &mut periodic => panic!("Periodic setup stopped: {result:?}"),
            _ = swept.notified() => {}
        }
    })
    .await
    .unwrap();
    assert_eq!(
        *operations.lock().await,
        ["recovery", "sync_names", "sweep_setup"]
    );
    assert!(
        orphan.exists(),
        "Failed model lookup must not remove the orphan directory"
    );
    assert!(pending.exists());
    let manifest: Value =
        serde_json::from_slice(&tokio::fs::read(orphan.join("manifest.json")).await.unwrap())
            .unwrap();
    assert_eq!(manifest[0]["pendingDeletion"], true);

    tokio::fs::remove_file(&pending).await.unwrap();
    // Advance to the next scheduled tick without waiting fifteen real minutes.
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(900)).await;
    tokio::time::resume();
    tokio::time::timeout(Duration::from_secs(5), async {
        tokio::select! {
            result = &mut periodic => panic!("Periodic setup stopped: {result:?}"),
            _ = retried.notified() => {}
        }
    })
    .await
    .unwrap();
    let manifest: Value =
        serde_json::from_slice(&tokio::fs::read(orphan.join("manifest.json")).await.unwrap())
            .unwrap();
    assert_eq!(manifest, json!([]));
}

#[tokio::test]
async fn content_recovery_queues_only_orphans_and_cleanup_retries_failed_acknowledgements() {
    use crate::test_support::Fixture;
    use axum::{response::IntoResponse, Json};
    use std::sync::atomic::{AtomicUsize, Ordering};
    let queued = Arc::new(Mutex::new(Vec::<String>::new()));
    let acknowledgements = Arc::new(AtomicUsize::new(0));
    let observed = queued.clone();
    let count = acknowledgements.clone();
    let fixture = Fixture::start(move |request| {
        let observed = observed.clone();
        let count = count.clone();
        async move {
            assert_eq!(request.headers()["authorization"], "Bearer fixture");
            match request.uri().path() {
                "/api/models" => {
                    Json(json!([{"id":"model-new","contentKey":"model-live"}])).into_response()
                }
                "/api/models/content-cleanup" => {
                    let body = crate::test_support::body(request).await;
                    assert_eq!(body["contentKey"], "model-orphan");
                    if body["operation"] == "queue" {
                        observed.lock().await.push("model-orphan".into());
                    } else if count.fetch_add(1, Ordering::SeqCst) == 0 {
                        return axum::http::StatusCode::BAD_REQUEST.into_response();
                    }
                    Json(json!({"ok":true})).into_response()
                }
                _ => panic!("Unexpected cleanup route"),
            }
        }
    })
    .await;
    let root = tempfile::tempdir().unwrap();
    let content = Content::new(root.path().join("content"));
    for model in ["model-live", "model-orphan"] {
        let dir = root
            .path()
            .join("content")
            .join(model)
            .join("posts/image/variants");
        tokio::fs::create_dir_all(&dir).await.unwrap();
        tokio::fs::write(dir.join("copy.jpg"), b"copy")
            .await
            .unwrap();
    }
    let pending = root.path().join("content/model-live/avatars/pending");
    tokio::fs::create_dir_all(&pending).await.unwrap();
    tokio::fs::write(pending.join("source.jpg"), b"fixture")
        .await
        .unwrap();
    tokio::fs::write(
        root.path().join("content/model-live/manifest.json"),
        serde_json::to_vec(&json!([{
            "id":"pending", "kind":"avatars", "name":"photo.jpg", "variants":[],
            "assigned":{}, "createdAt":0, "pendingDeletion":true
        }]))
        .unwrap(),
    )
    .await
    .unwrap();
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let profiles = Profiles::new(
        api.clone(),
        super::super::processes::Processes::new(api.clone(), root.path().into()),
        root.path().into(),
    );
    let accounts = Accounts::new(api.clone(), profiles, content, Subscriptions::new(api));
    accounts.recover_content_cleanup().await.unwrap();
    assert_eq!(*queued.lock().await, vec!["model-orphan"]);
    assert!(!pending.exists());
    let manifest: Value = serde_json::from_slice(
        &tokio::fs::read(root.path().join("content/model-live/manifest.json"))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(manifest, json!([]));
    let work = json!(["model-orphan"]);
    accounts.cleanup_content(&work).await;
    assert!(!root.path().join("content/model-orphan").exists());
    assert_eq!(acknowledgements.load(Ordering::SeqCst), 1);
    accounts.cleanup_content(&work).await;
    assert_eq!(acknowledgements.load(Ordering::SeqCst), 2);
    assert!(root
        .path()
        .join("content/model-live/posts/image/variants/copy.jpg")
        .exists());
}

#[tokio::test]
async fn native_shutdown_drains_inline_browser_logins_before_returning() {
    inline_login_shutdown(true, false).await;
}

#[tokio::test]
async fn native_shutdown_bounds_stalled_login_acknowledgement_and_job_drain() {
    inline_login_shutdown(false, false).await;
}

#[tokio::test]
async fn native_shutdown_bounds_login_acknowledgement_body_reads() {
    inline_login_shutdown(false, true).await;
}

async fn inline_login_shutdown(acknowledged: bool, headers_only: bool) {
    use crate::test_support::Fixture;
    use axum::{response::IntoResponse, Json};
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let seen = entered.clone();
    let acknowledgement = release.clone();
    let fixture = Fixture::start(move |request| {
        let seen = seen.clone();
        let acknowledgement = acknowledgement.clone();
        async move {
            assert_eq!(request.uri().path(), "/commands/browser.shutdown");
            assert_eq!(request.headers()["authorization"], "Bearer fixture");
            seen.notify_one();
            if headers_only {
                return axum::body::Body::from_stream(futures_util::stream::pending::<
                    std::result::Result<String, std::io::Error>,
                >())
                .into_response();
            }
            acknowledgement.notified().await;
            Json(json!({"stopped":true})).into_response()
        }
    })
    .await;
    let root = tempfile::tempdir().unwrap();
    let mut api = Api::from_env().unwrap();
    api.worker_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let profiles = Profiles::new(
        api.clone(),
        super::super::processes::Processes::new(api.clone(), root.path().into()),
        root.path().into(),
    );
    let accounts = Accounts::new(
        api.clone(),
        profiles,
        Content::new(root.path().join("content")),
        Subscriptions::new(api),
    );
    let job_finished = Arc::new(tokio::sync::Notify::new());
    let work = job_finished.clone();
    accounts.launch(async move { work.notified().await }).await;
    let state = accounts.clone();
    let started = tokio::time::Instant::now();
    let deadline = started
        + if acknowledged {
            Duration::from_secs(20)
        } else {
            Duration::from_millis(200)
        };
    let shutdown = tokio::spawn(async move { state.shutdown(deadline).await });
    tokio::time::timeout(Duration::from_secs(5), entered.notified())
        .await
        .unwrap();
    assert!(*accounts.stop.borrow());
    if acknowledged {
        job_finished.notify_one();
    }
    tokio::task::yield_now().await;
    assert!(
        !shutdown.is_finished(),
        "Bun cleanup must acknowledge before shutdown finishes"
    );
    if acknowledged {
        release.notify_one();
    }
    tokio::time::timeout(Duration::from_secs(5), shutdown)
        .await
        .unwrap()
        .unwrap();
    assert!(accounts.jobs.lock().await.is_empty());
    if !acknowledged {
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "Acknowledgement and job drain must share the deadline"
        );
    }
}
#[test]
fn credentials_handle_colons_and_validate_authenticator() {
    let value =
        parse_credentials(" Example.User :password:with:colons:JBSW-Y3DP EHPK3PXP ").unwrap();
    assert_eq!(value.username, "Example.User");
    assert_eq!(value.password, "password:with:colons");
    assert_eq!(value.authenticator_key, "JBSWY3DPEHPK3PXP");
    for raw in [
        "user:pass:short",
        "../user:pass:JBSWY3DPEHPK3PXP",
        "user::JBSWY3DPEHPK3PXP",
        "user:pass:JBSWY3DPEHPK3PX1",
    ] {
        assert!(parse_credentials(raw).is_err());
    }
}
#[test]
fn encryption_is_random_and_authenticated_to_the_username() {
    let key = [0xaa; 32];
    let credentials = parse_credentials("example_user:private-password:JBSWY3DPEHPK3PXP").unwrap();
    let a = encrypt(&key, &credentials).unwrap();
    let b = encrypt(&key, &credentials).unwrap();
    assert_eq!(a.username_hash, b.username_hash);
    assert_ne!(a.ciphertext, b.ciphertext);
    assert_eq!(decrypt(&key, &a).unwrap(), credentials);
    let mut tampered = Encrypted {
        username_hash: "b".repeat(64),
        ciphertext: a.ciphertext.clone(),
    };
    assert!(decrypt(&key, &tampered).is_err());
    tampered.username_hash = a.username_hash.clone();
    tampered.ciphertext.push('A');
    assert!(decrypt(&key, &tampered).is_err());
    assert!(decrypt(&[0xbb; 32], &a).is_err());
    let row = json!({"_id":"good","status":"available","createdAt":1,"usernameHash":a.username_hash,"ciphertext":a.ciphertext});
    let public = public_row(&row, &key);
    assert_eq!(public["username"], "example_user");
    assert!(public.get("password").is_none());
    assert!(public.get("authenticatorKey").is_none());
    let bad = json!({"_id":"bad","createdAt":1,"ciphertext":"v1.corrupt"});
    assert_eq!(public_row(&bad, &key)["status"], "invalid");
}

#[test]
fn legacy_v1_ciphertext_and_username_hash_remain_decryptable() {
    use aes_gcm::{
        aead::{Aead, KeyInit, Payload},
        Aes256Gcm, Nonce,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    let key = [0x11; 32];
    let credentials = parse_credentials("legacy_user:legacy-password:JBSWY3DPEHPK3PXP").unwrap();
    let hash = username_hash(&key, &credentials.username);
    let iv = [0x22; 12];
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let payload = serde_json::to_vec(&credentials).unwrap();
    let sealed = cipher
        .encrypt(
            &Nonce::try_from(iv.as_slice()).unwrap(),
            Payload {
                msg: &payload,
                aad: &unhex(&hash).unwrap(),
            },
        )
        .unwrap();
    let (encrypted, tag) = sealed.split_at(sealed.len() - 16);
    let row = Encrypted {
        username_hash: hash,
        ciphertext: format!(
            "v1.{}.{}.{}",
            URL_SAFE_NO_PAD.encode(iv),
            URL_SAFE_NO_PAD.encode(tag),
            URL_SAFE_NO_PAD.encode(encrypted),
        ),
    };
    assert_eq!(
        row.username_hash,
        "0d35c8b3d142e372ad6714d8a8211fb384831e50c391955bebcc30e0ade7cc7b"
    );
    assert_eq!(
        row.ciphertext,
        "v1.IiIiIiIiIiIiIiIi.ymQL4zcn_BorpSOPj_LMZg.bNVyOqW98T6IWvwGasqMsn7wtL0f8sk5cGMomGiSFnQqDc8gaYqVuyk5jlTLKChGwKXxEPFQVtzVAZ6RhwWb2xvtaFcjzjRryVsU21W6qVXW-fN7S76QYAlZgYhD"
    );
    assert_eq!(decrypt(&key, &row).unwrap(), credentials);
}
#[test]
fn setup_days_follow_kyiv_midnight_and_dst() {
    let at = |raw: &str| {
        chrono::DateTime::parse_from_rfc3339(raw)
            .unwrap()
            .timestamp_millis() as u64
    };
    assert_eq!(
        setup::day(at("2026-10-24T20:59:00Z"), at("2026-10-24T21:01:00Z")),
        2
    );
    assert_eq!(
        setup::day(at("2026-10-24T21:01:00Z"), at("2026-10-25T22:01:00Z")),
        2
    );
}

#[tokio::test]
async fn browser_setup_prepares_without_mobile_and_keeps_uncertain_results_pending() {
    use crate::test_support::{self, Fixture};
    use axum::{response::IntoResponse, Json};
    for outcome in [
        "applied",
        "failed",
        "unavailable",
        "uncertain",
        "save failure",
        "paused",
        "restore readiness",
    ] {
        let root = tempfile::tempdir().unwrap();
        let progress = Arc::new(Mutex::new(
            json!({"profileId":"p","modelId":"model","startedAt":api::now_ms()-5*86_400_000,"postSourceIds":[],"postDates":[]}),
        ));
        if outcome == "restore readiness" {
            let mut state = progress.lock().await;
            state["usernameDone"] = json!(true);
            state["avatarDone"] = json!(true);
            state["outreachReadyMarked"] = json!(true);
            state["postSourceIds"] = json!(["s1", "s2", "s3"]);
            state["postDates"] = json!(["d1", "d2", "d3"]);
        }
        let account = Arc::new(Mutex::new({
            let encrypted = encrypt(
                &[0xaa; 32],
                &parse_credentials("example:password:JBSWY3DPEHPK3PXP").unwrap(),
            )
            .unwrap();
            let mut value = serde_json::to_value(encrypted).unwrap();
            value["_id"] = json!("a");
            value["status"] = json!("assigned");
            value["profileId"] = json!("p");
            value["browserLoggedInAt"] = json!(api::now_ms() - 5 * 86_400_000);
            value
        }));
        let stored = account.clone();
        let observed = progress.clone();
        let fixture=Fixture::start(move |request| {let account=stored.clone();let state=observed.clone();async move {
            match request.uri().path() {
                "/api/automations/by-id"=>Json(json!({"isActive":true,"routine":{},"modelIds":["model"]})).into_response(),
                "/api/profiles"=>Json(json!([{"id":"p","name":"example","createdAt":1,"igLoggedIn":true,"inUse":true,"status":"running","proxy":"work.test:80","paused":outcome=="paused","modelId":"model"}])).into_response(),
                "/api/models"=>Json(json!([{"id":"model","usernames":["changed_name"]}])).into_response(),
                "/api/routines/ready"=>Json(json!(true)).into_response(),
                "/api/ig-accounts-store"=>{
                    let body=test_support::body(request).await;
                    let value=match profiles::text(&body,"operation") {
                        "byProfile"|"byId"=>account.lock().await.clone(),
                        "modelSetupList"=>json!([state.lock().await.clone()]),
                        "modelSetupPatch"=>{
                            if outcome=="save failure"&&body["patch"]["usernameDone"]==true{return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();}
                            let mut current=state.lock().await;
                            for(key,value)in body["patch"].as_object().unwrap(){current[key]=value.clone();}
                            for key in body["clear"].as_array().unwrap(){current.as_object_mut().unwrap().remove(key.as_str().unwrap());}
                            json!({"ok":true})
                        },
                        "setUsername"=>{
                            let encrypted:Encrypted=serde_json::from_value(body.clone()).unwrap();
                            let credentials=decrypt(&[0xaa;32],&encrypted).unwrap();
                            assert_eq!(credentials.username,"changed_name");assert_eq!(credentials.password,"password");
                            let mut current=account.lock().await;current["ciphertext"]=body["ciphertext"].clone();current["usernameHash"]=body["usernameHash"].clone();json!({"ok":true})
                        },
                        _=>panic!("Unexpected setup mutation"),
                    };Json(value).into_response()
                },
                _=>panic!("Browser setup must not invoke mobile APIs or rename a running browser"),
            }
        }}).await;
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.key = "fixture".into();
        let api = Arc::new(api);
        let processes = super::super::processes::Processes::new(api.clone(), root.path().into());
        let profiles = Profiles::new(api.clone(), processes, root.path().into());
        let mut accounts = Accounts::new(
            api.clone(),
            profiles,
            Content::new(root.path().join("content")),
            Subscriptions::new(api),
        );
        Arc::get_mut(&mut accounts).unwrap().credential_key = Some(vec![0xaa; 32]);
        let mut model = None;
        let task = accounts
            .prepare_browser_setup("p", "automation", &mut model)
            .await
            .unwrap();
        if outcome == "paused" {
            assert!(task.is_null());
            assert!(progress.lock().await["pending"].is_null());
            continue;
        }
        if outcome == "restore readiness" {
            assert!(task.is_null());
            assert_eq!(progress.lock().await["outreachReadyMarked"], true);
            continue;
        }
        assert_eq!(task["kind"], "username");
        assert_eq!(task["value"], "changed_name");
        assert_eq!(task["currentUsername"], "example");
        assert_eq!(progress.lock().await["pending"]["kind"], "username");
        let result = accounts
            .finish_browser_setup(
                "p",
                "model",
                &task,
                if outcome == "save failure" {
                    "applied"
                } else {
                    outcome
                },
            )
            .await;
        if outcome == "save failure" {
            assert!(result.is_err());
        } else {
            result.unwrap();
        }
        let state = progress.lock().await.clone();
        if outcome == "applied" {
            assert_eq!(state["usernameDone"], true);
            assert!(state["pending"].is_null());
        } else if ["uncertain", "save failure"].contains(&outcome) {
            assert_eq!(state["pending"]["kind"], "username");
            assert!(accounts
                .prepare_browser_setup("p", "automation", &mut model)
                .await
                .unwrap()
                .is_null());
        } else {
            assert!(state["pending"].is_null());
            assert!(state["error"].is_string());
        }
    }
}

#[tokio::test]
async fn manual_login_recovers_derived_connection_even_when_profile_name_matches() {
    use crate::test_support::Fixture;
    use axum::{response::IntoResponse, Json};

    for scenario in [
        "derived connection",
        "assigned",
        "verified connection",
        "invalid",
        "logged out",
        "paused",
        "in use",
    ] {
        let root = tempfile::tempdir().unwrap();
        let encrypted = encrypt(
            &[0xaa; 32],
            &parse_credentials("example:password:JBSWY3DPEHPK3PXP").unwrap(),
        )
        .unwrap();
        let mut account = serde_json::to_value(encrypted).unwrap();
        account["_id"] = json!("a");
        account["profileId"] = json!("p");
        account["status"] = json!(match scenario {
            "assigned" => "assigned",
            "invalid" => "invalid",
            _ => "connected",
        });
        if scenario == "verified connection" {
            account["browserLoggedInAt"] = json!(1);
        }
        let updates = Arc::new(Mutex::new(Vec::new()));
        let observed = updates.clone();
        let fixture = Fixture::start(move |request| {
            let account = account.clone();
            let updates = observed.clone();
            async move {
                match request.uri().path() {
                    "/api/profiles/by-id" => Json(json!({
                        "id":"p", "name":"example",
                        "igLoggedIn":scenario != "logged out",
                        "paused":scenario == "paused",
                        "inUse":scenario == "in use",
                    }))
                    .into_response(),
                    "/api/ig-accounts-store" => {
                        let body = crate::test_support::body(request).await;
                        let value = match profiles::text(&body, "operation") {
                            "byProfile" => account,
                            "setState" => {
                                updates.lock().await.push(body);
                                json!({"ok":true})
                            }
                            _ => panic!("Unexpected account operation during manual recovery"),
                        };
                        Json(value).into_response()
                    }
                    _ => panic!("Manual recovery must not rename the profile or launch a browser"),
                }
            }
        })
        .await;
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.worker_url = fixture.url.clone();
        api.key = "fixture".into();
        let api = Arc::new(api);
        let profiles = Profiles::new(
            api.clone(),
            super::super::processes::Processes::new(api.clone(), root.path().into()),
            root.path().into(),
        );
        let mut accounts = Accounts::new(
            api.clone(),
            profiles,
            Content::new(root.path().join("content")),
            Subscriptions::new(api),
        );
        Arc::get_mut(&mut accounts).unwrap().credential_key = Some(vec![0xaa; 32]);

        accounts.login("p").await.unwrap();

        let updates = updates.lock().await;
        if ["derived connection", "assigned"].contains(&scenario) {
            assert_eq!(updates.len(), 1, "{scenario}");
            assert_eq!(updates[0]["id"], "a");
            assert_eq!(updates[0]["status"], "connected");
            assert!(updates[0]["error"].is_null());
        } else {
            assert!(updates.is_empty(), "{scenario}");
        }
    }
}

#[tokio::test]
async fn login_claims_wait_for_cleanup_and_distinct_rejections_invalidate_credentials() {
    use crate::test_support::Fixture;
    use axum::{response::IntoResponse, Json};
    use std::sync::atomic::{AtomicUsize, Ordering};
    for outcome in [
        "success",
        "two rejects",
        "browser failure",
        "cancel failure",
        "duplicate IP",
        "wrong country",
        "claim denied",
        "record failure",
    ] {
        let root = tempfile::tempdir().unwrap();
        let proxy = Fixture::start(|_| async {
            Json(json!({"success":true,"ip":"203.0.113.10","country_code":"UA"})).into_response()
        })
        .await;
        let first=Fixture::start(move |_|async move {Json(json!({"success":true,"ip":"203.0.113.11","country_code":if outcome=="wrong country" {"US"} else {"UA"}})).into_response()}).await;
        let second=Fixture::start(move |_|async move {Json(json!({"success":true,"ip":if outcome=="duplicate IP" {"203.0.113.11"} else {"203.0.113.12"},"country_code":if outcome=="wrong country" {"US"} else {"UA"}})).into_response()}).await;
        let proxies = vec![
            json!({"_id":"resting","proxy":first.url,"country":"ua","loginCooldownUntil":api::now_ms() as f64 + 3_600_000.25}),
            json!({"_id":"proxy1","proxy":first.url,"name":"First","country":"ua"}),
            json!({"_id":"proxy2","proxy":second.url,"name":"Second","country":"ua"}),
        ];
        let encrypted = encrypt(
            &[0xaa; 32],
            &parse_credentials("example:password:JBSWY3DPEHPK3PXP").unwrap(),
        )
        .unwrap();
        let mut account = serde_json::to_value(encrypted).unwrap();
        account["_id"] = json!("a");
        account["status"] = json!("assigned");
        account["profileId"] = json!("p");
        account["createdAt"] = json!(1);
        let state = Arc::new(Mutex::new(account));
        let observed = state.clone();
        let claims = Arc::new(AtomicUsize::new(0));
        let released = Arc::new(AtomicUsize::new(0));
        let browsers = Arc::new(AtomicUsize::new(0));
        let claimed = claims.clone();
        let releases = released.clone();
        let opened = browsers.clone();
        let cancelled = Arc::new(AtomicUsize::new(0));
        let cancellations = cancelled.clone();
        let work_proxy = proxy.url.clone();
        let request_ids = Arc::new(Mutex::new(Vec::new()));
        let observed_ids = request_ids.clone();
        let fixture = Fixture::start(move |request| {
            let state = observed.clone();
            let proxies = proxies.clone();
            let claimed = claimed.clone();
            let releases = releases.clone();
            let opened = opened.clone();
            let proxy = work_proxy.clone();
            let cancellations = cancellations.clone();
            let request_ids = observed_ids.clone();
            async move {
                if request.uri().path().starts_with("/commands/browser.") {
                    let request_id = request.headers()["x-request-id"]
                        .to_str()
                        .unwrap()
                        .to_owned();
                    assert!(uuid::Uuid::parse_str(&request_id).is_ok());
                    request_ids.lock().await.push(request_id);
                }
                match request.uri().path() {
                    "/api/profiles/by-id" => {
                        Json(json!({"id":"p","name":"example","proxy":proxy,"igLoggedIn":false}))
                            .into_response()
                    }
                    "/commands/browser.login" => {
                        let body = crate::test_support::body(request).await;
                        assert_eq!(body["profileName"], "example");
                        assert_eq!(body["account"]["username"], "example");
                        assert!(uuid::Uuid::parse_str(profiles::text(&body, "attemptId")).is_ok());
                        opened.fetch_add(1, Ordering::SeqCst);
                        if ["browser failure", "cancel failure"].contains(&outcome) {
                            return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
                        }
                        Json(if ["two rejects", "duplicate IP"].contains(&outcome) {
                            json!({"rejected":true})
                        } else {
                            json!({"ok":true})
                        })
                        .into_response()
                    }
                    "/commands/browser.cancel-login" => {
                        let body = crate::test_support::body(request).await;
                        assert!(uuid::Uuid::parse_str(profiles::text(&body, "attemptId")).is_ok());
                        assert_eq!(
                            releases.load(Ordering::SeqCst),
                            0,
                            "claim cannot be released before cleanup acknowledgement"
                        );
                        cancellations.fetch_add(1, Ordering::SeqCst);
                        if outcome == "cancel failure" {
                            return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
                        }
                        Json(json!({"cancelled":true})).into_response()
                    }
                    "/api/ig-accounts-store" => {
                        let body = crate::test_support::body(request).await;
                        let value = match profiles::text(&body, "operation") {
                            "byProfile" => state.lock().await.clone(),
                            "loginProxies" => json!(proxies),
                            "claimLoginProxy" => {
                                claimed.fetch_add(1, Ordering::SeqCst);
                                assert!(
                                    uuid::Uuid::parse_str(profiles::text(&body, "token")).is_ok()
                                );
                                json!(outcome != "claim denied")
                            }
                            "releaseLoginProxy" => {
                                releases.fetch_add(1, Ordering::SeqCst);
                                json!({"ok":true})
                            }
                            "recordBrowserLogin" => {
                                let cooldown = body["cooldownMs"].as_u64().unwrap();
                                assert!((3 * 86_400_000..=5 * 86_400_000).contains(&cooldown));
                                if outcome == "record failure" {
                                    return axum::http::StatusCode::INTERNAL_SERVER_ERROR
                                        .into_response();
                                }
                                state.lock().await["browserLoggedInAt"] =
                                    body["browserLoggedInAt"].clone();
                                json!({"cooldownRecorded":true})
                            }
                            "setState" => {
                                let mut state = state.lock().await;
                                state["status"] = body["status"].clone();
                                state["retryAfter"] = body["retryAfter"].clone();
                                json!({"ok":true})
                            }
                            _ => panic!("Unexpected account operation"),
                        };
                        Json(value).into_response()
                    }
                    _ => panic!("Unexpected login fixture request"),
                }
            }
        })
        .await;
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.worker_url = fixture.url.clone();
        api.key = "fixture".into();
        let api = Arc::new(api);
        let profiles = Profiles::new(
            api.clone(),
            super::super::processes::Processes::new(api.clone(), root.path().into()),
            root.path().into(),
        );
        let mut accounts = Accounts::new(
            api.clone(),
            profiles,
            Content::new(root.path().join("content")),
            Subscriptions::new(api),
        );
        let mutable = Arc::get_mut(&mut accounts).unwrap();
        mutable.credential_key = Some(vec![0xaa; 32]);
        Arc::get_mut(&mut mutable.proxies).unwrap().probe_url = "http://geo.fixture/".into();
        accounts.login("p").await.unwrap();
        let request_ids = request_ids.lock().await;
        assert!(
            request_ids.windows(2).all(|ids| ids[0] == ids[1]),
            "browser attempts and cleanup must share one login correlation"
        );
        let state = state.lock().await;
        match outcome {
            "success" => {
                assert!(state["browserLoggedInAt"].is_number());
                assert_eq!(browsers.load(Ordering::SeqCst), 1);
            }
            "two rejects" => {
                assert_eq!(state["status"], "invalid");
                assert_eq!(browsers.load(Ordering::SeqCst), 2);
                assert_eq!(
                    accounts
                        .proxies
                        .blacklist()
                        .await
                        .unwrap()
                        .as_array()
                        .unwrap()
                        .len(),
                    2
                );
            }
            "wrong country" | "claim denied" => {
                assert_eq!(browsers.load(Ordering::SeqCst), 0);
                assert!(state["retryAfter"].as_u64().unwrap() > api::now_ms());
            }
            _ => {
                assert_eq!(state["status"], "assigned");
                assert_eq!(browsers.load(Ordering::SeqCst), 1);
                assert!(state["retryAfter"].as_u64().unwrap() > api::now_ms());
            }
        }
        assert_eq!(
            released.load(Ordering::SeqCst),
            if ["claim denied", "cancel failure"].contains(&outcome) {
                0
            } else {
                claims.load(Ordering::SeqCst)
            }
        );
        assert_eq!(
            cancelled.load(Ordering::SeqCst),
            usize::from(["browser failure", "cancel failure"].contains(&outcome))
        );
        if outcome == "cancel failure" {
            assert!(
                accounts.proxies.claim_exit("203.0.113.11").await.is_none(),
                "unconfirmed cleanup must quarantine the IP"
            );
        }
    }
}
#[tokio::test]
async fn enrollment_skips_an_unreadable_account_without_blocking_the_next_profile() {
    use crate::test_support::Fixture;
    use axum::{response::IntoResponse, Json};
    let enrolled = Arc::new(Mutex::new(Vec::new()));
    let login_at = api::now_ms() as f64 - 5.0 * 86_400_000.0 + 0.25;
    let saved = enrolled.clone();
    let fixture=Fixture::start(move |request| {
        let saved=saved.clone(); async move {
            match request.uri().path() {
                "/api/automations"=>Json(json!([{"_id":"automation","isActive":true,"routine":{},"modelIds":["model"]}])).into_response(),
                "/api/profiles"=>Json(json!([{"id":"bad","modelId":"model","igLoggedIn":true},{"id":"good","modelId":"model","igLoggedIn":true}])).into_response(),
                "/api/ig-accounts-store"=> {
                    let body=crate::test_support::body(request).await;
                    let value=match profiles::text(&body,"operation") {
                        "modelSetupList"=>json!([]),
                        "byProfile" if body["profileId"]=="bad"=>json!({"ciphertext":"v1.corrupt"}),
                        "byProfile"=> {
                            let mut row=serde_json::to_value(encrypt(&[0xaa;32],&parse_credentials("example:password:JBSWY3DPEHPK3PXP").unwrap()).unwrap()).unwrap(); row["_id"]=json!("a");row["status"]=json!("connected");row["browserLoggedInAt"]=json!(login_at);row
                        },
                        "modelSetupEnroll"=> {saved.lock().await.push(body);json!({"ok":true})},
                        _=>panic!("Unexpected enrollment operation")
                    };Json(value).into_response()
                },
                _=>panic!("Unexpected enrollment route")
            }
        }
    }).await;
    let root = tempfile::tempdir().unwrap();
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let profiles = Profiles::new(
        api.clone(),
        super::super::processes::Processes::new(api.clone(), root.path().into()),
        root.path().into(),
    );
    let mut accounts = Accounts::new(
        api.clone(),
        profiles,
        Content::new(root.path().join("content")),
        Subscriptions::new(api),
    );
    Arc::get_mut(&mut accounts).unwrap().credential_key = Some(vec![0xaa; 32]);
    accounts.sweep_setup().await.unwrap();
    let enrolled = enrolled.lock().await;
    assert_eq!(enrolled.len(), 1);
    assert_eq!(enrolled[0]["profileId"], "good");
    assert_eq!(enrolled[0]["startedAt"], json!(login_at.ceil() as u64));
}
