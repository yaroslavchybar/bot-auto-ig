use super::{Error, Result};
use crate::{api::bounded_json, instagram};
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Duration};
pub struct Web {
    client: reqwest::Client,
    cookies: String,
    csrf: String,
    #[cfg(test)]
    base: Option<String>,
}
impl Web {
    pub fn new(profile: &Value) -> Result<Self> {
        let session = profile["sessionId"]
            .as_str()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| {
                Error::failed(
                    "Scraper profile has no Instagram sessionid. Open it and log in first.",
                )
            })?;
        let mut cookies = BTreeMap::from([("sessionid".to_string(), session.to_string())]);
        if let Ok(Value::Array(rows)) =
            serde_json::from_str(profile["cookiesJson"].as_str().unwrap_or("[]"))
        {
            for row in rows {
                let name = row["name"].as_str().unwrap_or("");
                if ["csrftoken", "ds_user_id"].contains(&name) {
                    if let Some(value) = row["value"].as_str() {
                        cookies.insert(name.into(), value.into());
                    }
                }
            }
        }
        let safe = |value: &str| value.replace(['\r', '\n', ';'], "");
        let csrf = cookies
            .get("csrftoken")
            .map(|v| safe(v))
            .unwrap_or_default();
        let cookie = cookies
            .into_iter()
            .map(|(k, v)| format!("{k}={}", safe(&v)))
            .collect::<Vec<_>>()
            .join("; ")
            + ";";
        let proxy = instagram::normalize_proxy(
            &instagram::string(&profile["proxy"]),
            &instagram::string(&profile["proxyType"]),
        )
        .map_err(Error::mobile)?;
        Ok(Self {
            client: instagram::transport_client(&proxy).map_err(Error::mobile)?,
            cookies: cookie,
            csrf,
            #[cfg(test)]
            base: None,
        })
    }
    #[cfg(test)]
    pub fn with_base(mut self, base: Option<String>) -> Self {
        self.base = base;
        self
    }
    pub async fn likers(&self, post: &Value) -> Result<Likers> {
        let id = instagram::string(&post["id"]);
        let code = instagram::string(&post["code"]);
        if !instagram::digits(&id)
            || code.is_empty()
            || !code
                .bytes()
                .all(|v| v.is_ascii_alphanumeric() || v == b'_' || v == b'-')
        {
            return Err(Error::failed("Invalid post ID or shortcode"));
        }
        let mut last = Error::failed("Instagram request failed");
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(attempt * 1500)).await;
            }
            let url = format!("https://www.instagram.com/api/v1/media/{id}/likers/?count=100");
            #[cfg(test)]
            let url = self
                .base
                .as_ref()
                .map(|base| format!("{base}/api/v1/media/{id}/likers/?count=100"))
                .unwrap_or(url);
            let mut request=self.client.get(url)
                .header("user-agent","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                .header("accept","*/*").header("accept-language","en-US,en;q=0.9").header("x-ig-app-id","936619743392459").header("x-requested-with","XMLHttpRequest")
                .header("referer",format!("https://www.instagram.com/p/{code}/")).header("cookie",&self.cookies).timeout(Duration::from_secs(15));
            if !self.csrf.is_empty() {
                request = request.header("x-csrftoken", &self.csrf);
            }
            match request.send().await {
                Err(_) => last = Error::failed("Instagram connection failed"),
                Ok(response) => {
                    let status = response.status().as_u16();
                    if status == 429 {
                        return Err(Error::rate_limited(instagram::retry_after(
                            response.headers(),
                        )));
                    }
                    if !(200..300).contains(&status) {
                        last = Error::failed(&format!("Instagram post likers HTTP {status}"));
                        if (300..500).contains(&status) {
                            return Err(last);
                        }
                        continue;
                    }
                    match bounded_json(response, 10_000_000).await {
                        Ok(data) => {
                            if data["status"].as_str().is_some_and(|v| v != "ok") {
                                last = Error::failed("Instagram API request failed");
                                continue;
                            }
                            return snapshot(&data);
                        }
                        Err(message) => last = Error::failed(message),
                    }
                }
            }
        }
        Err(last)
    }
}
#[derive(Debug)]
pub struct Likers {
    pub rows: Vec<Value>,
    pub ids: Vec<String>,
    pub like_count: Option<u64>,
}
pub fn snapshot(data: &Value) -> Result<Likers> {
    let rows = parse_likers(data)?;
    let mut seen = std::collections::HashSet::new();
    let ids = data["users"]
        .as_array()
        .unwrap()
        .iter()
        .take(100)
        .filter_map(|row| {
            let id = instagram::string(row.get("pk").unwrap_or(&row["id"]));
            (instagram::digits(&id) && seen.insert(id.clone())).then_some(id)
        })
        .collect();
    Ok(Likers {
        rows,
        ids,
        like_count: data["likeCount"].as_u64(),
    })
}
pub fn parse_likers(data: &Value) -> Result<Vec<Value>> {
    let rows = data["users"]
        .as_array()
        .ok_or_else(|| Error::failed("Instagram returned an incomplete likers response"))?;
    Ok(rows.iter().take(100).filter_map(|row|{
        if row["is_private"]!=false{return None;}let id=instagram::string(row.get("pk").unwrap_or(&row["id"]));let username=instagram::string(&row["username"]);
        if !instagram::digits(&id)||username.is_empty(){return None;}Some(json!({"igId":id,"username":username,"fullName":instagram::string(&row["full_name"]),"profilePicUrl":instagram::string(&row["profile_pic_url"])}))
    }).collect())
}
