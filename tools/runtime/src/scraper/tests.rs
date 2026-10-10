use super::*;
use crate::test_support::{body, Fixture};
use axum::{http::StatusCode, response::IntoResponse, Json};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

fn scraper_fixture(fixture: &Fixture) -> Scraper {
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let uploads = Arc::new(crate::uploads::Uploads {
        entries: tokio::sync::Mutex::new(HashMap::new()),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    });
    let mobile = Service::fixture(api.clone(), uploads, fixture.url.clone());
    let (work, _) = watch::channel((0, Work::default()));
    Scraper {
        api,
        mobile,
        work,
        cache: Mutex::new(cache::Cache::open(std::path::Path::new(":memory:")).unwrap()),
        openrouter_key: String::new(),
        apify_key: "fixture".into(),
        provider_url: Some(fixture.url.clone()),
    }
}

fn task(kind: TaskKind) -> Task {
    Task {
        id: "source".into(),
        username: "source".into(),
        profile_id: "profile".into(),
        run_id: "run".into(),
        since_date: 100_000,
        post_limit: 5000,
        list_id: "list".into(),
        kind,
        post: Some(json!({"id":"1","code":"one"})),
    }
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
async fn source_discovery_preserves_range_counts_batches_and_rate_limits() {
    let mode = Arc::new(AtomicUsize::new(0));
    let batches = Arc::new(Mutex::new(Vec::<Value>::new()));
    let apify_reads = Arc::new(AtomicUsize::new(0));
    let m = mode.clone();
    let b = batches.clone();
    let a = apify_reads.clone();
    let fixture = Fixture::start(move |request| {
        let m = m.clone(); let b = b.clone(); let a = a.clone();
        async move {
            let path = request.uri().path().to_string();
            if path == "/api/chat/context" {
                return Json(json!({"connected":true,"state":Service::fixture_session(),"token":"11111111-1111-4111-8111-111111111111","profile":{"proxy":"","proxyType":""}})).into_response();
            }
            if path == "/api/scraper/heartbeat" { return Json(json!({})).into_response(); }
            if path == "/api/scraper/posts" {
                let data = body(request).await;
                b.lock().unwrap().push(data);
                return Json(json!({})).into_response();
            }
            if path.contains("run-sync-get-dataset-items") {
                a.fetch_add(1, Ordering::SeqCst);
                let input = body(request).await;
                assert_eq!(input["resultsLimit"], 5000);
                return Json(json!([{"id":"77","shortCode":"fallback","timestamp":"2026-01-01T00:00:00Z","likesCount":123}])).into_response();
            }
            if path.ends_with("users/search/") {
                return Json(json!({"users":[{"pk":"123","username":"source"}]})).into_response();
            }
            assert!(path.ends_with("/feed/user/123/"), "Unexpected {path}");
            match m.load(Ordering::SeqCst) {
                2 => (StatusCode::BAD_GATEWAY, Json(json!({"status":"fail"}))).into_response(),
                3 => (StatusCode::TOO_MANY_REQUESTS, Json(json!({"status":"fail"}))).into_response(),
                mode => Json(json!({"items":(1..=26).map(|id| {
                    let mut post = json!({"pk":id.to_string(),"code":format!("post{id}"),"taken_at":300,"like_count":100 + id});
                    if mode == 1 && id == 26 { post.as_object_mut().unwrap().remove("like_count"); }
                    post
                }).chain([json!({"pk":"99","code":"old","taken_at":10,"like_count":10000})]).collect::<Vec<_>>(),"more_available":false})).into_response(),
            }
        }
    }).await;
    let scraper = scraper_fixture(&fixture);
    for (mode_value, expected_average) in [(0, json!(113.5)), (1, Value::Null)] {
        mode.store(mode_value, Ordering::SeqCst);
        scraper.run_task(&task(TaskKind::Posts)).await.unwrap();
        let rows = std::mem::take(&mut *batches.lock().unwrap());
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["posts"].as_array().unwrap().len(), 25);
        assert_eq!(rows[1]["posts"].as_array().unwrap().len(), 1);
        assert_eq!(rows[0]["postCount"], 26);
        assert_eq!(rows[0]["averageLikes"], expected_average);
        assert_eq!(rows[0]["posts"][0]["takenAt"], 300000);
        assert_eq!(rows[0]["postsFromApify"], false);
    }
    mode.store(2, Ordering::SeqCst);
    scraper.run_task(&task(TaskKind::Posts)).await.unwrap();
    assert_eq!(batches.lock().unwrap()[0]["postsFromApify"], true);
    assert_eq!(batches.lock().unwrap()[0]["averageLikes"], 123.0);
    mode.store(3, Ordering::SeqCst);
    assert!(
        scraper
            .run_task(&task(TaskKind::Posts))
            .await
            .unwrap_err()
            .paused
    );
    assert_eq!(apify_reads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn liker_checks_cache_only_acknowledged_prefix_and_scope_dedupe_to_list() {
    let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
    let observed = calls.clone();
    let fixture = Fixture::start(move |request| {
        let observed = observed.clone();
        async move {
            let path = request.uri().path().to_string();
            if path == "/api/chat/context" {
                return Json(json!({"connected":true,"state":Service::fixture_session(),"token":"11111111-1111-4111-8111-111111111111","profile":{"proxy":"","proxyType":""}})).into_response();
            }
            if path == "/api/scraper/heartbeat" { return Json(json!({})).into_response(); }
            if path.ends_with("/info/") { return Json(json!({"items":[{"user":{"pk":"123"},"like_count":200}]})).into_response(); }
            if path.ends_with("/likers/") {
                return Json(json!({"users":[
                    {"pk":"10","username":"one","is_private":false},
                    {"pk":"10","username":"one","is_private":false},
                    {"pk":"20","username":"two","is_private":false},
                    {"pk":"30","username":"private","is_private":true}
                ]})).into_response();
            }
            assert_eq!(path, "/api/scraper/batch");
            let data = body(request).await;
            let length = data["likers"].as_array().unwrap().len();
            let mut calls = observed.lock().unwrap();
            let processed = if calls.is_empty() { 1 } else { length };
            calls.push(data);
            Json(json!({"processed":processed,"limitExhausted":processed < length})).into_response()
        }
    }).await;
    let scraper = scraper_fixture(&fixture);
    let mut job = task(TaskKind::Likers);
    assert!(scraper.run_task(&job).await.unwrap_err().paused);
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
    assert_eq!(activity.new_ids, 3); // Private IDs describe traffic but never become leads.
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
        2
    );
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
async fn likers_use_mobile_first_and_cookie_fallback_without_bypassing_rate_limits() {
    let mode = Arc::new(AtomicUsize::new(0));
    let mobile_reads = Arc::new(AtomicUsize::new(0));
    let web_reads = Arc::new(AtomicUsize::new(0));
    let profile_reads = Arc::new(AtomicUsize::new(0));
    let m = mode.clone();
    let mr = mobile_reads.clone();
    let wr = web_reads.clone();
    let pr = profile_reads.clone();
    let fixture = Fixture::start(move |request| {
        let mode = m.load(Ordering::SeqCst);
        let mr = mr.clone();
        let wr = wr.clone();
        let pr = pr.clone();
        async move {
            let path = request.uri().path();
            if path == "/api/chat/context" {
                return Json(json!({"connected":mode != 5,"state":Service::fixture_session(),"token":"11111111-1111-4111-8111-111111111111","profile":{"proxy":"","proxyType":""}})).into_response();
            }
            if path == "/api/profiles/by-id" {
                pr.fetch_add(1, Ordering::SeqCst);
                return Json(json!({"id":"profile","sessionId":"browser-cookie"})).into_response();
            }
            if path.ends_with("/info/") {
                return Json(json!({"items":[{"user":{"pk":"123"}}]})).into_response();
            }
            assert!(path.ends_with("/likers/"), "Unexpected path: {path}");
            let mobile = request.headers().contains_key("authorization");
            if mobile {
                mr.fetch_add(1, Ordering::SeqCst);
                assert_eq!(request.headers()["authorization"], "Bearer fixture");
                assert_eq!(path, "/api/v1/media/1_123/likers/");
                assert!(request.uri().query().is_none());
                if mode == 1 || mode == 6 {
                    return (StatusCode::BAD_GATEWAY, Json(json!({"status":"fail"}))).into_response();
                }
                if mode == 2 {
                    return Json(json!({"status":"ok"})).into_response();
                }
                if mode == 3 {
                    return (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "42")], Json(json!({"status":"fail"}))).into_response();
                }
                if mode == 4 {
                    return Json(json!({"status":"ok","users":[]})).into_response();
                }
            } else {
                wr.fetch_add(1, Ordering::SeqCst);
                assert_eq!(request.headers()["cookie"], "sessionid=browser-cookie;");
                assert_eq!(path, "/api/v1/media/1/likers/");
                if mode == 6 {
                    return (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "60")], Json(json!({"status":"fail"}))).into_response();
                }
            }
            Json(json!({"status":"ok","users":[
                {"pk":9007199254740993u64,"username":"public","is_private":false},
                {"pk":"12","username":"private","is_private":true},
                {"pk":"13","username":"unknown"},
            ]})).into_response()
        }
    }).await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let api = Arc::new(api);
    let uploads = Arc::new(crate::uploads::Uploads {
        entries: tokio::sync::Mutex::new(HashMap::new()),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    });
    let mobile = Service::fixture(api.clone(), uploads, fixture.url.clone());
    let (work, _) = watch::channel((0, Work::default()));
    let scraper = Scraper {
        api,
        mobile,
        work,
        cache: Mutex::new(cache::Cache::open(std::path::Path::new(":memory:")).unwrap()),
        openrouter_key: "fixture".into(),
        apify_key: "fixture".into(),
        provider_url: Some(fixture.url.clone()),
    };
    let job = Task {
        id: "job".into(),
        username: "source".into(),
        profile_id: "profile".into(),
        run_id: "run".into(),
        since_date: 0,
        post_limit: 1,
        list_id: "list".into(),
        kind: TaskKind::Likers,
        post: None,
    };
    let post = json!({"id":"1","code":"one"});
    let mut fallback = None;
    let rows = scraper
        .likers(&job, &post, &mut fallback)
        .await
        .unwrap()
        .rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["igId"], "9007199254740993");
    assert_eq!(profile_reads.load(Ordering::SeqCst), 0);
    assert_eq!(web_reads.load(Ordering::SeqCst), 0);
    assert!(fallback.is_none());

    for failure in [1, 2] {
        mode.store(failure, Ordering::SeqCst);
        let mut fallback = None;
        assert_eq!(
            scraper
                .likers(&job, &post, &mut fallback)
                .await
                .unwrap()
                .rows
                .len(),
            1
        );
        // Reuse browser cookies within this job, not an extra Convex read per post.
        assert_eq!(
            scraper
                .likers(&job, &post, &mut fallback)
                .await
                .unwrap()
                .rows
                .len(),
            1
        );
    }
    assert_eq!(profile_reads.load(Ordering::SeqCst), 2);
    assert_eq!(web_reads.load(Ordering::SeqCst), 4);

    mode.store(3, Ordering::SeqCst);
    let error = scraper
        .likers(&job, &post, &mut fallback)
        .await
        .unwrap_err();
    assert!(error.paused);
    assert_eq!(error.retry_after_ms, Some(42_000));
    assert_eq!(web_reads.load(Ordering::SeqCst), 4);
    assert!(fallback.is_none());

    mode.store(4, Ordering::SeqCst);
    assert!(scraper
        .likers(&job, &post, &mut fallback)
        .await
        .unwrap()
        .rows
        .is_empty());
    assert_eq!(web_reads.load(Ordering::SeqCst), 4);

    mode.store(5, Ordering::SeqCst);
    let reads = mobile_reads.load(Ordering::SeqCst);
    assert_eq!(
        scraper
            .likers(&job, &post, &mut fallback)
            .await
            .unwrap()
            .rows
            .len(),
        1
    );
    assert_eq!(mobile_reads.load(Ordering::SeqCst), reads);
    assert_eq!(web_reads.load(Ordering::SeqCst), 5);

    mode.store(6, Ordering::SeqCst);
    let error = scraper
        .likers(&job, &post, &mut fallback)
        .await
        .unwrap_err();
    assert!(error.paused);
    assert_eq!(error.retry_after_ms, Some(60_000));
}

#[test]
fn classification_and_picture_validation_keep_existing_contract() {
    assert_eq!(providers::classification(&json!({"answers":{"account_type":{"type":"choice","choice":"male","probabilities":{"male":0.1,"female":0.2,"business":0.7}}}})).unwrap(),"business");
    assert_eq!(
        providers::classification(
            &json!({"answers":{"account_type":{"type":"choice","choice":"female"}}})
        )
        .unwrap(),
        "female"
    );
    assert!(providers::classification(
        &json!({"answers":{"account_type":{"type":"choice","choice":"other"}}})
    )
    .is_err());
    assert_eq!(providers::classification(&json!({"answers":{"account_type":{"type":"choice","probabilities":{"male":0.3,"female":0.3,"business":0.3}}}})).unwrap(),"male");
    assert!(providers::picture_url("https://scontent.cdninstagram.com/image").is_some());
    for url in [
        "http://cdninstagram.com/image",
        "https://cdninstagram.com.attacker.test/image",
        "https://attacker.test/image",
        "https://user:pass@instagram.com/image",
    ] {
        assert!(providers::picture_url(url).is_none());
    }
}
#[test]
fn apify_and_likers_keep_lossless_ids_dates_deduplication_and_public_filter() {
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
    assert_eq!(likers.len(), 1);
    assert_eq!(likers[0]["igId"], "9007199254740993");
    assert!(instagram::parse_likers(&json!({})).is_err());
}
