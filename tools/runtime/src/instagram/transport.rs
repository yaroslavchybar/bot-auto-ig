use super::{crypto, Error, Result};
use crate::api::{bounded_json, now_ms};
use cookie_store::CookieStore;
use rand::Rng;
use reqwest::{header::HeaderMap, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, time::Duration};

pub const BLOKS_VERSION: &str = "0bc46a03e177bfc9bc8d611918815acf248fa9c77754d807d6a5951dc9ce9432";
pub const APP_ID: &str = "567067343352427";
pub type Fields = BTreeMap<String, String>;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub version: u8,
    pub uuid: String,
    pub phone_id: String,
    pub device_id: String,
    pub device: String,
    #[serde(default, serialize_with = "serialize_cookies")]
    pub cookies: CookieStore,
    #[serde(default)]
    pub authorization: String,
    #[serde(default)]
    pub claim: String,
    #[serde(default)]
    pub usdid: Option<crypto::Usdid>,
    #[serde(default)]
    pub password_key_id: u8,
    #[serde(default)]
    pub password_key: String,
}
fn serialize_cookies<S: serde::Serializer>(
    cookies: &CookieStore,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    // Hash-map iteration must not make unchanged sessions look dirty after reload.
    let mut cookies: Vec<_> = cookies.iter_unexpired().collect();
    cookies.sort_by(|a, b| {
        a.domain
            .cmp(&b.domain)
            .then(a.path.cmp(&b.path))
            .then(a.name().cmp(b.name()))
    });
    serializer.collect_seq(cookies)
}
impl Session {
    pub fn cookie(&self, name: &str) -> String {
        self.cookies
            .get_request_values(&"https://i.instagram.com/".parse().unwrap())
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.into())
            .unwrap_or_default()
    }
    pub fn viewer_id(&self) -> Result<String> {
        let id = self.cookie("ds_user_id");
        if super::digits(&id) {
            return Ok(id);
        }
        use base64::{engine::general_purpose::STANDARD, Engine};
        if let Some(data) = self
            .authorization
            .strip_prefix("Bearer IGT:2:")
            .and_then(|v| STANDARD.decode(v).ok())
            .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
        {
            let id = super::string(&data["ds_user_id"]);
            if super::digits(&id) {
                return Ok(id);
            }
        }
        Err(Error::new("Instagram returned no session user ID"))
    }
    pub fn user_agent(&self) -> String {
        format!(
            "Instagram 448.0.0.0.20 Android ({}; en_US; 1065560286)",
            self.device
        )
    }
    pub fn set_cookie(&mut self, cookie: &str, url: &reqwest::Url) {
        let _ = self.cookies.parse(cookie, url);
    }
}

pub fn client(proxy: &str) -> Result<Client> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .pool_max_idle_per_host(2)
        .pool_idle_timeout(Duration::from_secs(60));
    if !proxy.is_empty() {
        let proxy = proxy.replacen("socks5://", "socks5h://", 1);
        builder = builder.proxy(
            reqwest::Proxy::all(&proxy).map_err(|_| Error::new("Invalid proxy protocol or URL"))?,
        );
    }
    builder
        .build()
        .map_err(|_| Error::new("Could not initialize Instagram transport"))
}

pub struct Mobile {
    pub state: Session,
    pub client: Client,
    #[cfg(test)]
    pub base: Option<String>,
}
impl Mobile {
    pub fn endpoint(&self, host: &str, path: &str) -> String {
        #[cfg(test)]
        if let Some(base) = &self.base {
            return format!("{base}{path}");
        }
        format!("https://{host}{path}")
    }
    pub fn headers(&self, url: &reqwest::Url) -> Result<HeaderMap> {
        let state = &self.state;
        let mut fields = Fields::from([
            ("user-agent".into(), state.user_agent()),
            ("x-ads-opt-out".into(), "0".into()),
            ("x-cm-bandwidth-kbps".into(), "-1.000".into()),
            ("x-cm-latency".into(), "-1.000".into()),
            ("x-ig-app-locale".into(), "en_US".into()),
            ("x-ig-device-locale".into(), "en_US".into()),
            (
                "x-pigeon-session-id".into(),
                super::device::pigeon_session(&state.device_id, now_ms()),
            ),
            (
                "x-pigeon-rawclienttime".into(),
                format!("{:.3}", now_ms() as f64 / 1000.0),
            ),
            (
                "x-ig-connection-speed".into(),
                format!("{}kbps", rand::thread_rng().gen_range(1000..=3700)),
            ),
            ("accept-encoding".into(), "gzip".into()),
            ("x-ig-bandwidth-speed-kbps".into(), "-1.000".into()),
            ("x-ig-bandwidth-totalbytes-b".into(), "0".into()),
            ("x-ig-bandwidth-totaltime-ms".into(), "0".into()),
            (
                "x-ig-extended-cdn-thumbnail-cache-busting-value".into(),
                "1000".into(),
            ),
            ("x-bloks-version-id".into(), BLOKS_VERSION.into()),
            ("x-bloks-is-layout-rtl".into(), "false".into()),
            ("x-mid".into(), state.cookie("mid")),
            (
                "x-ig-www-claim".into(),
                if state.claim.is_empty() {
                    "0".into()
                } else {
                    state.claim.clone()
                },
            ),
            ("x-ig-connection-type".into(), "WIFI".into()),
            ("x-ig-capabilities".into(), "3brTv10=".into()),
            ("x-ig-app-id".into(), APP_ID.into()),
            ("x-ig-device-id".into(), state.uuid.clone()),
            ("x-ig-family-device-id".into(), state.phone_id.clone()),
            ("x-ig-android-id".into(), state.device_id.clone()),
            ("accept-language".into(), "en-US".into()),
            ("x-fb-http-engine".into(), "Tigon/MNS/TCP".into()),
            ("x-tigon-is-retry".into(), "False".into()),
            ("x-zero-balance".into(), "INIT".into()),
            ("x-zero-state".into(), "unknown".into()),
            ("authorization".into(), state.authorization.clone()),
        ]);
        let cookie = state
            .cookies
            .get_request_values(url)
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        fields.insert("cookie".into(), cookie);
        if let Some(identity) = &state.usdid {
            fields.insert("x-meta-usdid".into(), identity.header()?);
        }
        let mut headers = HeaderMap::new();
        for (key, value) in fields {
            if !value.is_empty() {
                headers.insert(
                    reqwest::header::HeaderName::from_bytes(key.as_bytes()).unwrap(),
                    value
                        .parse()
                        .map_err(|_| Error::new("Invalid Instagram session header"))?,
                );
            }
        }
        Ok(headers)
    }
    pub async fn request(
        &mut self,
        host: &str,
        method: Method,
        path: &str,
        fields: Option<&Fields>,
        extra: &Fields,
    ) -> Result<Value> {
        let url: reqwest::Url = format!("https://{host}{path}")
            .parse()
            .map_err(|_| Error::new("Invalid Instagram endpoint"))?;
        let mut request = self
            .client
            .request(method, self.endpoint(host, path))
            .headers(self.headers(&url)?)
            .timeout(Duration::from_secs(20));
        if let Some(fields) = fields {
            request = request.form(fields).header(
                "content-type",
                "application/x-www-form-urlencoded; charset=UTF-8",
            );
        }
        for (key, value) in extra {
            request = request.header(key, value);
        }
        let response = request
            .send()
            .await
            .map_err(|_| Error::new("Instagram mobile connection failed"))?;
        let status = response.status().as_u16();
        let headers = response.headers();
        self.receive_headers(headers, &url);
        let retry_after = super::retry_after(headers);
        if status == 429 {
            return Err(Error::response(path, status, &Value::Null, retry_after));
        }
        if path == "/api/v1/qe/sync/"
            && headers.contains_key("ig-set-password-encryption-pub-key")
            && headers.contains_key("ig-set-password-encryption-key-id")
        {
            return Ok(serde_json::json!({}));
        }
        let data = bounded_json(response, 3_000_000).await.map_err(|message| {
            if !(200..300).contains(&status) {
                return Error::response(path, status, &Value::Null, retry_after);
            }
            let endpoint = path.split('?').next().unwrap_or(path);
            Error {
                message: format!("Instagram mobile {endpoint} HTTP {status}: {message}"),
                name: "IgResponseError".into(),
                status: 502,
                retry_after_ms: retry_after,
            }
        })?;
        if !(200..300).contains(&status) || data["status"] == "fail" || !data["errors"].is_null() {
            return Err(Error::response(path, status, &data, retry_after));
        }
        Ok(data)
    }
    pub fn receive_headers(&mut self, headers: &HeaderMap, url: &reqwest::Url) {
        for cookie in headers
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
        {
            self.state.set_cookie(cookie, url);
        }
        for (key, target) in [
            ("ig-set-authorization", &mut self.state.authorization),
            ("x-ig-set-www-claim", &mut self.state.claim),
            (
                "ig-set-password-encryption-pub-key",
                &mut self.state.password_key,
            ),
        ] {
            if let Some(value) = headers.get(key).and_then(|v| v.to_str().ok()) {
                *target = value.into();
            }
        }
        if let Some(value) = headers
            .get("ig-set-password-encryption-key-id")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
        {
            self.state.password_key_id = value;
        }
    }
    pub async fn mobile(
        &mut self,
        method: Method,
        path: &str,
        fields: Option<&Fields>,
        query: &Fields,
    ) -> Result<Value> {
        let mut url: reqwest::Url = format!("https://i.instagram.com/api/v1/{path}")
            .parse()
            .map_err(|_| Error::new("Invalid Instagram endpoint"))?;
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
        let path = &url.as_str()["https://i.instagram.com".len()..];
        self.request("i.instagram.com", method, path, fields, &Fields::new())
            .await
    }
}
