use super::{
    attachments, crypto,
    transport::{Fields, Mobile},
    Error, Result, Service,
};
use reqwest::Method;
use serde_json::{json, Value};
use std::{collections::HashSet, sync::LazyLock};

fn fields(value: Value) -> Fields {
    let Value::Object(object) = value else {
        panic!("Static fields must be an object")
    };
    object
        .into_iter()
        .map(|(k, v)| {
            (
                k,
                match v {
                    Value::String(v) => v,
                    _ => super::string(&v),
                },
            )
        })
        .collect()
}
fn id(args: &Value, key: &str) -> Result<String> {
    let id = super::string(&args[key]);
    if id.len() <= 40 && super::digits(&id) {
        Ok(id)
    } else {
        Err(Error::new("Invalid Instagram item ID"))
    }
}
fn token(args: &Value) -> Result<String> {
    match args["clientContext"].as_str() {
        Some(token) if uuid::Uuid::parse_str(token).is_ok() => Ok(token.into()),
        Some(_) => Err(Error::new("Invalid message context")),
        None => Ok(uuid::Uuid::new_v4().to_string()),
    }
}
fn send_fields(mobile: &Mobile, thread: &str, token: &str) -> Fields {
    fields(
        json!({"action":"send_item","is_x_transport_forward":"false","send_silently":"false","is_shh_mode":"0","send_attribution":"message_button","client_context":token,"device_id":mobile.state.device_id,"mutation_token":token,"_uuid":mobile.state.uuid,"btt_dual_send":"false","nav_chain":"1qT:feed_timeline:1,1qT:feed_timeline:2,1qT:feed_timeline:3,7Az:direct_inbox:4,7Az:direct_inbox:5,5rG:direct_thread:7","is_ae_dual_send":"false","offline_threading_id":token,"thread_ids":format!("[{thread}]")}),
    )
}
pub async fn invoke(
    service: &Service,
    mobile: &mut Mobile,
    action: &str,
    args: &Value,
) -> Result<Value> {
    match action {
        "inbox" => inbox(mobile, args["onlyUnread"].as_bool().unwrap_or(false)).await,
        "thread" => {
            let thread = id(args, "threadId")?;
            let mut query = fields(
                json!({"visual_message_return_type":"unseen","direction":"older","seq_id":"40065","limit":"10"}),
            );
            if let Some(cursor) = args["cursor"]
                .as_str()
                .filter(|v| !v.is_empty() && v.len() <= 4096)
            {
                query.insert("cursor".into(), cursor.into());
            }
            mobile
                .mobile(
                    Method::GET,
                    &format!("direct_v2/threads/{thread}/"),
                    None,
                    &query,
                )
                .await
        }
        "reply" => {
            let thread = id(args, "threadId")?;
            let text = args["text"]
                .as_str()
                .filter(|v| !v.trim().is_empty() && v.chars().count() <= 1000)
                .ok_or_else(|| Error::new("Reply must contain 1 to 1000 characters"))?;
            let token = token(args)?;
            let mut body = send_fields(mobile, &thread, &token);
            static LINKS: LazyLock<regex::Regex> = LazyLock::new(|| {
                regex::Regex::new(r"https?://[^\s]+").expect("Static link pattern")
            });
            let links: Vec<_> = LINKS.find_iter(text).map(|m| m.as_str()).collect();
            let kind = if links.is_empty() {
                body.insert("text".into(), text.into());
                "text"
            } else {
                body.insert("link_text".into(), text.into());
                body.insert("link_urls".into(), json!(links).to_string());
                "link"
            };
            let result = mobile
                .mobile(
                    Method::POST,
                    &format!("direct_v2/threads/broadcast/{kind}/"),
                    Some(&body),
                    &Fields::new(),
                )
                .await?;
            confirmed(&result, "Instagram did not confirm the DM reply")?;
            Ok(result)
        }
        "reaction" => {
            let thread = id(args, "threadId")?;
            let item = id(args, "itemId")?;
            let token = uuid::Uuid::new_v4().to_string();
            let mut body = send_fields(mobile, &thread, &token);
            body.remove("_uuid");
            let emoji = args["emoji"]
                .as_str()
                .filter(|v| !v.trim().is_empty() && v.chars().count() <= 16)
                .ok_or_else(|| Error::new("Invalid reaction"))?;
            body.extend(fields(json!({"send_attribution":"message_reaction","item_type":"reaction","reaction_type":"like","reaction_status":if args["remove"]==true{"deleted"}else{"created"},"node_type":"item","item_id":item,"emoji":emoji,"reaction_action_source":"reaction_sheet"})));
            for (source, target) in [
                ("clientContext", "original_message_client_context"),
                ("kind", "target_item_type"),
            ] {
                if let Some(value) = args[source]
                    .as_str()
                    .filter(|v| !v.is_empty() && v.len() < 256)
                {
                    body.insert(target.into(), value.into());
                }
            }
            let result = mobile
                .mobile(
                    Method::POST,
                    "direct_v2/threads/broadcast/reaction/",
                    Some(&body),
                    &Fields::new(),
                )
                .await?;
            if result["status"] != "ok" {
                return Err(Error::new("Instagram did not confirm the reaction"));
            }
            Ok(json!({"ok":true}))
        }
        "unsend" => {
            let thread = id(args, "threadId")?;
            let item = id(args, "itemId")?;
            let body = fields(json!({"_uuid":mobile.state.uuid}));
            let result = mobile
                .mobile(
                    Method::POST,
                    &format!("direct_v2/threads/{thread}/items/{item}/delete/"),
                    Some(&body),
                    &Fields::new(),
                )
                .await?;
            if result["status"] != "ok" {
                return Err(Error::new("Instagram did not confirm the unsend"));
            }
            Ok(json!({"ok":true}))
        }
        "username" | "fullName" => {
            let current = mobile
                .mobile(
                    Method::GET,
                    "accounts/current_user/",
                    None,
                    &fields(json!({"edit":"true"})),
                )
                .await?;
            let current = &current["user"];
            if current["username"].as_str().is_none_or(str::is_empty)
                || current["full_name"].as_str().is_none()
            {
                return Err(Error::new(
                    "Instagram did not return the current profile identity",
                ));
            }
            let username = if action == "username" {
                string_arg(args, "username", 30)?
            } else {
                super::string(&current["username"])
            };
            let full_name = if action == "fullName" {
                string_arg(args, "fullName", 64)?
            } else {
                super::string(&current["full_name"])
            };
            let mut body = json!({"username":username,"first_name":full_name,"_csrftoken":mobile.state.cookie("csrftoken"),"_uid":mobile.state.viewer_id()?,"device_id":mobile.state.device_id,"_uuid":mobile.state.uuid});
            for key in [
                "external_url",
                "gender",
                "phone_number",
                "biography",
                "email",
            ] {
                body[key] = json!(super::string(&current[key]));
            }
            let result = mobile
                .mobile(
                    Method::POST,
                    "accounts/edit_profile/",
                    Some(&crypto::signed_fields(&body)),
                    &Fields::new(),
                )
                .await?;
            if result["user"]["username"] != username || result["user"]["full_name"] != full_name {
                return Err(Error::new("Instagram did not confirm the profile change"));
            }
            Ok(json!({"ok":true}))
        }
        "avatar" => {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(args["image"].as_str().unwrap_or(""))
                .map_err(|_| Error::new("Invalid profile photo"))?;
            attachments::profile_picture(mobile, bytes).await?;
            Ok(json!({"ok":true}))
        }
        "posts" => recent_posts(service, mobile, args).await,
        "attachment" => send_attachment(service, mobile, args).await,
        _ => Err(Error::new("Unknown Instagram operation")),
    }
}
fn string_arg(args: &Value, key: &str, max: usize) -> Result<String> {
    args[key]
        .as_str()
        .filter(|v| !v.trim().is_empty() && v.chars().count() <= max)
        .map(String::from)
        .ok_or_else(|| Error::new("Invalid profile identity"))
}
fn confirmed(value: &Value, message: &str) -> Result<()> {
    if super::string(&value["payload"]["item_id"]).is_empty()
        && super::string(&value["payload"]["id"]).is_empty()
    {
        Err(Error::new(message))
    } else {
        Ok(())
    }
}
async fn inbox(mobile: &mut Mobile, unread: bool) -> Result<Value> {
    let limit = if unread { 200 } else { 30 };
    let mut threads = Vec::with_capacity(limit);
    let mut ids = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor = String::new();
    loop {
        let mut query = fields(
            json!({"eb_device_id":"0","igd_request_log_tracking_id":uuid::Uuid::new_v4().to_string(),"visual_message_return_type":"unseen","thread_message_limit":"1","persistentBadging":"true","limit":"20","is_prefetching":"false","fetch_reason":if cursor.is_empty(){"initial_snapshot"}else{"page_scroll"},"include_old_mrs":"false","no_pending_badge":"true","push_disabled":"true"}),
        );
        if unread {
            query.insert("selected_filter".into(), "unread".into());
        }
        if !cursor.is_empty() {
            query.insert("cursor".into(), cursor.clone());
            query.insert("direction".into(), "older".into());
        }
        let mut result = mobile
            .mobile(Method::GET, "direct_v2/inbox/", None, &query)
            .await?;
        let inbox = result
            .get_mut("inbox")
            .ok_or_else(|| Error::new("Instagram returned no DM inbox"))?;
        let rows = inbox
            .get_mut("threads")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| Error::new("Instagram returned no DM inbox"))?;
        let rows = std::mem::take(rows);
        let before = threads.len();
        for mut row in rows {
            let id = super::string(row.get("thread_id").unwrap_or(&row["thread_v2_id"]));
            if !id.is_empty() && ids.insert(id) {
                if let Some(items) = row.get_mut("items").and_then(Value::as_array_mut) {
                    let latest = std::mem::take(items).into_iter().min_by_key(|v| {
                        std::cmp::Reverse(
                            v["timestamp"]
                                .as_u64()
                                .or_else(|| v["timestamp"].as_str().and_then(|v| v.parse().ok()))
                                .unwrap_or(0),
                        )
                    });
                    items.extend(latest);
                }
                threads.push(row);
            }
            if threads.len() >= limit {
                return Ok(json!({"viewerId":mobile.state.viewer_id()?,"threads":threads}));
            }
        }
        cursor = super::string(&inbox["oldest_cursor"]);
        if cursor.is_empty() {
            if inbox["has_older"] == true {
                return Err(Error::new("Instagram DM inbox cursor is missing"));
            }
            break;
        }
        if !cursors.insert(cursor.clone()) || cursors.len() > 100 || before == threads.len() {
            return Err(Error::new(
                "Instagram DM inbox cursor repeated or made no progress",
            ));
        }
    }
    Ok(json!({"viewerId":mobile.state.viewer_id()?,"threads":threads}))
}

pub fn collect_posts(
    items: &[Value],
    since: u64,
    limit: usize,
    posts: &mut Vec<Value>,
    seen: &mut HashSet<String>,
) -> Result<bool> {
    let mut exhausted = false;
    for item in items {
        let date = item["taken_at"]
            .as_f64()
            .filter(|v| v.is_finite() && *v > 0.0)
            .ok_or_else(|| Error::new("Instagram returned a post without a date"))?
            * 1000.0;
        if date < (since as f64) {
            if !item["timeline_pinned_user_ids"]
                .as_array()
                .is_some_and(|v| !v.is_empty())
            {
                exhausted = true;
            }
            continue;
        }
        let pk = super::string(&item["pk"]);
        let id = pk.split('_').next().unwrap_or("");
        let code = super::string(&item["code"]);
        if !super::digits(id)
            || code.is_empty()
            || !code
                .bytes()
                .all(|v| v.is_ascii_alphanumeric() || v == b'_' || v == b'-')
        {
            return Err(Error::new(
                "Instagram returned a post without an ID or shortcode",
            ));
        }
        if seen.insert(id.into()) {
            posts.push(json!({"id":id,"code":code}));
        }
        if posts.len() >= limit {
            break;
        }
    }
    Ok(exhausted)
}
async fn recent_posts(service: &Service, mobile: &mut Mobile, args: &Value) -> Result<Value> {
    let username = string_arg(args, "username", 30)?.to_lowercase();
    let limit = args["postLimit"]
        .as_u64()
        .filter(|v| *v > 0 && *v <= 5000)
        .ok_or_else(|| Error::new("Invalid post limit"))? as usize;
    let since = args["sinceDate"]
        .as_u64()
        .ok_or_else(|| Error::new("Invalid post date"))?;
    let users = mobile
        .mobile(
            Method::GET,
            "users/search/",
            None,
            &fields(json!({"q":username,"count":"30","timezone_offset":"0"})),
        )
        .await?;
    let user = users["users"]
        .as_array()
        .and_then(|users| users.iter().find(|v| v["username"] == username))
        .ok_or_else(|| Error::new("Instagram could not find the requested profile"))?;
    let user_id = super::string(&user["pk"]);
    if !super::digits(&user_id) {
        return Err(Error::new("Instagram could not find the requested profile"));
    }
    let mut posts = Vec::new();
    let mut seen = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor = String::new();
    loop {
        if args["jobId"].is_string() && args["runId"].is_string() {
            service
                .api
                .convex(
                    Method::POST,
                    "/api/scraper/checkpoint",
                    Some(&json!({"jobId":args["jobId"],"runId":args["runId"]})),
                )
                .await
                .map_err(Error::new)?;
        }
        let query = if cursor.is_empty() {
            Fields::new()
        } else {
            fields(json!({"max_id":cursor}))
        };
        let result = mobile
            .mobile(Method::GET, &format!("feed/user/{user_id}/"), None, &query)
            .await?;
        let items = result["items"]
            .as_array()
            .ok_or_else(|| Error::new("Instagram returned no profile feed"))?;
        if items.is_empty() {
            if result["more_available"] == true {
                return Err(Error::new("Instagram profile feed returned an empty page"));
            }
            break;
        }
        let exhausted = collect_posts(items, since, limit, &mut posts, &mut seen)?;
        if exhausted || posts.len() >= limit || result["more_available"] != true {
            break;
        }
        cursor = super::string(&result["next_max_id"]);
        if cursor.is_empty() || !cursors.insert(cursor.clone()) || cursors.len() > 5000 {
            return Err(Error::new(
                "Instagram profile feed cursor is missing or repeated",
            ));
        }
    }
    Ok(json!(posts))
}

async fn send_attachment(service: &Service, mobile: &mut Mobile, args: &Value) -> Result<Value> {
    let thread = id(args, "threadId")?;
    let token = token(args)?;
    let kind = args["kind"].as_str().unwrap_or("");
    let video = if kind == "video" {
        let video = &args["video"];
        let width = video["width"].as_u64().filter(|v| *v > 0 && *v <= 8192);
        let height = video["height"].as_u64().filter(|v| *v > 0 && *v <= 8192);
        let duration = video["duration"]
            .as_f64()
            .filter(|v| v.is_finite() && *v > 0.0 && *v <= 600.0);
        Some(
            width
                .zip(height)
                .zip(duration)
                .ok_or_else(|| Error::new("Invalid video metadata"))?,
        )
    } else {
        None
    };
    let uploaded = attachments::upload(service, mobile, kind, args).await?;
    let base = json!({"thread_ids":format!("[{thread}]"),"client_context":token,"attachment_fbid":uploaded.media_id,"device_id":mobile.state.device_id,"mutation_token":token,"_uuid":mobile.state.uuid,"offline_threading_id":token});
    let (endpoint, body) = if kind == "photo" {
        let mut body = fields(base);
        body.extend(fields(json!({"action":"send_item","is_x_transport_forward":"false","is_shh_mode":"0","send_attribution":"inbox","allow_full_aspect_ratio":"true","btt_dual_send":"false","is_ae_dual_send":"false"})));
        ("direct_v2/threads/broadcast/photo_attachment/", body)
    } else if kind == "voice" {
        use rand::Rng;
        let waveform: Vec<f64> = (0..70)
            .map(|_| (rand::thread_rng().gen_range(0.2f64..0.95) * 1000.0).round() / 1000.0)
            .collect();
        let mut body = fields(base);
        body.extend(fields(json!({"action":"send_item","send_attribution":"inbox","waveform":json!(waveform).to_string(),"waveform_sampling_frequency_hz":"10","upload_id":uploaded.upload_id})));
        ("direct_v2/threads/broadcast/voice_attachment/", body)
    } else {
        let ((width, height), duration) = video.unwrap();
        let parts: Vec<_> = mobile.state.device.split(';').map(str::trim).collect();
        let android: Vec<_> = parts[0].split('/').collect();
        let seconds = (crate::api::now_ms() / 1000).to_string();
        let body = json!({"recipient_users":"[]","view_mode":"permanent","has_camera_metadata":"1","camera_entry_point":"3","thread_ids":format!("[{thread}]"),"reshare_mode":"allow_reshare","original_media_type":"2","send_attribution":"direct_composer","client_context":token,"camera_session_id":uuid::Uuid::new_v4().to_string(),"attachment_fbid":uploaded.media_id,"include_e2ee_mentioned_user_list":"1","hide_from_profile_grid":"false","timezone_offset":"0","client_shared_at":seconds,"configure_mode":"2","source_type":"3","camera_position":"back","video_result":uploaded.media_id,"_uid":mobile.state.viewer_id()?,"device_id":mobile.state.device_id,"composition_id":uuid::Uuid::new_v4().to_string(),"mutation_token":token,"_uuid":mobile.state.uuid,"creation_surface":"camera","has_ig_camera_edits":"false","capture_type":"normal","audience":"default","upload_id":uploaded.upload_id,"client_timestamp":seconds,"media_transformation_info":json!({"width":width.to_string(),"height":height.to_string(),"x_transform":"0","y_transform":"0","zoom":"1.0","rotation":"0.0","background_coverage":"0.0"}).to_string(),"clips":[{"length":duration,"source_type":"3","camera_position":"back"}],"poster_frame_index":0,"length":duration,"audio_muted":false,"edits":{"filter_type":0,"filter_strength":1.0},"extra":{"source_width":width,"source_height":height},"device":{"manufacturer":parts.get(3).unwrap_or(&"Google/google").split('/').next().unwrap_or("Google"),"model":parts.get(4).unwrap_or(&"Pixel"),"android_version":android[0].parse::<u32>().unwrap_or(30),"android_release":android.get(1).unwrap_or(&"11")}});
        (
            "direct_v2/threads/broadcast/raven_attachment/?video=1",
            crypto::signed_fields(&body),
        )
    };
    let result = mobile
        .mobile(Method::POST, endpoint, Some(&body), &Fields::new())
        .await?;
    confirmed(&result, "Instagram did not confirm the DM attachment")?;
    Ok(result)
}
