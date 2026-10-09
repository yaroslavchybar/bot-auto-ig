use super::*;
use super::{cache::Cache, model::*};
use crate::test_support::{body, Fixture};
use axum::{body::Body, http::Request as HttpRequest};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

fn message(id: &str, timestamp: f64, sender: &str) -> Message {
    Message {
        id: id.into(),
        timestamp,
        sender_id: sender.into(),
        text: id.into(),
        kind: "text".into(),
        ..Default::default()
    }
}
fn thread(messages: Vec<Message>, id: &str) -> Thread {
    Thread {
        id: id.into(),
        title: "Friend".into(),
        messages,
        ..Default::default()
    }
}
fn setup() -> Cache {
    let mut cache = Cache::open(std::path::Path::new(":memory:")).unwrap();
    cache.connect("one", "token", "viewer").unwrap();
    cache
}

#[tokio::test]
async fn badge_publication_tracks_unread_ids_even_when_the_total_is_unchanged() {
    let publications = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let stored = publications.clone();
    let fixture = Fixture::start(move |request| {
        let stored = stored.clone();
        async move {
            assert_eq!(request.uri().path(), "/api/chat/count");
            let data = body(request).await;
            stored.lock().unwrap().push(data);
            Json(json!({"saved": true})).into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.key = "fixture".into();
    api.convex_url = fixture.url.clone();
    let api = Arc::new(api);
    let uploads = Arc::new(crate::uploads::Uploads {
        entries: Default::default(),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    });
    let mobile = Mobile::fixture(api.clone(), uploads, fixture.url.clone());
    let chat = Chat::new(api, mobile, Path::new(":memory:")).unwrap();
    let mut entry = Entry {
        token: "token".into(),
        ..Default::default()
    };
    chat.db(|db| {
        db.connect("p", "token", "viewer")?;
        db.save_inbox(
            "p",
            "token",
            "viewer",
            vec![thread(vec![message("1", 100.0, "other")], "123")],
            false,
        )?;
        Ok(())
    })
    .await
    .unwrap();
    chat.publish("p", &mut entry).await.unwrap();
    chat.publish("p", &mut entry).await.unwrap();
    assert_eq!(publications.lock().unwrap().len(), 1);
    assert_eq!(
        publications.lock().unwrap()[0],
        json!({"profileId":"p", "token":"token", "unreadThreadIds":["123"]})
    );
    chat.db(|db| {
        db.save_thread(
            "p",
            "token",
            thread(vec![message("2", 200.0, "viewer")], "123"),
            200,
        )?;
        db.save_inbox(
            "p",
            "token",
            "viewer",
            vec![thread(vec![message("3", 300.0, "other")], "456")],
            false,
        )?;
        Ok(())
    })
    .await
    .unwrap();
    chat.publish("p", &mut entry).await.unwrap();
    assert_eq!(publications.lock().unwrap().len(), 2);
    assert_eq!(
        publications.lock().unwrap()[1]["unreadThreadIds"],
        json!(["456"])
    );
    chat.db(|db| {
        db.save_thread(
            "p",
            "token",
            thread(vec![message("4", 400.0, "viewer")], "456"),
            400,
        )?;
        Ok(())
    })
    .await
    .unwrap();
    chat.publish("p", &mut entry).await.unwrap();
    assert_eq!(
        publications.lock().unwrap()[2]["unreadThreadIds"],
        json!([])
    );
}

#[test]
fn picture_sources_persist_with_messages_and_remain_scoped_to_the_profile() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("cache.sqlite");
    let mut cache = Cache::open(&file).unwrap();
    cache.connect("one", "token", "viewer").unwrap();
    cache.connect("two", "token", "viewer").unwrap();
    assert!(cache.needs_picture_urls("one").unwrap());
    let mut item = thread(vec![], "123");
    item.users.push(User {
        id: "42".into(),
        username: "friend".into(),
        profile_pic_url: Some("https://scontent.cdninstagram.com/first.jpg".into()),
    });
    cache
        .save_inbox("one", "token", "viewer", vec![item.clone()], false)
        .unwrap();
    assert!(!cache.needs_picture_urls("one").unwrap());
    assert!(cache.picture_url("two", "42").unwrap().is_none());
    drop(cache);
    let mut cache = Cache::open(&file).unwrap();
    assert_eq!(
        cache.picture_url("one", "42").unwrap().as_deref(),
        Some("https://scontent.cdninstagram.com/first.jpg")
    );
    item.users[0].profile_pic_url = Some("https://scontent.cdninstagram.com/new.jpg".into());
    cache
        .save_inbox("one", "token", "viewer", vec![item], false)
        .unwrap();
    assert_eq!(
        cache.picture_url("one", "42").unwrap().as_deref(),
        Some("https://scontent.cdninstagram.com/new.jpg")
    );
    cache.clear("one").unwrap();
    assert!(cache.picture_url("one", "42").unwrap().is_none());
}

#[test]
fn untrusted_picture_urls_are_not_retained_in_chat_users() {
    for url in [
        "http://cdninstagram.com/a",
        "https://cdninstagram.com.evil.test/a",
        "https://127.0.0.1/a",
        "https://user:password@cdninstagram.com/a",
        "https://cdninstagram.com:444/a",
    ] {
        let raw = json!({"thread_id":"1","users":[{"pk":"42","username":"friend","profile_pic_url":url}]});
        assert!(model::thread(&raw, true).users[0].profile_pic_url.is_none());
    }
}

#[tokio::test]
async fn archives_use_convex_without_a_mobile_session_and_notify_only_after_success() {
    let archived = Arc::new(std::sync::Mutex::new(false));
    let stored = archived.clone();
    let fixture = Fixture::start(move |request| {
        let stored = stored.clone();
        async move {
            assert_eq!(request.headers()["authorization"], "Bearer fixture");
            match request.uri().path() {
                "/api/profiles/by-id" => Json(json!({"id":"p","igLoggedIn":false})).into_response(),
                "/api/chat/archives" => {
                    if request.method() == Method::POST {
                        let data = body(request).await;
                        assert_eq!(data["profileId"], "p");
                        if data["threadId"] == "999" {
                            return StatusCode::SERVICE_UNAVAILABLE.into_response();
                        }
                        assert_eq!(data["threadId"], "123");
                        *stored.lock().unwrap() = data["archived"].as_bool().unwrap();
                    }
                    Json(if *stored.lock().unwrap() {
                        json!([{"profileId":"p","threadId":"123"}])
                    } else {
                        json!([])
                    })
                    .into_response()
                }
                path => panic!("Archive operation unexpectedly requested {path}"),
            }
        }
    })
    .await;
    let mobile_calls = Arc::new(AtomicUsize::new(0));
    let calls = mobile_calls.clone();
    let mobile_fixture = Fixture::start(move |_| {
        let calls = calls.clone();
        async move {
            calls.fetch_add(1, Ordering::Relaxed);
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.key = "fixture".into();
    api.convex_url = fixture.url.clone();
    let api = Arc::new(api);
    let mut events = api.events.subscribe();
    let uploads = Arc::new(crate::uploads::Uploads {
        entries: Default::default(),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    });
    let mobile = Mobile::fixture(api.clone(), uploads, mobile_fixture.url.clone());
    let chat = Chat::new(api, mobile, Path::new(":memory:")).unwrap();
    let params = HashMap::from([("profileId".into(), "p".into())]);
    for archived in [true, false] {
        let request = HttpRequest::builder()
            .method("POST")
            .body(Body::from(
                json!({"threadId":"123","archived":archived}).to_string(),
            ))
            .unwrap();
        let response = chat
            .public("chat.post.profileId_archive", &params, request)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            events.try_recv().unwrap(),
            json!({
                "type":"chat_changed","profileId":"p","threadId":"123","archivesChanged":true
            })
        );
        let response = chat
            .public(
                "chat.get.archives",
                &HashMap::new(),
                HttpRequest::builder().body(Body::empty()).unwrap(),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let data: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(
            data,
            if archived {
                json!([{"profileId":"p","threadId":"123"}])
            } else {
                json!([])
            }
        );
    }
    for data in [
        json!({"threadId":"bad","archived":true}),
        json!({"threadId":"123","archived":"true"}),
    ] {
        let response = chat
            .public(
                "chat.post.profileId_archive",
                &params,
                HttpRequest::builder()
                    .method("POST")
                    .body(Body::from(data.to_string()))
                    .unwrap(),
            )
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let response = chat
        .public(
            "chat.post.profileId_archive",
            &params,
            HttpRequest::builder()
                .method("POST")
                .body(Body::from(
                    json!({"threadId":"999","archived":true}).to_string(),
                ))
                .unwrap(),
        )
        .await;
    assert!(!response.status().is_success());
    assert!(events.try_recv().is_err());
    assert_eq!(mobile_calls.load(Ordering::Relaxed), 0);
}
fn save(cache: &mut Cache, items: Vec<Message>) -> Thread {
    cache
        .save_thread(
            "one",
            "token",
            thread(items, "123"),
            crate::api::now_ms() + 1,
        )
        .unwrap()
}

#[test]
fn cache_survives_restart_and_session_replacement_isolates_messages() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("cache.sqlite");
    let mut cache = Cache::open(&file).unwrap();
    cache.connect("one", "token", "viewer").unwrap();
    cache
        .save_inbox(
            "one",
            "token",
            "viewer",
            vec![thread(vec![message("1", 100.0, "friend")], "123")],
            false,
        )
        .unwrap();
    save(&mut cache, vec![message("1", 100.0, "friend")]);
    drop(cache);
    let mut cache = Cache::open(&file).unwrap();
    assert_eq!(cache.inbox("one").unwrap().threads[0].messages[0].id, "1");
    assert_eq!(
        cache
            .thread("one", "123")
            .unwrap()
            .unwrap()
            .confirmed_message_ids
            .unwrap(),
        ["1"]
    );
    cache.connect("one", "replacement", "viewer").unwrap();
    assert!(cache.thread("one", "123").unwrap().is_none());
    assert!(cache
        .save_thread("one", "token", thread(vec![], "123"), 0)
        .is_err());
    cache.retain(&[]).unwrap();
    assert!(!cache.inbox("one").unwrap().connected);
}

#[test]
fn receipts_do_not_answer_chats_and_unsent_replies_restore_unanswered_state() {
    let mut cache = setup();
    let incoming = message("1", 100.0, "friend");
    cache
        .save_inbox(
            "one",
            "token",
            "viewer",
            vec![thread(vec![incoming.clone()], "123")],
            false,
        )
        .unwrap();
    let mut read = thread(vec![incoming.clone()], "123");
    read.last_seen_at.push(Seen {
        user_id: "viewer".into(),
        timestamp: 200.0,
    });
    cache.save_thread("one", "token", read, 0).unwrap();
    assert_eq!(cache.unread_thread_ids("one").unwrap().len(), 1);
    let items = vec![message("2", 200.0, "viewer"), incoming];
    save(&mut cache, items.clone());
    assert_eq!(cache.unread_thread_ids("one").unwrap().len(), 0);
    cache.unsend("one", "token", "123", "2").unwrap();
    assert_eq!(cache.unread_thread_ids("one").unwrap().len(), 1);
    assert_eq!(
        save(&mut cache, items)
            .messages
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>(),
        ["1"]
    );
    assert_eq!(cache.unread_thread_ids("one").unwrap().len(), 1);
}

#[test]
fn unread_sync_retains_other_chats_and_previews_are_not_confirmations() {
    let mut cache = setup();
    cache
        .save_inbox(
            "one",
            "token",
            "viewer",
            vec![
                thread(vec![message("1", 100.0, "friend")], "123"),
                thread(vec![], "456"),
            ],
            false,
        )
        .unwrap();
    assert!(cache
        .thread("one", "123")
        .unwrap()
        .unwrap()
        .confirmed_message_ids
        .is_none());
    cache
        .save_inbox("one", "token", "viewer", vec![], true)
        .unwrap();
    assert_eq!(cache.inbox("one").unwrap().threads.len(), 2);
    assert_eq!(cache.unread_thread_ids("one").unwrap().len(), 1);
}

#[test]
fn concurrent_newer_previews_keep_media_and_reactions_until_a_fresh_thread_fetch() {
    let mut cache = setup();
    let mut newer = message("2", 200.0, "friend");
    newer.media_type = Some("photo".into());
    newer.media_url = Some("https://example.com/image".into());
    newer.reactions.push(Reaction {
        sender_id: "viewer".into(),
        emoji: "❤️".into(),
    });
    let fetched = crate::api::now_ms() - 1;
    cache
        .save_inbox(
            "one",
            "token",
            "viewer",
            vec![thread(vec![newer.clone()], "123")],
            false,
        )
        .unwrap();
    let saved = cache
        .save_thread(
            "one",
            "token",
            thread(vec![message("1", 100.0, "friend")], "123"),
            fetched,
        )
        .unwrap();
    assert_eq!(saved.messages[0], newer);
    assert_eq!(saved.messages.len(), 2);
    let saved = cache
        .save_thread(
            "one",
            "token",
            thread(vec![message("2", 200.0, "friend")], "123"),
            fetched,
        )
        .unwrap();
    assert_eq!(saved.messages[0], newer);
    let saved = save(&mut cache, vec![message("1", 100.0, "friend")]);
    assert_eq!(saved.messages.len(), 1);
    assert_eq!(saved.messages[0].id, "1");
}

#[test]
fn unsend_reaches_both_connected_sides_and_stale_sync_cannot_restore_it() {
    let mut cache = setup();
    cache.connect("two", "other", "friend").unwrap();
    let items = vec![message("2", 200.0, "viewer"), message("1", 100.0, "friend")];
    for (id, token, viewer) in [("one", "token", "viewer"), ("two", "other", "friend")] {
        cache
            .save_inbox(
                id,
                token,
                viewer,
                vec![thread(items[..1].to_vec(), "123")],
                false,
            )
            .unwrap();
        cache
            .save_thread(
                id,
                token,
                thread(items.clone(), "123"),
                crate::api::now_ms() + 1,
            )
            .unwrap();
    }
    let mut affected = cache.unsend("one", "token", "123", "2").unwrap();
    affected.sort();
    assert_eq!(affected, ["one", "two"]);
    for (id, token, viewer) in [("one", "token", "viewer"), ("two", "other", "friend")] {
        cache
            .save_inbox(
                id,
                token,
                viewer,
                vec![thread(items[..1].to_vec(), "123")],
                false,
            )
            .unwrap();
        let saved = cache
            .save_thread(
                id,
                token,
                thread(items.clone(), "123"),
                crate::api::now_ms() + 1,
            )
            .unwrap();
        assert_eq!(
            saved
                .messages
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>(),
            ["1"]
        );
    }
}

#[test]
fn parses_preview_order_receipts_reactions_and_only_https_media() {
    let raw = json!({"thread_id":"123", "users":[{"pk":42,"username":"friend","profile_pic_url":"https://scontent.cdninstagram.com/avatar.jpg"}], "last_seen_at":{"42":{"timestamp":"200000"}},
        "items":[{"item_id":"1", "timestamp":"100000", "user_id":42}, {"item_id":"2", "timestamp":200000,
        "item_type":"voice_media", "voice_media":{"media":{"audio":{"audio_src":"https://example.com/voice"}}}, "reactions":{"emojis":[{"sender_id":1,"emoji":"❤️"}]}}]});
    let parsed = super::model::thread(&raw, true);
    assert_eq!(parsed.title, "friend");
    assert_eq!(
        parsed.users[0].profile_pic_url.as_deref(),
        Some("https://scontent.cdninstagram.com/avatar.jpg")
    );
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["users"][0]["profilePicUrl"],
        "https://scontent.cdninstagram.com/avatar.jpg"
    );
    assert_eq!(parsed.messages.len(), 1);
    assert_eq!(parsed.messages[0].id, "2");
    assert_eq!(parsed.messages[0].timestamp, 200.0);
    assert_eq!(parsed.last_seen_at[0].timestamp, 200.0);
    assert_eq!(parsed.messages[0].media_type.as_deref(), Some("voice"));
    assert_eq!(parsed.messages[0].reactions[0].sender_id, "1");
    assert!(super::model::message(&json!({"item_type":"photo", "media":{"image_versions2":{"candidates":[{"url":"http://example.com/image"}]}}})).media_url.is_none());
}

#[tokio::test]
async fn pruning_preserves_active_sessions_and_load_repairs_missing_storage() {
    let state = Mobile::fixture_session();
    let fixture = Fixture::start(move |request| {
        let state = state.clone();
        async move {
            assert_eq!(request.uri().path(), "/api/chat/context");
            Json(json!({"connected":true,"token":"token","state":state})).into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.key = "fixture".into();
    api.convex_url = fixture.url.clone();
    let api = Arc::new(api);
    let mobile = Mobile::new(
        api.clone(),
        Arc::new(crate::uploads::Uploads {
            entries: Default::default(),
            slots: Arc::new(tokio::sync::Semaphore::new(4)),
        }),
    );
    let root = tempfile::tempdir().unwrap();
    let chat = Chat::new(api, mobile, &root.path().join("cache.sqlite")).unwrap();
    let lock = chat.entry("p").await.unwrap();
    let mut entry = lock.lock().await;
    chat.load("p", &mut entry).await.unwrap();
    let cached = chat
        .db(|db| {
            db.save_inbox(
                "p",
                "token",
                "123",
                vec![thread(vec![message("1", 100.0, "friend")], "123")],
                false,
            )
        })
        .await
        .unwrap();
    entry.inbox = Some(cached.clone());
    entry.checked = 42;
    chat.load("p", &mut entry).await.unwrap();
    assert_eq!(entry.inbox, Some(cached.clone()));
    assert_eq!(
        entry.checked, 42,
        "An unchanged binding must preserve freshness"
    );

    // The request still owns this entry while membership cleanup runs.
    chat.retain(vec![]).await.unwrap();
    assert_eq!(chat.db(|db| db.inbox("p")).await.unwrap(), cached);
    assert!(Arc::ptr_eq(&lock, &chat.entry("p").await.unwrap()));
    chat.retain(vec!["p".into()]).await.unwrap();
    chat.load("p", &mut entry).await.unwrap();
    assert_eq!(entry.inbox, Some(cached));

    // A missing SQL binding must be repaired even if the mobile token is unchanged.
    chat.db(|db| db.clear("p")).await.unwrap();
    chat.load("p", &mut entry).await.unwrap();
    assert!(entry.inbox.is_none());
    assert_eq!(entry.checked, 0);
    assert_eq!(entry.token, "token");
    chat.db(|db| {
        db.save_thread(
            "p",
            "token",
            thread(vec![message("2", 200.0, "friend")], "123"),
            crate::api::now_ms(),
        )
    })
    .await
    .unwrap();

    drop(entry);
    drop(lock);
    chat.retain(vec![]).await.unwrap();
    assert!(!chat.profiles.lock().await.contains_key("p"));
    assert!(!chat.db(|db| db.inbox("p")).await.unwrap().connected);
}

#[tokio::test]
async fn disconnected_checks_are_throttled_force_and_clear_invalidate() {
    let loads = Arc::new(AtomicUsize::new(0));
    let observed = loads.clone();
    let fixture = Fixture::start(move |_| {
        let observed = observed.clone();
        async move {
            observed.fetch_add(1, Ordering::Relaxed);
            Json(json!({"connected":false})).into_response()
        }
    })
    .await;
    let mut api = Api::from_env().unwrap();
    api.key = "fixture".into();
    api.convex_url = fixture.url.clone();
    let api = Arc::new(api);
    let uploads = Arc::new(crate::uploads::Uploads {
        entries: Default::default(),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    });
    let mobile = Mobile::new(api.clone(), uploads);
    let directory = tempfile::tempdir().unwrap();
    let chat = Chat::new(api, mobile, &directory.path().join("cache.sqlite")).unwrap();
    assert!(!chat.inbox("p", false).await.unwrap().connected);
    assert!(!chat.inbox("p", false).await.unwrap().connected);
    assert_eq!(loads.load(Ordering::Relaxed), 1);
    chat.entry("p").await.unwrap().lock().await.checked = crate::api::now_ms() - 60_001;
    chat.inbox("p", false).await.unwrap();
    chat.inbox("p", true).await.unwrap();
    assert_eq!(loads.load(Ordering::Relaxed), 3);
    chat.clear("p").await.unwrap();
    chat.inbox("p", false).await.unwrap();
    assert_eq!(loads.load(Ordering::Relaxed), 4);
}

#[tokio::test]
async fn sent_message_stays_successful_when_refresh_and_counter_publication_fail() {
    let state = Mobile::fixture_session();
    let state_clone = state.clone();
    let fixture=Fixture::start(move |request| { let state=state_clone.clone(); async move {
        match request.uri().path() {
            "/api/profiles/by-id" => Json(json!({"id":"p","name":"test","igLoggedIn":true})).into_response(),
            "/api/chat/session" | "/api/chat/context" => Json(json!({"connected":true,"token":"token","state":state,"profile":{"id":"p","proxy":""}})).into_response(),
            _ => { let _=body(request).await; StatusCode::SERVICE_UNAVAILABLE.into_response() }
        }
    }}).await;
    let mobile_fixture=Fixture::start(|request| async move {
        if request.uri().path().contains("broadcast/text") { Json(json!({"status":"ok","payload":{"item_id":"456","timestamp":"100000","user_id":"123"}})).into_response() }
        else { StatusCode::SERVICE_UNAVAILABLE.into_response() }
    }).await;
    let mut api = Api::from_env().unwrap();
    api.key = "fixture".into();
    api.convex_url = fixture.url.clone();
    let api = Arc::new(api);
    let uploads = Arc::new(crate::uploads::Uploads {
        entries: Default::default(),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    });
    let mobile = Mobile::fixture(api.clone(), uploads, mobile_fixture.url.clone());
    let directory = tempfile::tempdir().unwrap();
    let chat = Chat::new(api, mobile, &directory.path().join("cache.sqlite")).unwrap();
    let request = HttpRequest::builder()
        .method("POST")
        .body(Body::from(json!({"text":"hello"}).to_string()))
        .unwrap();
    let response = chat
        .public(
            "chat.post.profileId_threads_threadId_reply",
            &HashMap::from([
                ("profileId".into(), "p".into()),
                ("threadId".into(), "123".into()),
            ]),
            request,
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let data: Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(data["message"]["text"], "hello");
    assert_eq!(data["message"]["id"], "456");
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
}
