use super::*;

#[tokio::test]
async fn native_shutdown_drains_inline_browser_logins_before_returning() {
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
    let mobile = Service::new(
        api.clone(),
        Arc::new(crate::uploads::Uploads {
            entries: Default::default(),
            slots: Arc::new(Semaphore::new(4)),
        }),
    );
    let accounts = Accounts::new(
        api.clone(),
        profiles,
        mobile,
        Content::new(root.path().join("content")),
        Subscriptions::new(api),
    );
    let job_finished = Arc::new(tokio::sync::Notify::new());
    let work = job_finished.clone();
    accounts.launch(async move { work.notified().await }).await;
    let state = accounts.clone();
    let shutdown = tokio::spawn(async move { state.shutdown().await });
    tokio::time::timeout(Duration::from_secs(5), entered.notified())
        .await
        .unwrap();
    assert!(*accounts.stop.borrow());
    job_finished.notify_one();
    tokio::task::yield_now().await;
    assert!(
        !shutdown.is_finished(),
        "Bun cleanup must acknowledge before shutdown finishes"
    );
    release.notify_one();
    tokio::time::timeout(Duration::from_secs(5), shutdown)
        .await
        .unwrap()
        .unwrap();
    assert!(accounts.jobs.lock().await.is_empty());
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
async fn model_setup_confirms_identity_and_keeps_uncertain_requests_pending() {
    use crate::test_support::Fixture;
    use axum::{response::IntoResponse, Json};
    use std::sync::atomic::{AtomicUsize, Ordering};
    for outcome in ["success", "uncertain", "save failure"] {
        let root = tempfile::tempdir().unwrap();
        let progress = Arc::new(Mutex::new(
            json!({"profileId":"p","modelId":"model","startedAt":api::now_ms()-5*86_400_000,"postSourceIds":[],"postDates":[]}),
        ));
        let attempts = Arc::new(AtomicUsize::new(0));
        let count = attempts.clone();
        let mobile=Fixture::start(move |request| {
            let count=count.clone();
            async move {
                match request.uri().path() {
                    "/api/v1/accounts/current_user/"=>Json(json!({"status":"ok","user":{"username":"example","full_name":"Example"}})).into_response(),
                    "/api/v1/accounts/edit_profile/"=> {
                        count.fetch_add(1,Ordering::SeqCst);
                        if outcome=="uncertain" { (axum::http::StatusCode::BAD_GATEWAY,Json(json!({"status":"fail","error_type":"unknown"}))).into_response() }
                        else { Json(json!({"status":"ok","user":{"username":"changed_name","full_name":"Example"}})).into_response() }
                    },
                    _=>panic!("Unexpected mobile action")
                }
            }
        }).await;
        let observed = progress.clone();
        let fixture=Fixture::start(move |request| {
            let state=observed.clone();
            async move {
                match request.uri().path() {
                    "/api/automations/by-id"=>Json(json!({"isActive":true,"routine":{},"listIds":["model"]})).into_response(),
                    "/api/profiles"=>Json(json!([{"id":"p","name":"example","proxy":"http://proxy.test:8080","igLoggedIn":true,"listIds":["model"]}])).into_response(),
                    "/api/profiles/by-id"=>Json(json!({"id":"p","name":"changed_name"})).into_response(),
                    "/api/lists"=>Json(json!([{"id":"model","usernames":["changed_name"]}])).into_response(),
                    "/api/routines/ready"=>Json(json!(true)).into_response(),
                    "/api/chat/context"=>Json(json!({"connected":true,"token":"token","state":Service::fixture_session(),"profile":{"id":"p"}})).into_response(),
                    "/api/ig-accounts-store"=> {
                        let body=crate::test_support::body(request).await;
                        let value=match profiles::text(&body,"operation") {
                            "modelSetupList"=>json!([state.lock().await.clone()]),
                            "byProfile"|"byId"=> {
                                let encrypted=encrypt(&[0xaa;32],&parse_credentials("example:password:JBSWY3DPEHPK3PXP").unwrap()).unwrap();
                                let mut value=serde_json::to_value(encrypted).unwrap();
                                value["_id"]=json!("a"); value["status"]=json!("connected"); value["profileId"]=json!("p"); value["createdAt"]=json!(1); value
                            },
                            "modelSetupPatch"=> {
                                if outcome=="save failure" && body["patch"]["nameDone"]==true { return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(); }
                                let mut state=state.lock().await;
                                for (key,value) in body["patch"].as_object().unwrap() { state[key]=value.clone(); }
                                for key in body["clear"].as_array().unwrap() { state.as_object_mut().unwrap().remove(key.as_str().unwrap()); }
                                json!({"ok":true})
                            },
                            "setUsername"=> {
                                let encrypted:Encrypted=serde_json::from_value(body).unwrap();
                                assert_eq!(decrypt(&[0xaa;32],&encrypted).unwrap().username,"changed_name"); json!({"ok":true})
                            },
                            "setState"=>json!({"ok":true}),
                            _=>panic!("Unexpected store action: {}",body)
                        }; Json(value).into_response()
                    },
                    _=>panic!("Unexpected fixture route: {}",request.uri().path())
                }
            }
        }).await;
        let mut api = Api::from_env().unwrap();
        api.convex_url = fixture.url.clone();
        api.key = "fixture".into();
        let api = Arc::new(api);
        let mobile = Service::fixture(
            api.clone(),
            Arc::new(crate::uploads::Uploads {
                entries: Default::default(),
                slots: Arc::new(Semaphore::new(4)),
            }),
            mobile.url.clone(),
        );
        let processes = super::super::processes::Processes::new(api.clone(), root.path().into());
        let profiles = Profiles::new(api.clone(), processes, root.path().into());
        let mut accounts = Accounts::new(
            api.clone(),
            profiles,
            mobile,
            Content::new(root.path().join("content")),
            Subscriptions::new(api),
        );
        Arc::get_mut(&mut accounts).unwrap().credential_key = Some(vec![0xaa; 32]);
        let result = accounts.advance_setup("p", "automation").await;
        if outcome == "save failure" {
            assert!(result.is_err());
        } else {
            result.unwrap();
        }
        let state = progress.lock().await.clone();
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        if outcome == "success" {
            assert_eq!(state["nameDone"], true);
            assert!(state["pending"].is_null());
        } else {
            assert_eq!(state["pending"]["kind"], "username");
            assert!(state["error"].is_string());
            accounts.advance_setup("p", "automation").await.unwrap();
            assert_eq!(
                attempts.load(Ordering::SeqCst),
                1,
                "uncertain requests must never be repeated automatically"
            );
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
        let fixture = Fixture::start(move |request| {
            let state = observed.clone();
            let proxies = proxies.clone();
            let claimed = claimed.clone();
            let releases = releases.clone();
            let opened = opened.clone();
            let proxy = work_proxy.clone();
            let cancellations = cancellations.clone();
            async move {
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
        let mobile = Service::new(
            api.clone(),
            Arc::new(crate::uploads::Uploads {
                entries: Default::default(),
                slots: Arc::new(Semaphore::new(4)),
            }),
        );
        let mut accounts = Accounts::new(
            api.clone(),
            profiles,
            mobile,
            Content::new(root.path().join("content")),
            Subscriptions::new(api),
        );
        let mutable = Arc::get_mut(&mut accounts).unwrap();
        mutable.credential_key = Some(vec![0xaa; 32]);
        Arc::get_mut(&mut mutable.proxies).unwrap().probe_url = "http://geo.fixture/".into();
        accounts.login("p", false).await.unwrap();
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
    let saved = enrolled.clone();
    let fixture=Fixture::start(move |request| {
        let saved=saved.clone(); async move {
            match request.uri().path() {
                "/api/automations"=>Json(json!([{"_id":"automation","isActive":true,"routine":{},"listIds":["model"]}])).into_response(),
                "/api/profiles"=>Json(json!([{"id":"bad","listIds":["model"],"igLoggedIn":true},{"id":"good","listIds":["model"],"igLoggedIn":true}])).into_response(),
                "/api/ig-accounts-store"=> {
                    let body=crate::test_support::body(request).await;
                    let value=match profiles::text(&body,"operation") {
                        "modelSetupList"=>json!([]),
                        "byProfile" if body["profileId"]=="bad"=>json!({"ciphertext":"v1.corrupt"}),
                        "byProfile"=> {
                            let mut row=serde_json::to_value(encrypt(&[0xaa;32],&parse_credentials("example:password:JBSWY3DPEHPK3PXP").unwrap()).unwrap()).unwrap(); row["_id"]=json!("a");row["status"]=json!("connected");row
                        },
                        "modelSetupEnroll"=> {saved.lock().await.push(body["profileId"].clone());json!({"ok":true})},
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
    let mobile = Service::new(
        api.clone(),
        Arc::new(crate::uploads::Uploads {
            entries: Default::default(),
            slots: Arc::new(Semaphore::new(4)),
        }),
    );
    let mut accounts = Accounts::new(
        api.clone(),
        profiles,
        mobile,
        Content::new(root.path().join("content")),
        Subscriptions::new(api),
    );
    Arc::get_mut(&mut accounts).unwrap().credential_key = Some(vec![0xaa; 32]);
    accounts.sweep_setup().await.unwrap();
    assert_eq!(*enrolled.lock().await, vec![json!("good")]);
}
