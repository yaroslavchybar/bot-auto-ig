use super::*;
use crate::test_support::{body, Fixture};
use axum::{http::StatusCode, response::IntoResponse, Json};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

fn scraper_fixture(fixture: &Fixture) -> Scraper {
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let (work, _) = watch::channel((0, Work::default()));
    Scraper {
        api,
        work,
        cache: Mutex::new(cache::Cache::open(std::path::Path::new(":memory:")).unwrap()),
        apify_key: "fixture".into(),
        provider_url: Some(fixture.url.clone()),
    }
}

fn task(run_kind: TaskKind) -> Task {
    Task {
        id: "source".into(),
        username: "source".into(),
        profile_id: "profile".into(),
        run_id: "run".into(),
        since_date: 100_000,
        post_limit: 5000,
        list_id: "list".into(),
        run_kind,
        post: Some(json!({"id":"1","code":"one"})),
    }
}

#[test]
fn source_completion_keeps_task_result_and_reports_failed_finish() {
    let job = task(TaskKind::Posts);
    for status in ["completed", "paused", "failed"] {
        let reason = (status != "completed").then_some("Original task result");
        let event = source_completion(
            &job,
            status,
            reason,
            None,
            Instant::now(),
            Some("Convex unavailable"),
        );
        assert_eq!(event["level"], "error");
        assert_eq!(event["outcome"], "error");
        assert_eq!(event["context"]["status"], status);
        assert_eq!(event["context"]["reason"], json!(reason));
        assert_eq!(event["context"]["finishError"], "Convex unavailable");
        assert_eq!(
            event["error"]["message"],
            if status == "failed" {
                reason.unwrap()
            } else {
                "Convex unavailable"
            }
        );
        assert_eq!(event["requestId"], job.run_id);
        assert!(event["context"]["newIds"].is_null());
        assert!(event["context"]["likeCount"].is_null());
    }
    let event = source_completion(
        &job,
        "paused",
        Some("Rate limited"),
        None,
        Instant::now(),
        None,
    );
    assert_eq!(event["level"], "info");
    assert_eq!(event["outcome"], "paused");
    assert!(event["error"].is_null());
}

#[test]
fn source_completion_keeps_activity_totals_even_when_finish_fails() {
    let job = task(TaskKind::Likers);
    for activity in [
        Activity {
            new_ids: 3,
            like_count: Some(200),
        },
        Activity {
            new_ids: 0,
            like_count: None,
        },
    ] {
        for finish_error in [None, Some("Convex unavailable")] {
            let event = source_completion(
                &job,
                "completed",
                None,
                Some(&activity),
                Instant::now(),
                finish_error,
            );
            assert_eq!(event["context"]["newIds"], activity.new_ids);
            assert_eq!(event["context"]["likeCount"], json!(activity.like_count));
            assert_eq!(event["context"]["finishError"], json!(finish_error));
            assert_eq!(
                event["outcome"],
                if finish_error.is_some() {
                    "error"
                } else {
                    "success"
                }
            );
        }
    }
}

#[tokio::test]
async fn own_post_likers_reuse_only_the_owners_cookie_and_keep_the_100_cap() {
    let raw_calls = Arc::new(AtomicUsize::new(0));
    let requested = raw_calls.clone();
    let fixture = Fixture::start(move |request| {
        let requested = requested.clone();
        async move {
            match request.uri().path() {
                "/api/routines/own-likers-plan" => {
                    let input = body(request).await;
                    assert_eq!(input["profileId"], "owner-profile");
                    Json(json!({"ownerIgId":"123","runId":"owner-run","date":"2026-10-12","checkedMediaIds":[]})).into_response()
                },
                "/api/profiles/by-id" => {
                    assert_eq!(request.uri().query(), Some("profileId=owner-profile"));
                    Json(json!({"instagramSessionId":"owner-cookie","cookiesJson":"[{\"name\":\"ds_user_id\",\"value\":\"123\"}]"})).into_response()
                },
                "/api/routines/own-likers-reserve" => {
                    let input = body(request).await;
                    assert_eq!(input["profileId"], "owner-profile");
                    assert_eq!(input["automationId"], "automation");
                    assert_eq!(input["runId"], "owner-run");
                    Json(json!({"allowed":true})).into_response()
                },
                "/api/v1/media/1/likers/" => {
                    requested.fetch_add(1, Ordering::SeqCst);
                    assert_eq!(request.uri().query(), Some("count=100"));
                    assert_eq!(request.headers()["cookie"], "ds_user_id=123; sessionid=owner-cookie;");
                    Json(json!({"status":"ok","users":(1..=150).map(|id|json!({"pk":id.to_string(),"username":format!("user{id}")})).collect::<Vec<_>>()})).into_response()
                },
                "/api/routines/own-likers-snapshot" => {
                    let input = body(request).await;
                    assert_eq!(input["profileId"], "owner-profile");
                    assert_eq!(input["ownerIgId"], "123");
                    assert_eq!(input["mediaId"], "1");
                    assert_eq!(input["likers"].as_array().unwrap().len(), 100);
                    Json(json!({"saved":true,"queued":2})).into_response()
                },
                "/api/routines/own-likers-finish" => Json(json!(true)).into_response(),
                path => panic!("Unexpected own-post request or scraper-pool fallback: {path}"),
            }
        }
    }).await;
    let service = scraper_fixture(&fixture);
    let input = serde_json::from_value(json!({"profileId":"owner-profile","automationId":"automation","ownerIgId":"123","posts":[{"id":"1","code":"B"}]})).unwrap();
    let result = service.scan_own_posts(&input).await.unwrap();
    assert_eq!(result["queued"], 2);
    assert_eq!(result["posts"], 1);
    assert_eq!(raw_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn own_post_likers_never_fall_back_after_an_owner_mismatch_or_quota_denial() {
    for mode in ["live-mismatch", "saved-mismatch", "quota"] {
        let fixture = Fixture::start(move |request| async move {
            match request.uri().path() {
                "/api/routines/own-likers-plan" => Json(json!({"ownerIgId":"123","runId":"run","date":"2026-10-12","checkedMediaIds":[]})).into_response(),
                "/api/profiles/by-id" if mode != "live-mismatch" => {
                    let owner = if mode == "saved-mismatch" { "456" } else { "123" };
                    Json(json!({"instagramSessionId":"owner-cookie","cookiesJson":json!([{"name":"ds_user_id","value":owner}]).to_string()})).into_response()
                },
                "/api/routines/own-likers-reserve" if mode == "quota" => Json(json!({"allowed":false,"reason":"Hourly scraper request limit reached"})).into_response(),
                path => panic!("No Instagram requests or fallback profile should be used: {path}"),
            }
        }).await;
        let service = scraper_fixture(&fixture);
        let owner = if mode == "live-mismatch" {
            "456"
        } else {
            "123"
        };
        let input = serde_json::from_value(json!({"profileId":"profile","automationId":"automation","ownerIgId":owner,"posts":[{"id":"1","code":"B"}]})).unwrap();
        assert!(service.scan_own_posts(&input).await.is_err());
    }
}

#[tokio::test]
async fn own_post_likers_resume_unchecked_posts_after_a_partial_scan() {
    let saved = Arc::new(AtomicUsize::new(0));
    let first_saved = saved.clone();
    let retry = Arc::new(AtomicUsize::new(0));
    let attempt = retry.clone();
    let finished = Arc::new(AtomicUsize::new(0));
    let completions = finished.clone();
    let fixture = Fixture::start(move |request| {
        let saved = first_saved.clone();
        let retry = attempt.clone();
        let finished = completions.clone();
        async move {
            match request.uri().path() {
                "/api/routines/own-likers-plan" => Json(json!({"ownerIgId":"123","runId":"run","date":"2026-10-12",
                    "checkedMediaIds":if saved.load(Ordering::SeqCst) > 0 {vec!["1"]} else {vec![]}})).into_response(),
                "/api/profiles/by-id" => Json(json!({"instagramSessionId":"owner-cookie","cookiesJson":"[{\"name\":\"ds_user_id\",\"value\":\"123\"}]"})).into_response(),
                "/api/routines/own-likers-reserve" => Json(json!({"allowed":saved.load(Ordering::SeqCst)==0 || retry.load(Ordering::SeqCst)>0})).into_response(),
                "/api/v1/media/1/likers/" => {
                    assert_eq!(saved.load(Ordering::SeqCst), 0, "An acknowledged post must not be fetched again");
                    Json(json!({"status":"ok","users":[]})).into_response()
                },
                "/api/v1/media/2/likers/" => Json(json!({"status":"ok","users":[]})).into_response(),
                "/api/routines/own-likers-snapshot" => {
                    saved.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"saved":true,"queued":0})).into_response()
                },
                "/api/routines/own-likers-finish" => {
                    assert_eq!(saved.load(Ordering::SeqCst), 2);
                    finished.fetch_add(1, Ordering::SeqCst);
                    Json(json!(true)).into_response()
                },
                path => panic!("Unexpected owner request: {path}"),
            }
        }
    }).await;
    let service = scraper_fixture(&fixture);
    let input = serde_json::from_value(
        json!({"profileId":"profile","automationId":"automation","ownerIgId":"123",
        "posts":[{"id":"1","code":"B"},{"id":"2","code":"C"},{"id":"2","code":"C"}]}),
    )
    .unwrap();
    assert!(service.scan_own_posts(&input).await.is_err());
    assert_eq!(saved.load(Ordering::SeqCst), 1);
    assert_eq!(finished.load(Ordering::SeqCst), 0);
    retry.store(1, Ordering::SeqCst);
    assert_eq!(service.scan_own_posts(&input).await.unwrap()["posts"], 1);
    assert_eq!(saved.load(Ordering::SeqCst), 2);
    assert_eq!(finished.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn browser_ownership_blocks_scraping_without_fallback_and_resumes_when_idle() {
    let calls = Arc::new(AtomicUsize::new(0));
    let requests = calls.clone();
    let fixture = Fixture::start(move |_| {
        let requests = requests.clone();
        async move {
            requests.fetch_add(1, Ordering::SeqCst);
            Json(json!({})).into_response()
        }
    })
    .await;
    let scraper = scraper_fixture(&fixture);
    scraper
        .update(json!({"blockedProfileIds":["profile"]}))
        .await
        .unwrap();
    for run_kind in [TaskKind::Likers] {
        let error = scraper.run_task(&task(run_kind)).await.unwrap_err();
        assert!(error.paused);
        assert!(error.message.contains("busy in the browser"));
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    scraper
        .update(json!({"blockedProfileIds":[]}))
        .await
        .unwrap();
    scraper.check_available("profile").unwrap();
}

#[tokio::test]
async fn scheduler_accepts_fractional_deadlines_and_rejects_invalid_updates_without_losing_work() {
    let fixture = Fixture::start(|_| async { Json(json!({})).into_response() }).await;
    let scraper = scraper_fixture(&fixture);
    scraper
        .update(json!({"taskAt": 2_000_000_000_000.25, "taskKey": "source"}))
        .await
        .unwrap();
    assert_eq!(scraper.work.borrow().0, 1);
    assert_eq!(scraper.work.borrow().1.task_at, Some(2_000_000_000_001));
    assert_eq!(scraper.work.borrow().1.task_key.as_deref(), Some("source"));
    for invalid in [json!(-1), json!("2000000000000"), json!(true)] {
        assert!(scraper.update(json!({"taskAt": invalid})).await.is_err());
        assert_eq!(scraper.work.borrow().0, 1);
        assert_eq!(scraper.work.borrow().1.task_at, Some(2_000_000_000_001));
    }
    for value in [json!({"taskAt": null}), json!({})] {
        scraper.update(value).await.unwrap();
        assert_eq!(scraper.work.borrow().1.task_at, None);
    }
}

#[tokio::test]
async fn post_discovery_uses_only_apify_and_preserves_range_counts_and_batches() {
    let batches = Arc::new(Mutex::new(Vec::<Value>::new()));
    let observed = batches.clone();
    let fixture=Fixture::start(move|request|{let observed=observed.clone();async move {
        let path=request.uri().path().to_owned();
        if path=="/api/scraper/posts" {let data=body(request).await;observed.lock().unwrap().push(data);return Json(json!({})).into_response();}
        assert!(path.contains("run-sync-get-dataset-items"),"Unexpected provider: {path}");
        let input=body(request).await;assert_eq!(input["resultsLimit"],5000);assert_eq!(input["username"][0],"https://www.instagram.com/source/");
        Json(json!((1..=26).map(|id|json!({"id":id.to_string(),"shortCode":format!("post{id}"),"timestamp":"2026-01-01T00:00:00Z","likesCount":100+id})).collect::<Vec<_>>())).into_response()
    }}).await;
    let scraper = scraper_fixture(&fixture);
    scraper.run_task(&task(TaskKind::Posts)).await.unwrap();
    let rows = batches.lock().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["posts"].as_array().unwrap().len(), 25);
    assert_eq!(rows[1]["posts"].as_array().unwrap().len(), 1);
    assert_eq!(rows[0]["postCount"], 26);
    assert_eq!(rows[0]["averageLikes"], 113.5);
}

#[tokio::test]
async fn liker_checks_cache_only_acknowledged_prefix_and_scope_dedupe_to_list() {
    let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
    let observed = calls.clone();
    let fixture = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            let path = request.uri().path().to_string();

            if path == "/api/profiles/by-id" {
                return Json(json!({"id":"profile","instagramSessionId":"browser-cookie"}))
                    .into_response();
            }
            if path == "/api/scraper/requests/reserve" {
                return Json(json!({"allowed":true})).into_response();
            }
            if path == "/api/scraper/heartbeat" {
                return Json(json!({})).into_response();
            }
            if path.ends_with("/info/") {
                return Json(json!({"items":[{"user":{"pk":"123"},"like_count":200}]}))
                    .into_response();
            }
            if path.ends_with("/likers/") {
                return Json(json!({"likeCount":200,"users":[
                    {"pk":"10","username":"one","is_private":false},
                    {"pk":"10","username":"one","is_private":false},
                    {"pk":"20","username":"two","is_private":false},
                    {"pk":"30","username":"private","is_private":true}
                ]}))
                .into_response();
            }
            assert_eq!(path, "/api/scraper/batch");
            let data = body(request).await;
            let length = data["likers"].as_array().unwrap().len();
            let mut calls = observed.lock().unwrap();
            let processed = if calls.is_empty() { 1 } else { length };
            calls.push(data);
            Json(json!({"processed":processed,"limitExhausted":processed < length})).into_response()
        }
    })
    .await;
    let scraper = scraper_fixture(&fixture);
    let mut job = task(TaskKind::Likers);
    let error = scraper.run_task(&job).await.unwrap_err();
    assert!(!error.paused);
    assert_eq!(error.message, "Scraper batch was not fully saved");
    assert!(scraper
        .cache
        .lock()
        .unwrap()
        .contains("list", "10")
        .unwrap());
    assert!(!scraper
        .cache
        .lock()
        .unwrap()
        .contains("list", "20")
        .unwrap());
    let activity = scraper.run_task(&job).await.unwrap().unwrap();
    assert_eq!(activity.new_ids, 3);
    assert_eq!(activity.like_count, Some(200));
    assert_eq!(calls.lock().unwrap()[1]["likers"][0]["igId"], "20");
    job.run_id = "next-check".into();
    assert_eq!(scraper.run_task(&job).await.unwrap().unwrap().new_ids, 0);
    assert_eq!(calls.lock().unwrap().len(), 2);
    job.list_id = "another-list".into();
    job.id = "another-source".into();
    assert_eq!(scraper.run_task(&job).await.unwrap().unwrap().new_ids, 3);
    assert_eq!(
        calls.lock().unwrap()[2]["likers"].as_array().unwrap().len(),
        3
    );
    job.list_id = "list".into();
    assert!(scraper
        .cache
        .lock()
        .unwrap()
        .contains("list", "30")
        .unwrap());
}

#[test]
fn acknowledged_memberships_survive_cache_reopen() {
    let dir = std::env::temp_dir().join(format!("scraper-cache-{}", uuid::Uuid::new_v4()));
    let file = dir.join("cache.sqlite");
    {
        let mut cache = cache::Cache::open(&file).unwrap();
        cache.acknowledge("list", &["10".into()]).unwrap();
        assert_eq!(
            cache
                .observe("source:post", "first", &["10".into(), "20".into()])
                .unwrap(),
            2
        );
        assert_eq!(
            cache
                .observe("source:post", "first", &["10".into(), "20".into()])
                .unwrap(),
            2
        );
    }
    {
        let mut cache = cache::Cache::open(&file).unwrap();
        assert!(cache.contains("list", "10").unwrap());
        assert!(!cache.contains("another", "10").unwrap());
        assert!(!cache.contains("list", "20").unwrap());
        assert_eq!(
            cache
                .observe(
                    "source:post",
                    "next",
                    &["10".into(), "20".into(), "30".into()]
                )
                .unwrap(),
            1
        );
        assert_eq!(
            cache
                .observe("another:post", "next", &["10".into(), "20".into()])
                .unwrap(),
            2
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn likers_use_browser_cookies_and_charge_every_attempt_without_rate_limit_bypass() {
    let mode = Arc::new(AtomicUsize::new(0));
    let current = mode.clone();
    let reads = Arc::new(AtomicUsize::new(0));
    let requested = reads.clone();
    let reservations = Arc::new(AtomicUsize::new(0));
    let charged = reservations.clone();
    let fixture=Fixture::start(move|request|{let mode=current.load(Ordering::SeqCst);let reads=requested.clone();let reservations=charged.clone();async move {
        match request.uri().path() {
            "/api/profiles/by-id"=>Json(json!({"id":"profile","instagramSessionId":"browser-cookie","paused":mode==3})).into_response(),
            "/api/scraper/requests/reserve"=>{reservations.fetch_add(1,Ordering::SeqCst);let value=body(request).await;assert_eq!(value["sourceId"],"source");assert_eq!(value["runId"],"run");Json(json!({"allowed":mode!=2,"reason":"Hourly scraper request limit reached"})).into_response()},
            "/api/v1/media/1/likers/"=>{
                reads.fetch_add(1,Ordering::SeqCst);assert_eq!(request.headers()["cookie"],"sessionid=browser-cookie;");assert!(!request.headers().contains_key("authorization"));
                if mode==1{return(StatusCode::TOO_MANY_REQUESTS,[("retry-after","42")],Json(json!({}))).into_response();}
                Json(json!({"status":"ok","users":[{"pk":"10","username":"public","is_private":false},{"pk":"20","username":"private","is_private":true}]})).into_response()
            },
            path=>panic!("Unexpected request: {path}"),
        }
    }}).await;
    let scraper = scraper_fixture(&fixture);
    let job = task(TaskKind::Likers);
    assert_eq!(
        scraper
            .likers(&job, job.post.as_ref().unwrap(), &mut None)
            .await
            .unwrap()
            .rows
            .len(),
        2
    );
    mode.store(1, Ordering::SeqCst);
    let error = scraper
        .likers(&job, job.post.as_ref().unwrap(), &mut None)
        .await
        .unwrap_err();
    assert!(error.paused);
    assert_eq!(error.retry_after_ms, Some(42000));
    mode.store(2, Ordering::SeqCst);
    assert!(
        scraper
            .likers(&job, job.post.as_ref().unwrap(), &mut None)
            .await
            .unwrap_err()
            .paused
    );
    mode.store(3, Ordering::SeqCst);
    assert!(
        scraper
            .likers(&job, job.post.as_ref().unwrap(), &mut None)
            .await
            .unwrap_err()
            .paused
    );
    assert_eq!(reads.load(Ordering::SeqCst), 2);
    assert_eq!(reservations.load(Ordering::SeqCst), 3);
}

#[test]
fn apify_and_likers_keep_lossless_ids_dates_and_private_accounts() {
    let data = json!([{"id":"9007199254740993_123","shortCode":"one","timestamp":"2026-01-01T00:00:00.000Z"},{"pk":"9007199254740993","code":"one","timestamp":"2026-01-01T00:00:00Z"},{"id":"2","shortcode":"old","timestamp":"2024-01-01T00:00:00Z"}]);
    assert_eq!(
        providers::apify_dataset(&data, 1_735_689_600_000, 5000).unwrap(),
        vec![
            json!({"id":"9007199254740993","code":"one","takenAt":1767225600000i64,"likeCount":null})
        ]
    );
    assert!(providers::apify_dataset(
        &json!([{"error":"blocked","requestErrorMessages":["429"]}]),
        0,
        10
    )
    .is_err());
    assert!(providers::apify_dataset(&json!([{"id":"1","code":"one"}]), 0, 10).is_err());
    let likers=instagram::parse_likers(&json!({"users":[{"pk":9007199254740993u64,"username":"public","is_private":false},{"pk":"2","username":"private","is_private":true},{"pk":"3","username":"unknown"}]})).unwrap();
    assert_eq!(likers.len(), 3);
    assert_eq!(likers[0]["igId"], "9007199254740993");
    assert_eq!(likers[0]["isPrivate"], false);
    assert_eq!(likers[1]["isPrivate"], true);
    assert!(likers[2].get("isPrivate").is_none());
    assert!(instagram::parse_likers(&json!({})).is_err());
    let all = instagram::parse_likers(&json!({"users":[
        {"pk":"1","username":"public","is_private":false},
        {"pk":"2","username":"private","is_private":true},
        {"pk":"3","username":"unknown"}
    ]}))
    .unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(all[1]["igId"], "2");
}
