use super::{crypto, Error, Result};
use crate::api::{bounded_json, now_ms};
use cookie_store::CookieStore;
use rand::Rng;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Client, Method,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, sync::LazyLock, time::Duration};

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
        static ORIGIN: LazyLock<reqwest::Url> = LazyLock::new(|| {
            "https://i.instagram.com/"
                .parse()
                .expect("Static Instagram origin")
        });
        self.cookies
            .get_request_values(&ORIGIN)
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
        // Fixed values share their backing bytes; only request-specific values are built.
        static DEFAULTS: LazyLock<HeaderMap> = LazyLock::new(|| {
            [
                ("x-ads-opt-out", "0"),
                ("x-cm-bandwidth-kbps", "-1.000"),
                ("x-cm-latency", "-1.000"),
                ("x-ig-app-locale", "en_US"),
                ("x-ig-device-locale", "en_US"),
                ("accept-encoding", "gzip"),
                ("x-ig-bandwidth-speed-kbps", "-1.000"),
                ("x-ig-bandwidth-totalbytes-b", "0"),
                ("x-ig-bandwidth-totaltime-ms", "0"),
                ("x-ig-extended-cdn-thumbnail-cache-busting-value", "1000"),
                ("x-bloks-version-id", BLOKS_VERSION),
                ("x-bloks-is-layout-rtl", "false"),
                ("x-ig-connection-type", "WIFI"),
                ("x-ig-capabilities", "3brTv10="),
                ("x-ig-app-id", APP_ID),
                ("accept-language", "en-US"),
                ("x-fb-http-engine", "Tigon/MNS/TCP"),
                ("x-tigon-is-retry", "False"),
                ("x-zero-balance", "INIT"),
                ("x-zero-state", "unknown"),
            ]
            .into_iter()
            .map(|(name, value)| {
                (
                    reqwest::header::HeaderName::from_static(name),
                    HeaderValue::from_static(value),
                )
            })
            .collect()
        });
        let mut headers = DEFAULTS.clone();
        fn insert(
            headers: &mut HeaderMap,
            name: &'static str,
            value: impl TryInto<HeaderValue>,
        ) -> Result<()> {
            headers.insert(
                name,
                value
                    .try_into()
                    .map_err(|_| Error::new("Invalid Instagram session header"))?,
            );
            Ok(())
        }
        let now = now_ms();
        insert(&mut headers, "user-agent", state.user_agent())?;
        insert(
            &mut headers,
            "x-pigeon-session-id",
            super::device::pigeon_session(&state.device_id, now),
        )?;
        insert(
            &mut headers,
            "x-pigeon-rawclienttime",
            format!("{:.3}", now as f64 / 1000.0),
        )?;
        insert(
            &mut headers,
            "x-ig-connection-speed",
            format!("{}kbps", rand::thread_rng().gen_range(1000..=3700)),
        )?;
        let mid = state.cookie("mid");
        for (name, value) in [
            ("x-mid", mid.as_str()),
            (
                "x-ig-www-claim",
                if state.claim.is_empty() {
                    "0"
                } else {
                    &state.claim
                },
            ),
            ("x-ig-device-id", &state.uuid),
            ("x-ig-family-device-id", &state.phone_id),
            ("x-ig-android-id", &state.device_id),
            ("authorization", &state.authorization),
        ] {
            if !value.is_empty() {
                insert(&mut headers, name, value)?;
            }
        }
        let mut cookie = String::new();
        for (name, value) in state.cookies.get_request_values(url) {
            if !cookie.is_empty() {
                cookie.push_str("; ");
            }
            cookie.push_str(name);
            cookie.push('=');
            cookie.push_str(value);
        }
        if !cookie.is_empty() {
            insert(&mut headers, "cookie", cookie)?;
        }
        if let Some(identity) = &state.usdid {
            insert(&mut headers, "x-meta-usdid", identity.header()?)?;
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
