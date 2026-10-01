use super::*;
use crate::test_support::{body, Fixture};
use axum::{http::StatusCode, response::IntoResponse, Json};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

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
        vec![json!({"id":"9007199254740993","code":"one"})]
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

#[tokio::test]
async fn jobs_preserve_sources_resume_checkpoints_daily_limits_and_mobile_429s() {
    let calls = Arc::new(Mutex::new(Vec::<(String, Value)>::new()));
    let mode = Arc::new(AtomicUsize::new(0));
    let mobile_reads = Arc::new(AtomicUsize::new(0));
    let apify_reads = Arc::new(AtomicUsize::new(0));
    let liker_reads = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let m = mode.clone();
    let mr = mobile_reads.clone();
    let ar = apify_reads.clone();
    let lr = liker_reads.clone();
    let state = serde_json::to_string(&crate::instagram::new_session("profile", "source")).unwrap();
    let fixture=Fixture::start(move|request|{let calls=observed.clone();let mode=m.load(Ordering::SeqCst);let mr=mr.clone();let ar=ar.clone();let lr=lr.clone();let state=state.clone();async move{
        let path=request.uri().path().to_string();
        if path=="/api/profiles/by-id"{return Json(json!({"id":"profile","sessionId":"fixture-browser-cookie","using":false})).into_response();}
        if path=="/api/chat/session" {return Json(json!({"connected":true,"state":state,"token":"11111111-1111-4111-8111-111111111111"})).into_response();}
        if path=="/api/chat/context" {return Json(json!({"connected":true,"state":state,"token":"11111111-1111-4111-8111-111111111111","profile":{"proxy":"","proxyType":""}})).into_response();}
        if path=="/api/v1/users/search/"{
            mr.fetch_add(1,Ordering::SeqCst);
            if mode==1{return (StatusCode::BAD_GATEWAY,Json(json!({"status":"fail"}))).into_response();}
            if mode==5{return (StatusCode::TOO_MANY_REQUESTS,[("retry-after","3600")],Json(json!({"status":"fail","error_type":"secret-cookie-value"}))).into_response();}
            return Json(json!({"users":[{"pk":"123","username":"source"}]})).into_response();
        }
        if path.starts_with("/api/v1/feed/user/"){return Json(json!({"items":[{"pk":"1","code":"one","taken_at":300}],"more_available":false})).into_response();}
        if path.starts_with("/v2/actors/"){ar.fetch_add(1,Ordering::SeqCst);return Json(json!([{"id":"1","code":"one","timestamp":"2026-01-01T00:00:00Z"}])).into_response();}
        if path.contains("/likers/"){lr.fetch_add(1,Ordering::SeqCst);return Json(json!({"users":[{"pk":"11","username":"lead","is_private":false}]})).into_response();}
        let data=body(request).await;calls.lock().unwrap().push((path.clone(),data));
        if path=="/api/scraper/batch"{return Json(json!({"added":1,"processed":if mode==4{0}else{1},"limitExhausted":mode==2||mode==3||mode==4})).into_response();}
        if path=="/api/scraper/checkpoint"{return Json(json!({"limitExhausted":false})).into_response();}
        panic!("Unexpected fixture request {path}")
    }}).await;
    let mut api = Api::from_env().unwrap();
    api.convex_url = fixture.url.clone();
    api.key = "fixture".into();
    let uploads = Arc::new(crate::uploads::Uploads {
        entries: tokio::sync::Mutex::new(HashMap::new()),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    });
    let api = Arc::new(api);
    let mut mobile = Service::new(api.clone(), uploads);
    Arc::get_mut(&mut mobile).unwrap().base = Some(fixture.url.clone());
    let (work, _) = watch::channel((0, Work::default()));
    let scraper = Scraper {
        api,
        mobile,
        work,
        openrouter_key: "fixture".into(),
        apify_key: "fixture".into(),
        provider_url: Some(fixture.url.clone()),
    };
    let job = |posts| Job {
        id: "job".into(),
        username: "source".into(),
        profile_id: "profile".into(),
        run_id: "run".into(),
        since_date: 0,
        post_limit: 2,
        posts,
        post_index: None,
    };
    // Mobile source has a heartbeat before each feed request and is checkpointed as mobile.
    scraper
        .run_job(&job(None))
        .await
        .unwrap_or_else(|e| panic!("{}", e.message));
    assert_eq!(apify_reads.load(Ordering::SeqCst), 0);
    assert!(calls
        .lock()
        .unwrap()
        .iter()
        .any(|(_, v)| v["postsFromApify"] == false));
    mode.store(1, Ordering::SeqCst);
    calls.lock().unwrap().clear();
    scraper
        .run_job(&job(None))
        .await
        .unwrap_or_else(|e| panic!("{}", e.message));
    assert_eq!(apify_reads.load(Ordering::SeqCst), 1);
    assert!(calls
        .lock()
        .unwrap()
        .iter()
        .any(|(_, v)| v["postsFromApify"] == true));
    let saved = vec![json!({"id":"1","code":"one"})];
    let before = mobile_reads.load(Ordering::SeqCst);
    scraper
        .run_job(&job(Some(saved.clone())))
        .await
        .unwrap_or_else(|e| panic!("{}", e.message));
    assert_eq!(mobile_reads.load(Ordering::SeqCst), before);
    assert_eq!(apify_reads.load(Ordering::SeqCst), 1);
    mode.store(2, Ordering::SeqCst);
    calls.lock().unwrap().clear();
    let error = scraper
        .run_job(&job(Some(vec![
            saved[0].clone(),
            json!({"id":"2","code":"two"}),
        ])))
        .await
        .err()
        .unwrap();
    assert!(error.paused);
    assert!(calls
        .lock()
        .unwrap()
        .iter()
        .any(|(_, v)| v["postIndex"] == 1));
    mode.store(3, Ordering::SeqCst);
    scraper
        .run_job(&job(Some(saved.clone())))
        .await
        .unwrap_or_else(|e| panic!("{}", e.message));
    mode.store(4, Ordering::SeqCst);
    calls.lock().unwrap().clear();
    assert!(
        scraper
            .run_job(&job(Some(saved)))
            .await
            .err()
            .unwrap()
            .paused
    );
    assert!(!calls
        .lock()
        .unwrap()
        .iter()
        .any(|(_, v)| v.get("postIndex").is_some()));
    mode.store(5, Ordering::SeqCst);
    let before = liker_reads.load(Ordering::SeqCst);
    let error = scraper.run_job(&job(None)).await.err().unwrap();
    assert!(error.paused);
    assert_eq!(error.retry_after_ms, Some(3_600_000));
    assert_eq!(apify_reads.load(Ordering::SeqCst), 1);
    assert_eq!(liker_reads.load(Ordering::SeqCst), before);
    assert!(!error.message.contains("secret"));
}
