use crate::instagram::string;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub sender_id: String,
    pub text: String,
    pub timestamp: f64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reactions: Vec<Reaction>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reaction {
    pub sender_id: String,
    pub emoji: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_pic_url: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seen {
    pub user_id: String,
    pub timestamp: f64,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub users: Vec<User>,
    #[serde(default)]
    pub messages: Vec<Message>,
    #[serde(default)]
    pub last_seen_at: Vec<Seen>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unread: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmed_message_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub synced_at: u64,
}
fn is_zero(value: &u64) -> bool {
    *value == 0
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    pub connected: bool,
    pub viewer_id: String,
    pub threads: Vec<Thread>,
    pub synced_at: u64,
}

fn present<'a>(value: &'a Value, fallback: &'a Value) -> &'a Value {
    if value.is_null() {
        fallback
    } else {
        value
    }
}
pub fn message(item: &Value) -> Message {
    let kind = item["item_type"].as_str().unwrap_or("text").to_owned();
    let media = if kind.contains("voice") {
        present(&item["voice_media"]["media"], &item["media"])
    } else if kind == "raven_media" {
        present(&item["visual_media"]["media"], &item["media"])
    } else {
        present(&item["media"], &item["visual_media"]["media"])
    };
    let image = string(&media["image_versions2"]["candidates"][0]["url"]);
    let media_type = if kind.contains("voice") {
        Some("voice")
    } else if kind.contains("video") || media["media_type"] == 2 {
        Some("video")
    } else if kind.contains("photo") || !image.is_empty() {
        Some("photo")
    } else {
        None
    };
    let url = match media_type {
        Some("voice") => string(&media["audio"]["audio_src"]),
        Some("video") => string(&media["video_versions"][0]["url"]),
        _ => image,
    };
    Message {
        id: string(present(&item["item_id"], &item["id"])),
        sender_id: string(present(&item["user_id"], &item["sender_id"])),
        text: string(&item["text"]),
        timestamp: number(&item["timestamp"]) / 1000.0,
        kind,
        client_context: item["client_context"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        media_type: media_type.map(str::to_owned),
        media_url: url.starts_with("https://").then_some(url),
        reactions: item["reactions"]["emojis"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| {
                let sender_id = string(&v["sender_id"]);
                let emoji = string(&v["emoji"]);
                (!sender_id.is_empty() && !emoji.is_empty())
                    .then_some(Reaction { sender_id, emoji })
            })
            .collect(),
    }
}
pub fn number(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|v| v.parse().ok()))
        .filter(|v| v.is_finite())
        .unwrap_or(0.0)
}
pub fn thread(raw: &Value, preview: bool) -> Thread {
    let users: Vec<User> = raw["users"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| User {
            id: string(present(&v["pk"], &v["id"])),
            username: string(&v["username"]),
            profile_pic_url: crate::instagram::picture_url(
                v["profile_pic_url"].as_str().unwrap_or(""),
            ),
        })
        .collect();
    let title = raw["thread_title"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            users
                .iter()
                .filter(|u| !u.username.is_empty())
                .map(|u| u.username.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        });
    let mut messages: Vec<_> = raw["items"]
        .as_array()
        .into_iter()
        .flatten()
        .map(message)
        .collect();
    if preview {
        messages.sort_by(|a, b| b.timestamp.total_cmp(&a.timestamp));
        messages.truncate(1);
    }
    Thread {
        id: string(present(&raw["thread_id"], &raw["thread_v2_id"])),
        title: if title.is_empty() {
            "Conversation".into()
        } else {
            title
        },
        users,
        messages,
        last_seen_at: raw["last_seen_at"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(id, v)| {
                let timestamp = number(&v["timestamp"]) / 1000.0;
                (timestamp > 0.0).then_some(Seen {
                    user_id: id.clone(),
                    timestamp,
                })
            })
            .collect(),
        ..Default::default()
    }
}
