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
        let key = &self.apify_key;
        if key.is_empty() {
            return Err(Error::failed(
                "APIFY_API_KEY is missing from the server environment",
            ));
        }
        let since_date = chrono::DateTime::from_timestamp_millis(since as i64)
            .ok_or_else(|| Error::failed("Invalid scraper start date"))?
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let data=self.provider("https://api.apify.com/v2/actors/apify~instagram-post-scraper/run-sync-get-dataset-items",key,&json!({"username":[format!("https://www.instagram.com/{username}/")],"resultsLimit":limit,"onlyPostsNewerThan":since_date,"dataDetailLevel":"basicData"}),310).await?;
        apify_dataset(&data, since, limit as usize)
    }
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
        posts.push(json!({"id":id,"code":code,"takenAt":date.unwrap(),"likeCount":row["likesCount"].as_u64()}));
        if posts.len() >= limit {
            break;
        }
    }
    Ok(posts)
}
