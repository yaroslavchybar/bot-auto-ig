use super::{
    attachments, crypto,
    transport::{Fields, Mobile},
    Error, Result, Service,
};
use reqwest::Method;
use serde_json::{json, Value};
use std::collections::HashSet;

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
pub async fn invoke(
    service: &Service,
    mobile: &mut Mobile,
    action: &str,
    args: &Value,
) -> Result<Value> {
    match action {
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
        "likers" => media_likers(mobile, args).await,
        _ => Err(Error::new("Unknown Instagram operation")),
    }
}
// Match instagrapi's media_likers: normalize PKs to PK_owner before the
// private mobile request. Full media IDs skip the metadata lookup.
async fn media_likers(mobile: &mut Mobile, args: &Value) -> Result<Value> {
    let media_id = liker_media_id(args)?;
    let mut like_count = None;
    let media_id = if media_id.contains('_') {
        media_id
    } else {
        let info = media_info(mobile, args).await?;
        like_count = media_like_count(&info);
        media_owner_id(&media_id, &info)?
    };
    let result = mobile
        .mobile(
            Method::GET,
            &format!("media/{media_id}/likers/"),
            None,
            &Fields::new(),
        )
        .await?;
    liker_count(result, like_count)
}

pub(super) fn liker_media_id(args: &Value) -> Result<String> {
    let media_id = super::string(&args["mediaId"]);
    let parts: Vec<_> = media_id.split('_').collect();
    if parts.is_empty()
        || parts.len() > 2
        || parts
            .iter()
            .any(|part| part.len() > 40 || !super::digits(part))
    {
        return Err(Error::new("Invalid Instagram media ID"));
    }
    Ok(media_id)
}

pub(super) async fn media_info(mobile: &mut Mobile, args: &Value) -> Result<Value> {
    let media_id = liker_media_id(args)?;
    mobile
        .mobile(
            Method::GET,
            &format!("media/{media_id}/info/"),
            None,
            &Fields::new(),
        )
        .await
}

pub(super) fn media_like_count(info: &Value) -> Option<u64> {
    info["items"]
        .as_array()
        .and_then(|items| items.last())
        .and_then(|item| item["like_count"].as_u64())
}

pub(super) fn media_owner_id(media_id: &str, info: &Value) -> Result<String> {
    let owner = info["items"]
        .as_array()
        .and_then(|items| items.last())
        .map(|item| super::string(&item["user"]["pk"]))
        .unwrap_or_default();
    if owner.len() > 40 || !super::digits(&owner) {
        return Err(Error::new("Instagram returned no media owner"));
    }
    Ok(format!("{media_id}_{owner}"))
}

pub(super) fn liker_count(mut result: Value, like_count: Option<u64>) -> Result<Value> {
    if let Some(count) = like_count {
        result
            .as_object_mut()
            .ok_or_else(|| Error::new("Instagram returned invalid likers"))?
            .insert("likeCount".into(), json!(count));
    }
    Ok(result)
}
fn string_arg(args: &Value, key: &str, max: usize) -> Result<String> {
    args[key]
        .as_str()
        .filter(|v| !v.trim().is_empty() && v.chars().count() <= max)
        .map(String::from)
        .ok_or_else(|| Error::new("Invalid profile identity"))
}
pub fn collect_posts<'a>(
    items: impl IntoIterator<Item = &'a Value>,
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
            posts.push(json!({"id":id,"code":code,"takenAt":date as u64,"likeCount":item["like_count"].as_u64()}));
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
    let mut pinned_posts = Vec::new();
    let mut pinned_seen = HashSet::new();
    let mut seen = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor = String::new();
    loop {
        if let Some(profile_id) = args["profileId"].as_str() {
            service.check_scraper_available(profile_id)?;
        }
        if args["sourceId"].is_string() && args["runId"].is_string() {
            service
                .api
                .convex(
                    Method::POST,
                    "/api/scraper/heartbeat",
                    Some(&json!({"sourceId":args["sourceId"],"runId":args["runId"]})),
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
        let pinned = |item: &&Value| {
            item["timeline_pinned_user_ids"]
                .as_array()
                .is_some_and(|ids| !ids.is_empty())
        };
        // Pinned older posts must not displace newer posts on the next feed page.
        collect_posts(
            items.iter().filter(pinned),
            since,
            limit,
            &mut pinned_posts,
            &mut pinned_seen,
        )?;
        let exhausted = collect_posts(
            items.iter().filter(|item| !pinned(item)),
            since,
            limit,
            &mut posts,
            &mut seen,
        )?;
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
    for post in pinned_posts {
        if seen.insert(super::string(&post["id"])) {
            posts.push(post);
        }
    }
    posts.sort_by_key(|post| std::cmp::Reverse(post["takenAt"].as_u64().unwrap_or(0)));
    posts.truncate(limit);
    Ok(json!(posts))
}
