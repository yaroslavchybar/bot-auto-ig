use super::{Error, Result, Scraper};
use crate::{api::bounded_json, instagram};
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};

impl Scraper {
    pub(super) async fn provider(
        &self,
        url: &str,
        key: &str,
        body: &Value,
        seconds: u64,
    ) -> Result<Value> {
        #[cfg(test)]
        let fixture = self
            .provider_url
            .as_ref()
            .map(|base| format!("{base}{}", reqwest::Url::parse(url).unwrap().path()));
        #[cfg(test)]
        let url = fixture.as_deref().unwrap_or(url);
        let response = self
            .api
            .client
            .post(url)
            .bearer_auth(key)
            .json(body)
            .timeout(Duration::from_secs(seconds))
            .send()
            .await
            .map_err(|_| Error::failed("Scraper provider connection failed"))?;
        if !response.status().is_success() {
            return Err(Error::failed(&format!(
                "Scraper provider HTTP {}",
                response.status().as_u16()
            )));
        }
        bounded_json(response, 10_000_000)
            .await
            .map_err(Error::failed)
    }
    pub(super) async fn apify_posts(
        &self,
        username: &str,
        since: u64,
        limit: u64,
    ) -> Result<Vec<Value>> {
        let key = self.apify_key.clone();
        if key.is_empty() {
            return Err(Error::failed(
                "APIFY_API_KEY is missing from the server environment",
            ));
        }
        let since_date = chrono::DateTime::from_timestamp_millis(since as i64)
            .ok_or_else(|| Error::failed("Invalid scraper start date"))?
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let data=self.provider("https://api.apify.com/v2/actors/apify~instagram-post-scraper/run-sync-get-dataset-items",&key,&json!({"username":[format!("https://www.instagram.com/{username}/")],"resultsLimit":limit,"onlyPostsNewerThan":since_date,"dataDetailLevel":"basicData"}),310).await?;
        apify_dataset(&data, since, limit as usize)
    }
    pub(super) async fn describe_picture(&self, url: &str, key: &str) -> Result<String> {
        let data=self.provider("https://openrouter.ai/api/v1/chat/completions",key,&json!({"model":"openai/gpt-6-luna","reasoning_effort":"none","max_tokens":100,"messages":[{"role":"user","content":[{"type":"text","text":"Describe this Instagram profile picture in one factual sentence. Mention visible people, text, logos or objects. Do not guess identity, age or gender."},{"type":"image_url","image_url":{"url":url,"detail":"low"}}]}]}),120).await?;
        let content = data
            .pointer("/choices/0/message/content")
            .unwrap_or(&Value::Null);
        let description = match content {
            Value::String(v) => v.clone(),
            Value::Array(parts) => parts
                .iter()
                .filter(|v| v["type"] == "text")
                .filter_map(|v| v["text"].as_str())
                .collect::<Vec<_>>()
                .join(" "),
            _ => String::new(),
        };
        if description.trim().is_empty() {
            return Err(Error::failed("Luna returned no picture description"));
        }
        Ok(description.trim().chars().take(500).collect())
    }
    pub(super) async fn classify(
        &self,
        key: &str,
        username: &str,
        full_name: &str,
        description: Option<&str>,
    ) -> Result<String> {
        let mut record = json!({"username":username,"fullName":full_name});
        if let Some(value) = description {
            record["pictureDescription"] = json!(value);
        }
        let data=self.provider("https://openrouter.ai/api/alpha/decisions",key,&json!({"model":"typesafe/jev-1.13","state":{"description":"An Instagram account, using only its public profile metadata.","record":record},"questions":{"account_type":{"type":"choice","instructions":"Choose the best-fitting category from these three options. Business takes priority over the apparent gender of an owner. Always choose one category, even when evidence is limited.","criteria":{"male":"A personal account clearly presenting as a man, with no indication that the account represents a business.","female":"A personal account clearly presenting as a woman, with no indication that the account represents a business.","business":"A brand, shop, organization, company, commercial service, or professional business account."}}}}),120).await?;
        classification(&data)
    }
}
pub fn classification(data: &Value) -> Result<String> {
    let answer = &data["answers"]["account_type"];
    if answer["type"] != "choice" {
        return Err(Error::failed("Jev returned no account classification"));
    }
    let categories = ["male", "female", "business"];
    let scores: Option<Vec<f64>> = categories
        .iter()
        .map(|key| {
            answer["probabilities"][key]
                .as_f64()
                .filter(|v| v.is_finite())
        })
        .collect();
    if let Some(scores) = scores {
        let mut best = 0;
        for i in 1..scores.len() {
            if scores[i] > scores[best] {
                best = i;
            }
        }
        return Ok(categories[best].into());
    }
    let choice = answer["choice"].as_str().unwrap_or("");
    if categories.contains(&choice) {
        Ok(choice.into())
    } else {
        Err(Error::failed(
            "Jev returned an invalid account classification",
        ))
    }
}
pub fn picture_url(raw: &str) -> Option<String> {
    let url: reqwest::Url = raw.parse().ok()?;
    let host = url.host_str()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    ["fbcdn.net", "cdninstagram.com", "instagram.com"]
        .iter()
        .any(|base| host == *base || host.ends_with(&format!(".{base}")))
        .then(|| url.to_string())
}
pub fn apify_dataset(data: &Value, since: u64, limit: usize) -> Result<Vec<Value>> {
    let rows = data
        .as_array()
        .ok_or_else(|| Error::failed("Apify returned an invalid post dataset"))?;
    let mut posts = vec![];
    let mut seen = HashSet::new();
    for row in rows {
        if !row.is_object() {
            return Err(Error::failed("Apify returned an invalid post row"));
        }
        if row
            .get("error")
            .is_some_and(|v| !v.is_null() && v != false && v != "")
        {
            return Err(Error::failed(
                "Apify could not retrieve public Instagram posts; retry later",
            ));
        }
        let pk = instagram::string(row.get("id").unwrap_or(&row["pk"]));
        let id = pk.split('_').next().unwrap_or("");
        let code = instagram::string(
            row.get("shortCode")
                .or_else(|| row.get("shortcode"))
                .unwrap_or(&row["code"]),
        );
        let date = row["timestamp"]
            .as_str()
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            .map(|v| v.timestamp_millis());
        if !instagram::digits(id)
            || code.is_empty()
            || !code
                .bytes()
                .all(|v| v.is_ascii_alphanumeric() || v == b'_' || v == b'-')
            || date.is_none()
        {
            return Err(Error::failed(
                "Apify returned a post without an ID, shortcode, or date",
            ));
        }
        if date.unwrap() < (since as i64) || !seen.insert(id.to_string()) {
            continue;
        }
        posts.push(json!({"id":id,"code":code}));
        if posts.len() >= limit {
            break;
        }
    }
    Ok(posts)
}
