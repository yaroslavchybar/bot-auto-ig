use crate::api;
use reqwest::{header::HeaderMap, Client};
use serde_json::Value;
use std::{sync::LazyLock, time::Duration};
pub fn string(value: &Value) -> String {
    match value {
        Value::String(v) => v.clone(),
        Value::Number(v) => v.to_string(),
        _ => String::new(),
    }
}
pub fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|v| v.is_ascii_digit())
}
pub fn retry_after(headers: &HeaderMap) -> u64 {
    let raw = headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    raw.parse::<u64>()
        .ok()
        .map(|v| v.saturating_mul(1000))
        .or_else(|| {
            chrono::DateTime::parse_from_rfc2822(raw)
                .ok()
                .map(|v| (v.timestamp_millis().max(0) as u64).saturating_sub(api::now_ms()))
        })
        .unwrap_or(60 * 60 * 1000)
        .clamp(1000, 24 * 60 * 60 * 1000)
}
pub fn normalize_proxy(raw: &str, protocol: &str) -> std::result::Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("none") {
        return Ok(String::new());
    }
    let scheme = if protocol.is_empty() {
        "http"
    } else {
        protocol
    };
    static LEGACY: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)^(?:(https?|socks5)://)?(\[[^\]]+\]|[^:@/]+):(\d+):([^:]+):(.+)$")
            .expect("Static proxy pattern")
    });
    let mut url = if let Some(parts) = LEGACY.captures(raw) {
        let mut url: reqwest::Url = format!(
            "{}://{}:{}",
            parts.get(1).map(|v| v.as_str()).unwrap_or(scheme),
            &parts[2],
            &parts[3]
        )
        .parse()
        .map_err(|_| String::from("Invalid proxy protocol or URL"))?;
        url.set_username(&parts[4])
            .map_err(|_| String::from("Invalid proxy protocol or URL"))?;
        url.set_password(Some(&parts[5]))
            .map_err(|_| String::from("Invalid proxy protocol or URL"))?;
        url
    } else {
        let text = if raw.contains("://") {
            raw.into()
        } else {
            format!("{scheme}://{raw}")
        };
        reqwest::Url::parse(&text).map_err(|_| String::from("Invalid proxy protocol or URL"))?
    };
    if !["http", "https", "socks5"].contains(&url.scheme())
        || url.host_str().is_none()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port() == Some(0)
    {
        return Err(String::from("Invalid proxy protocol or URL"));
    }
    if url.scheme() == "socks5" && url.port().is_none() {
        url.set_port(Some(1080))
            .map_err(|_| String::from("Invalid proxy protocol or URL"))?;
    }
    Ok(url.to_string().trim_end_matches('/').into())
}
pub fn transport_client(proxy: &str) -> std::result::Result<Client, String> {
    let mut builder = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .pool_max_idle_per_host(2)
        .pool_idle_timeout(Duration::from_secs(60));
    if !proxy.is_empty() {
        builder = builder.proxy(
            reqwest::Proxy::all(proxy.replacen("socks5://", "socks5h://", 1))
                .map_err(|_| "Invalid proxy protocol or URL".to_owned())?,
        );
    }
    builder
        .build()
        .map_err(|_| "Could not initialize Instagram web transport".into())
}
